import { NextResponse } from "next/server";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/session";
import { getActiveStore } from "@/lib/stores";
import { getShopifyOAuthCredentials } from "@/lib/settings";

// GET /api/postback/shopify/installapp?shop=<loja>.myshopify.com
// URL para colar no campo "App URL" da Shopify (instalação em 1 clique / OAuth).
// A Shopify redireciona para cá com ?shop=...; iniciamos o OAuth e, ao voltar no
// callback, salvamos o token na LOJA ATIVA do lojista logado (via state assinado).

const SCOPES =
  "read_customers,write_customers,read_orders,write_orders,read_draft_orders,write_draft_orders,read_products,write_products,read_themes,write_themes,read_discounts,read_price_rules,read_script_tags,write_script_tags";

/** Assina o state (base64url.hmac) para confiar no storeId ao voltar do OAuth. */
function signState(payload: string): string {
  const b = Buffer.from(payload).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(b)
    .digest("hex");
  return `${b}.${sig}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const shop = (url.searchParams.get("shop") || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return NextResponse.json(
      { error: "Parâmetro shop inválido (ex.: sua-loja.myshopify.com)" },
      { status: 400 },
    );
  }

  // Precisa estar logado no painel para vincular a Shopify à loja ativa.
  const user = await getCurrentUser();
  if (!user) {
    const back = `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
    return NextResponse.redirect(new URL(back, url.origin));
  }
  const store = await getActiveStore();
  if (!store) return NextResponse.redirect(new URL("/painel", url.origin));

  // Credenciais do app são POR LOJA (o lojista cadastra sua API key/secret).
  const creds = await getShopifyOAuthCredentials(store.id);
  if (!creds) {
    return NextResponse.json(
      { error: "Cadastre a API key e o API secret da Shopify no painel antes de conectar." },
      { status: 400 },
    );
  }
  const apiKey = creds.apiKey;

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = signState(JSON.stringify({ s: store.id, n: nonce }));
  const redirectUri = `${url.origin}/api/postback/shopify/callback`;
  const authorize =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(apiKey)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  const res = NextResponse.redirect(authorize);
  // sameSite=lax: o cookie precisa sobreviver ao retorno (redirect) da Shopify.
  res.cookies.set("sh_oauth", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
