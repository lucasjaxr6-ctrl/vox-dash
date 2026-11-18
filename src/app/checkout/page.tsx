import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import CheckoutForm from "@/components/checkout/CheckoutForm";
import PixelScripts from "@/components/checkout/PixelScripts";
import { getCheckoutTheme, getStoreName, getActivePixels, getCheckoutPaymentConfig } from "@/lib/settings";
import { getActiveReviews } from "@/lib/reviews";
import { getActiveOrderBumps } from "@/lib/order-bumps";
import { mergeTheme } from "@/lib/checkout-theme";
import { query, inPlaceholders } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";

// O checkout deve sempre refletir o estado atual (tema, avaliações, produtos) e é
// resolvido pelo DOMÍNIO próprio (Host) — portanto sempre dinâmico.
export const dynamic = "force-dynamic";

// Trava o zoom no checkout (evita o auto-zoom do iOS ao focar campos, que
// desloca o layout e confunde o cliente na hora da compra).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

type ProductRow = {
  id: string;
  shopifyId: string | null;
  name: string;
  priceCents: number;
  imageUrl: string | null;
};
export type CheckoutItem = { id: string; name: string; priceCents: number; imageUrl: string | null; quantity: number };
export type CheckoutPrefill = {
  name?: string; email?: string; cpf?: string; phone?: string;
  address?: { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
};

// Recuperação: ?r=<orderId> -> carrega os itens e os dados do cliente salvos no
// pedido, para o cliente não precisar preencher tudo de novo.
async function getRecovery(storeId: string, orderId: string): Promise<{ items: CheckoutItem[]; prefill: CheckoutPrefill } | null> {
  const rows = await query<{ customerName: string | null; customerEmail: string | null; customerDocument: string | null; customerPhone: string | null; customerAddress: string | null }>(
    `SELECT customerName, customerEmail, customerDocument, customerPhone, customerAddress
     FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [orderId, storeId],
  );
  const o = rows[0];
  if (!o) return null;

  const its = await query<ProductRow & { quantity: number }>(
    `SELECT p.id, p.shopifyId, p.name, p.priceCents, p.imageUrl, oi.quantity
     FROM order_items oi JOIN products p ON p.id = oi.productId
     WHERE oi.orderId = ? AND p.active = 1`,
    [orderId],
  );
  const items: CheckoutItem[] = its.map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, imageUrl: p.imageUrl, quantity: p.quantity }));

  let address: CheckoutPrefill["address"];
  try {
    address = o.customerAddress ? JSON.parse(o.customerAddress) : undefined;
  } catch {
    address = undefined;
  }
  return {
    items,
    prefill: { name: o.customerName ?? "", email: o.customerEmail ?? "", cpf: o.customerDocument ?? "", phone: o.customerPhone ?? "", address },
  };
}

// Recuperação de LEAD (carrinho abandonado ?lead=<id>): reconstrói os itens a
// partir do snapshot (productId) revalidando preço/nome no BANCO (regra de ouro)
// e traz os dados de contato/entrega já preenchidos.
async function getLeadRecovery(storeId: string, leadId: string): Promise<{ items: CheckoutItem[]; prefill: CheckoutPrefill } | null> {
  const rows = await query<{ name: string | null; email: string | null; document: string | null; phone: string | null; address: string | null; itemsJson: string | null }>(
    `SELECT name, email, document, phone, address, itemsJson
     FROM abandoned_carts WHERE id = ? AND storeId = ? LIMIT 1`,
    [leadId, storeId],
  );
  const l = rows[0];
  if (!l) return null;

  let refs: { productId?: string; quantity?: number }[] = [];
  try {
    refs = l.itemsJson ? JSON.parse(l.itemsJson) : [];
  } catch {
    refs = [];
  }
  const ids = [...new Set(refs.map((r) => r.productId).filter(Boolean) as string[])];
  const items: CheckoutItem[] = [];
  if (ids.length) {
    const prods = await query<ProductRow>(
      `SELECT id, shopifyId, name, priceCents, imageUrl FROM products
       WHERE active = 1 AND storeId = ? AND id IN (${inPlaceholders(ids.length)})`,
      [storeId, ...ids],
    );
    const byId = new Map(prods.map((p) => [p.id, p]));
    for (const r of refs) {
      const p = r.productId ? byId.get(r.productId) : undefined;
      if (p) items.push({ id: p.id, name: p.name, priceCents: p.priceCents, imageUrl: p.imageUrl, quantity: Math.min(99, Math.max(1, Number(r.quantity) || 1)) });
    }
  }

  let address: CheckoutPrefill["address"];
  try {
    address = l.address ? JSON.parse(l.address) : undefined;
  } catch {
    address = undefined;
  }

  return {
    items,
    prefill: { name: l.name ?? "", email: l.email ?? "", cpf: l.document ?? "", phone: l.phone ?? "", address },
  };
}

// Primeiro produto ativo da loja (fallback quando não vem carrinho na URL).
async function getFirstProduct(storeId: string): Promise<ProductRow | null> {
  const rows = await query<ProductRow>(
    `SELECT id, shopifyId, name, priceCents, imageUrl FROM products
     WHERE active = 1 AND storeId = ? ORDER BY createdAt ASC LIMIT 1`,
    [storeId],
  );
  return rows[0] ?? null;
}

// Carrinho vindo da Shopify: ?items=<shopifyProductId>:<qty>,...
// Mapeia por shopifyId -> produto do VoxPay (preço do banco). Ignora itens não sincronizados.
async function getCartItems(storeId: string, raw: string): Promise<CheckoutItem[]> {
  const parsed = raw
    .split(",")
    .map((p) => p.split(":"))
    .filter(([id, q]) => id && Number(q) > 0)
    .map(([id, q]) => ({ shopifyId: id.trim(), quantity: Math.min(99, Math.max(1, parseInt(q, 10) || 1)) }));
  if (parsed.length === 0) return [];

  const ids = [...new Set(parsed.map((p) => p.shopifyId))];
  const rows = await query<ProductRow>(
    `SELECT id, shopifyId, name, priceCents, imageUrl FROM products
     WHERE active = 1 AND storeId = ? AND shopifyId IN (${inPlaceholders(ids.length)})`,
    [storeId, ...ids],
  );
  const byShopify = new Map(rows.map((r) => [r.shopifyId, r]));
  const items: CheckoutItem[] = [];
  for (const p of parsed) {
    const prod = byShopify.get(p.shopifyId);
    if (prod) items.push({ id: prod.id, name: prod.name, priceCents: prod.priceCents, imageUrl: prod.imageUrl, quantity: p.quantity });
  }
  return items;
}

// Título e favicon POR LOJA (aba do navegador) — resolvidos pelo domínio.
export async function generateMetadata(): Promise<Metadata> {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) return { title: "Checkout" };
  const [rawTheme, storeName] = await Promise.all([
    getCheckoutTheme(store.id),
    getStoreName(store.id),
  ]);
  const theme = mergeTheme(rawTheme);
  const title = theme.seo.title || storeName || "Checkout";
  const description = "Checkout Seguro";
  const images = theme.seo.faviconUrl ? [theme.seo.faviconUrl] : undefined;
  return {
    title,
    description,
    // `apple` junto com `icon`: é do apple-touch-icon que o WhatsApp tira a
    // miniatura quando não há og:image. Sem ele, o link da loja aparecia com o
    // ícone da plataforma.
    icons: theme.seo.faviconUrl ? { icon: theme.seo.faviconUrl, apple: theme.seo.faviconUrl } : undefined,
    openGraph: { title, description, siteName: title, images },
    twitter: { card: "summary", title, description, images },
  };
}

// Server component: resolve a loja pelo domínio e carrega a config DELA.
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ items?: string; r?: string; lead?: string }>;
}) {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) notFound();

  const { items: itemsParam, r, lead } = await searchParams;

  const [rawTheme, storeName, pixels, reviews, orderBumps, payCfg] = await Promise.all([
    getCheckoutTheme(store.id),
    getStoreName(store.id),
    getActivePixels(store.id),
    getActiveReviews(store.id),
    getActiveOrderBumps(store.id),
    getCheckoutPaymentConfig(store.id),
  ]);

  // Recuperação: ?r= (pedido pendente) ou ?lead= (carrinho abandonado).
  const recovery = r
    ? await getRecovery(store.id, r)
    : lead
    ? await getLeadRecovery(store.id, lead)
    : null;

  // Itens: recuperação > carrinho da Shopify (?items=) > primeiro produto.
  let items = recovery?.items ?? (itemsParam ? await getCartItems(store.id, itemsParam) : []);
  if (items.length === 0) {
    const p = await getFirstProduct(store.id);
    if (p) items = [{ id: p.id, name: p.name, priceCents: p.priceCents, imageUrl: p.imageUrl, quantity: 1 }];
  }

  const theme = mergeTheme(rawTheme);
  return (
    <>
      <PixelScripts pixels={pixels} />
      <CheckoutForm theme={theme} storeName={storeName} reviews={reviews} items={items} prefill={recovery?.prefill} orderBumps={orderBumps} pixels={pixels} paymentConfig={payCfg} />
    </>
  );
}
