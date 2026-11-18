import { NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { updateStoreSettings, getShopifyOAuthCredentials } from "@/lib/settings";
import { verifyShopifyOAuthHmac, exchangeShopifyToken, registerShopifyWebhooks, syncShopifyProductsToDb } from "@/lib/shopify";

// GET /api/postback/shopify/callback
// Retorno do OAuth da Shopify: valida HMAC + state, troca o code por token e
// salva na loja (criptografado). Também cadastra os webhooks automaticamente.

const TOPICS = ["products/create", "products/update", "products/delete", "orders/paid"];

/** Verifica o state assinado e devolve o payload { s: storeId, n: nonce }. */
function verifyState(state: string | null): { s: string; n: string } | null {
  if (!state) return null;
  const [b, sig] = state.split(".");
  if (!b || !sig) return null;
  const expected = crypto
    .createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(b)
    .digest("hex");
  const a = Buffer.from(expected);
  const c = Buffer.from(sig);
  if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return null;
  try {
    return JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const shop = (url.searchParams.get("shop") || "").toLowerCase();
  const code = url.searchParams.get("code") || "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !code) {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  }

  // 1) State assinado (pelo nosso servidor) + nonce do cookie: dizem a loja e
  // barram CSRF. É seguro confiar no storeId daqui para carregar as credenciais.
  const parsed = verifyState(url.searchParams.get("state"));
  const nonce = (await cookies()).get("sh_oauth")?.value;
  if (!parsed || !nonce || parsed.n !== nonce) {
    return NextResponse.json({ error: "State inválido" }, { status: 401 });
  }

  // 2) Credenciais do app são da LOJA (o lojista cadastrou a API key/secret).
  const creds = await getShopifyOAuthCredentials(parsed.s);
  if (!creds) {
    return NextResponse.json({ error: "Credenciais da Shopify não configuradas." }, { status: 400 });
  }

  // 3) Assinatura da requisição (prova que veio da Shopify) com o secret da loja.
  if (!verifyShopifyOAuthHmac(url, creds.apiSecret)) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  // 4) Troca o code por um access token permanente.
  const token = await exchangeShopifyToken(shop, code, creds.apiKey, creds.apiSecret);
  if (!token) {
    return NextResponse.json({ error: "Falha ao obter o token da Shopify" }, { status: 502 });
  }

  // 5) Salva na loja. Webhooks de apps OAuth são assinados com o API secret,
  // então guardamos ele como webhook secret (a verificação já usa esse campo).
  await updateStoreSettings(parsed.s, {
    shopifyStoreDomain: shop,
    shopifyAdminToken: token,
    shopifyWebhookSecret: creds.apiSecret,
  });

  // 6) Cadastra os webhooks (best-effort; não derruba a conexão se falhar).
  try {
    await registerShopifyWebhooks(parsed.s, `${url.origin}/api/webhooks/shopify`, TOPICS);
  } catch {
    /* segue o baile */
  }

  // 7) Sincroniza os produtos automaticamente ao conectar. Best-effort: se
  // falhar (ex.: catálogo enorme dando timeout), a conexão continua válida e o
  // lojista pode sincronizar manualmente pelo botão.
  let synced = 0;
  try {
    synced = await syncShopifyProductsToDb(parsed.s);
  } catch {
    /* segue o baile — botão manual continua disponível */
  }

  const res = NextResponse.redirect(new URL(`/painel/shopify?connected=1&synced=${synced}`, url.origin));
  res.cookies.set("sh_oauth", "", { path: "/", maxAge: 0 });
  return res;
}
