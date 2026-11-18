import "server-only";
import crypto from "crypto";
import { getShopifyCredentials } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Shopify — as credenciais NÃO vêm mais do .env. São carregadas do
// banco (configuradas pelo admin no painel) e ficam criptografadas em repouso.
// Tudo server-side; nada de token no frontend.
// ─────────────────────────────────────────────────────────────────────────────

/** Chamada autenticada à Admin API da Shopify (carrega as credenciais da loja). */
export async function shopifyAdminFetch(
  storeId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const creds = await getShopifyCredentials(storeId);
  if (!creds) {
    throw new Error("Shopify não configurada. Configure no painel admin.");
  }
  return fetch(`https://${creds.domain}/admin/api/2024-10/${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": creds.adminToken,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Valida a assinatura HMAC de um webhook da Shopify (comparação timing-safe).
 * O `secret` é carregado das configurações pelo chamador (rota do webhook),
 * mantendo esta função pura e testável.
 */
export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): boolean {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth (instalação em 1 clique) — usado pelo endpoint de install/callback.
// ─────────────────────────────────────────────────────────────────────────────

/** Valida a assinatura HMAC dos parâmetros da query do OAuth da Shopify. */
export function verifyShopifyOAuthHmac(url: URL, apiSecret: string): boolean {
  const hmac = url.searchParams.get("hmac");
  if (!hmac) return false;
  const params: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (k !== "hmac" && k !== "signature") params.push([k, v]);
  });
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const message = params.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = crypto.createHmac("sha256", apiSecret).update(message).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(hmac);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Troca o `code` do OAuth por um Admin API access token permanente. */
export async function exchangeShopifyToken(
  shop: string,
  code: string,
  apiKey: string,
  apiSecret: string,
): Promise<string | null> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: apiKey, client_secret: apiSecret, code }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return typeof data.access_token === "string" ? data.access_token : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sincronização de produtos
// ─────────────────────────────────────────────────────────────────────────────

export type ShopifyProductNormalized = {
  shopifyId: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  active: boolean;
};

/** Normaliza um produto da Shopify (REST) para o formato local. */
export function normalizeShopifyProduct(p: any): ShopifyProductNormalized {
  const variant =
    Array.isArray(p?.variants) && p.variants.length ? p.variants[0] : null;
  const price = variant?.price ?? "0";
  const priceCents = Math.round(parseFloat(String(price)) * 100) || 0;
  const imageUrl =
    p?.image?.src ??
    (Array.isArray(p?.images) && p.images[0]?.src ? p.images[0].src : null);
  return {
    shopifyId: String(p?.id ?? ""),
    name: String(p?.title ?? "Produto").slice(0, 255),
    description: p?.body_html ? String(p.body_html) : null,
    priceCents,
    imageUrl: imageUrl ? String(imageUrl).slice(0, 512) : null,
    // "unlisted" = produto vendável por link/checkout direto (fora do catálogo
    // público) — muitos lojistas usam isso pra vender SÓ pelo nosso checkout.
    // Tratamos como ativo; só "draft"/"archived" ficam inativos.
    active: p?.status === "active" || p?.status === "unlisted",
  };
}

/** Extrai "products.json?...page_info=..." do Link header (rel="next"). */
function nextPageInfoPath(link: string | null): string {
  if (!link) return "";
  for (const part of link.split(",")) {
    if (part.includes('rel="next"')) {
      const m = part.match(/<([^>]+)>/);
      if (m && m[1].includes("products.json")) {
        return m[1].substring(m[1].indexOf("products.json"));
      }
    }
  }
  return "";
}

/** Busca TODOS os produtos da Shopify (paginação por cursor via Link header). */
export async function fetchAllShopifyProducts(storeId: string): Promise<ShopifyProductNormalized[]> {
  const out: ShopifyProductNormalized[] = [];
  let path = "products.json?limit=250";
  // Limite de segurança de páginas para não loopar indefinidamente.
  for (let page = 0; page < 50 && path; page++) {
    const res = await shopifyAdminFetch(storeId, path);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Shopify respondeu ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const products: any[] = Array.isArray(data?.products) ? data.products : [];
    for (const p of products) out.push(normalizeShopifyProduct(p));
    path = nextPageInfoPath(res.headers.get("link"));
  }
  return out;
}

/**
 * Importa TODOS os produtos da Shopify para o banco (upsert por shopifyId).
 * Retorna quantos foram sincronizados. Usado tanto pelo botão do painel quanto
 * automaticamente ao conectar a Shopify.
 */
export async function syncShopifyProductsToDb(storeId: string): Promise<number> {
  const { execute, newId } = await import("./db");
  const products = await fetchAllShopifyProducts(storeId);
  let synced = 0;
  for (const p of products) {
    if (!p.shopifyId) continue;
    await execute(
      `INSERT INTO products (id, storeId, shopifyId, name, description, priceCents, imageUrl, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         description = VALUES(description),
         priceCents = VALUES(priceCents),
         imageUrl = VALUES(imageUrl),
         active = VALUES(active),
         updatedAt = CURRENT_TIMESTAMP(3)`,
      [newId(), storeId, p.shopifyId, p.name, p.description, p.priceCents, p.imageUrl, p.active ? 1 : 0],
    );
    synced++;
  }
  return synced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Criação/atualização de pedidos na Shopify (repasse do checkout do VoxPay).
// ─────────────────────────────────────────────────────────────────────────────

const reais = (cents: number) => (cents / 100).toFixed(2);

// A Shopify IGNORA province_code na criação de pedidos/rascunhos e usa o NOME
// completo do estado (province). Mapeamos a UF -> nome para o estado não sumir.
const BR_STATES: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};

export type ShopifyLineItem = { title: string; priceCents: number; quantity: number };

/** Cria um pedido na Shopify. Retorna o id do pedido, ou null em caso de falha. */
export async function createShopifyOrder(
  storeId: string,
  input: {
    lineItems: ShopifyLineItem[];
    shippingCents: number;
    discountCents: number;
    customer: { name: string; email: string; phone: string };
    financialStatus: "pending" | "paid";
    note?: string;
  },
): Promise<string | null> {
  const parts = input.customer.name.trim().split(/\s+/);
  const firstName = parts[0] || input.customer.name;
  const lastName = parts.slice(1).join(" ") || ".";

  const subtotal = input.lineItems.reduce((s, li) => s + li.priceCents * li.quantity, 0);
  // Telefone vai em note_attributes (o customer.phone da Shopify é validado e
  // rejeita o pedido inteiro se o formato não agradar).
  const order: Record<string, unknown> = {
    line_items: input.lineItems.map((li) => ({
      title: li.title,
      price: reais(li.priceCents),
      quantity: li.quantity,
    })),
    email: input.customer.email,
    financial_status: input.financialStatus,
    currency: "BRL",
    customer: {
      first_name: firstName,
      last_name: lastName,
      email: input.customer.email,
    },
    note_attributes: [
      { name: "Telefone", value: input.customer.phone },
      { name: "Origem", value: "VoxPay" },
    ],
    tags: "VoxPay",
    note: input.note,
    send_receipt: false,
    send_fulfillment_receipt: false,
    inventory_behaviour: "bypass",
  };
  if (input.shippingCents > 0) {
    order.shipping_lines = [{ title: "Frete", price: reais(input.shippingCents) }];
  }
  const discount = Math.min(input.discountCents, subtotal); // nunca maior que o subtotal
  if (discount > 0) {
    order.discount_codes = [{ code: "DESCONTO", amount: reais(discount), type: "fixed_amount" }];
  }

  const res = await shopifyAdminFetch(storeId, "orders.json", {
    method: "POST",
    body: JSON.stringify({ order }),
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 400);
    throw new Error(`Shopify respondeu ${res.status}: ${body}`);
  }
  const data = await res.json().catch(() => ({}));
  return data?.order?.id ? String(data.order.id) : null;
}

/**
 * Marca um pedido da Shopify como PAGO. Busca o total pendente do próprio
 * pedido e cria uma transação de venda com esse valor exato — assim a Shopify
 * reconhece como quitado (evita ficar "pendente"/"parcialmente pago").
 */
export async function markShopifyOrderPaid(storeId: string, shopifyOrderId: string): Promise<void> {
  // 1) Lê o total do pedido (e evita repetir se já estiver pago).
  let amount: string | null = null;
  let currency = "BRL";
  const get = await shopifyAdminFetch(
    storeId,
    `orders/${shopifyOrderId}.json?fields=total_price,total_outstanding,currency,financial_status`,
  );
  if (get.ok) {
    const data = await get.json().catch(() => ({} as any));
    const o = data?.order;
    if (o?.financial_status === "paid") return; // idempotente
    amount = o?.total_outstanding || o?.total_price || null;
    currency = o?.currency || "BRL";
  }

  // 2) Pedidos criados via API já têm uma transação PENDENTE. Se existir, é
  // preciso CAPTURÁ-LA (kind=capture + parent_id); senão, cria uma "sale".
  let parentId: number | string | null = null;
  const txr = await shopifyAdminFetch(storeId, `orders/${shopifyOrderId}/transactions.json`);
  if (txr.ok) {
    const list = (await txr.json().catch(() => ({} as any)))?.transactions ?? [];
    const pending =
      list.find((t: any) => t.status === "pending") ??
      list.find((t: any) => t.kind === "authorization");
    if (pending) parentId = pending.id;
  }

  const transaction: Record<string, unknown> = parentId
    ? { kind: "capture", status: "success", parent_id: parentId, currency }
    : { kind: "sale", status: "success", currency };
  if (amount) transaction.amount = amount;

  const res = await shopifyAdminFetch(storeId, `orders/${shopifyOrderId}/transactions.json`, {
    method: "POST",
    body: JSON.stringify({ transaction }),
  });
  if (!res.ok) {
    console.error("[shopify markPaid]", res.status, (await res.text().catch(() => "")).slice(0, 300));
  }
}

/**
 * Grava o CPF/CNPJ do rascunho como localized field (TAX_CREDENTIAL_BR) via
 * GraphQL. Lojas do mercado Brasil EXIGEM esse campo para concluir o rascunho —
 * sem ele, a Shopify recusa com "Enter a valid CPF/CNPJ" e o pedido fica preso
 * como rascunho. Best-effort: loja sem mercado Brasil apenas ignora.
 */
export async function setDraftOrderTaxId(storeId: string, draftId: string, cpfDigits: string): Promise<void> {
  const query = `mutation($id: ID!, $input: DraftOrderInput!) {
    draftOrderUpdate(id: $id, input: $input) { userErrors { field message } }
  }`;
  const variables = {
    id: `gid://shopify/DraftOrder/${draftId}`,
    input: { localizedFields: [{ key: "TAX_CREDENTIAL_BR", value: cpfDigits }] },
  };
  const res = await shopifyAdminFetch(storeId, "graphql.json", {
    method: "POST",
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({} as any));
  const userErrors = data?.data?.draftOrderUpdate?.userErrors;
  if (!res.ok || data?.errors || (userErrors && userErrors.length)) {
    console.error("[shopify setDraftOrderTaxId]", res.status, JSON.stringify(data?.errors ?? userErrors ?? {}).slice(0, 300));
  }
}

/**
 * Cria um RASCUNHO de pedido (draft order) na Shopify. Aparece em Pedidos →
 * Rascunhos; ao pagar, é "completado" e vira um pedido PAGO. Este é o fluxo
 * suportado pela API (a criação de transações "sale" é bloqueada pela Shopify).
 */
export async function createShopifyDraftOrder(
  storeId: string,
  input: {
    lineItems: ShopifyLineItem[];
    shippingCents: number;
    discountCents: number;
    customer: { name: string; email: string; phone: string; document?: string };
    address?: {
      cep?: string;
      street?: string;
      number?: string;
      neighborhood?: string;
      complement?: string;
      city?: string;
      uf?: string;
    };
    note?: string;
  },
): Promise<string | null> {
  const parts = input.customer.name.trim().split(/\s+/);
  const firstName = parts[0] || input.customer.name;
  const lastName = parts.slice(1).join(" ") || ".";
  const subtotal = input.lineItems.reduce((s, li) => s + li.priceCents * li.quantity, 0);

  // Telefone em formato internacional (a Shopify valida o formato).
  const digits = (input.customer.phone || "").replace(/\D/g, "");
  const phoneIntl = digits ? `+55${digits.replace(/^55/, "")}` : undefined;

  const a = input.address;
  const hasAddress = !!(a && (a.cep || a.street || a.city));
  const uf = (a?.uf || "").toUpperCase();
  const addressBlock = hasAddress
    ? {
        first_name: firstName,
        last_name: lastName,
        address1: [a!.street, a!.number].filter(Boolean).join(", ") || undefined,
        address2: [a!.neighborhood, a!.complement].filter(Boolean).join(" - ") || undefined,
        city: a!.city || undefined,
        // province (nome completo) é o que a Shopify usa; province_code sozinho é ignorado.
        province: BR_STATES[uf] || undefined,
        province_code: uf || undefined,
        zip: a!.cep || undefined,
        country: "Brazil",
        country_code: "BR",
        phone: phoneIntl,
      }
    : undefined;

  const noteParts = [input.note ?? "VoxPay"];
  if (input.customer.document) noteParts.push(`CPF: ${input.customer.document}`);
  if (digits) noteParts.push(`Tel: ${input.customer.phone}`);

  const draft_order: Record<string, unknown> = {
    line_items: input.lineItems.map((li) => ({
      title: li.title,
      price: reais(li.priceCents),
      quantity: li.quantity,
    })),
    email: input.customer.email,
    customer: { first_name: firstName, last_name: lastName, email: input.customer.email },
    tags: "VoxPay",
    note: noteParts.join(" | "),
  };
  if (addressBlock) {
    draft_order.shipping_address = addressBlock;
    draft_order.billing_address = addressBlock;
  }
  if (input.shippingCents > 0) {
    draft_order.shipping_line = { title: "Frete", price: reais(input.shippingCents) };
  }
  const discount = Math.min(input.discountCents, subtotal);
  if (discount > 0) {
    draft_order.applied_discount = {
      title: "Desconto",
      value_type: "fixed_amount",
      value: reais(discount),
      amount: reais(discount),
    };
  }

  const res = await shopifyAdminFetch(storeId, "draft_orders.json", {
    method: "POST",
    body: JSON.stringify({ draft_order }),
  });
  if (!res.ok) {
    throw new Error(`Shopify draft respondeu ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
  }
  const data = await res.json().catch(() => ({}));
  const draftId = data?.draft_order?.id ? String(data.draft_order.id) : null;

  // Mercado Brasil: grava o CPF/CNPJ como localized field para o rascunho poder
  // virar pedido pago (senão a Shopify recusa a conclusão).
  if (draftId && input.customer.document) {
    const digits = input.customer.document.replace(/\D/g, "");
    if (digits.length === 11 || digits.length === 14) {
      try {
        await setDraftOrderTaxId(storeId, draftId, digits);
      } catch (e) {
        console.error("[shopify draft taxId]", e);
      }
    }
  }
  return draftId;
}

/**
 * Completa o rascunho, virando um PEDIDO real na aba Pedidos. Retorna o id do
 * pedido criado. `paymentPending=true` cria o pedido como "pagamento pendente"
 * (aguardando); false marca como PAGO.
 */
export async function completeShopifyDraftOrder(storeId: string, draftId: string, paymentPending = false): Promise<string | null> {
  const res = await shopifyAdminFetch(
    storeId,
    `draft_orders/${draftId}/complete.json?payment_pending=${paymentPending ? "true" : "false"}`,
    { method: "PUT" },
  );
  if (!res.ok) {
    throw new Error(`Shopify completar rascunho respondeu ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
  }
  const data = await res.json().catch(() => ({}));
  return data?.draft_order?.order_id ? String(data.draft_order.order_id) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout transparente — o botão "finalizar compra" da vitrine da Shopify passa
// a abrir o checkout próprio da loja (levando o carrinho).
//
// São DOIS caminhos independentes, de propósito:
//   1) ScriptTag (Admin API) — instalação em 1 clique, sem tocar no tema.
//   2) Snippet no tema publicado — sobrevive ao fim do ScriptTag e a qualquer
//      instabilidade da API.
// Basta um dos dois funcionar. A Shopify vai desligar o ScriptTag: a criação
// para em 01/10/2026 e a injeção na vitrine em 01/03/2027 — daí o caminho 2,
// que também não depende de nada externo continuar de pé.
// ─────────────────────────────────────────────────────────────────────────────

export const REDIRECT_PATH = "/shopify/redirect.js";

/**
 * `src` esperado do script, SEMPRE no domínio próprio (verificado) da loja.
 * Nunca no domínio da plataforma: um src apontando para uma URL de deploy morre
 * no deploy seguinte e derruba o checkout em silêncio.
 */
export function buildCheckoutSrc(customDomain: string): string {
  const checkoutUrl = `https://${customDomain}/checkout`;
  return `https://${customDomain}${REDIRECT_PATH}?to=${encodeURIComponent(checkoutUrl)}`;
}

/**
 * Compara dois `src` do redirect POR SIGNIFICADO, não por string.
 *
 * A Shopify normaliza a URL ao gravar o ScriptTag: o `?to=` volta decodificado
 * (`?to=https://loja.com/checkout` em vez de `?to=https%3A%2F%2F...`). Comparar
 * as strings direto dava "desatualizado" para sempre numa instalação correta —
 * e fazia cada clique em "Instalar" criar uma tag nova.
 */
export function sameCheckoutSrc(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return (
      ua.origin === ub.origin &&
      ua.pathname === ub.pathname &&
      ua.searchParams.get("to") === ub.searchParams.get("to")
    );
  } catch {
    return a === b;
  }
}

export type CheckoutScriptTag = { id: string; src: string };

/** ScriptTags nossos já presentes na loja (qualquer src, inclusive antigos). */
export async function listCheckoutScriptTags(storeId: string): Promise<CheckoutScriptTag[]> {
  const res = await shopifyAdminFetch(storeId, "script_tags.json?limit=250");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const tags: any[] = Array.isArray(data?.script_tags) ? data.script_tags : [];
  return tags
    .filter((t) => typeof t?.src === "string" && t.src.includes(REDIRECT_PATH))
    .map((t) => ({ id: String(t.id), src: String(t.src) }));
}

/** Remove ScriptTags do checkout (idempotência) e retorna quantos removeu. */
export async function removeCheckoutScriptTags(storeId: string): Promise<number> {
  const tags = await listCheckoutScriptTags(storeId);
  let removed = 0;
  for (const t of tags) {
    const del = await shopifyAdminFetch(storeId, `script_tags/${t.id}.json`, { method: "DELETE" });
    if (del.ok) removed++;
  }
  return removed;
}

/**
 * Instala (idempotente) o ScriptTag de redirecionamento.
 *
 * CRIA ANTES DE APAGAR. Na ordem inversa, um POST que falhasse deixaria a loja
 * sem redirect nenhum — e a partir de 01/10/2026 a Shopify passa a REJEITAR a
 * criação de script tags, então apagar primeiro seria irreversível.
 */
export async function installCheckoutScriptTag(storeId: string, src: string): Promise<void> {
  const existing = await listCheckoutScriptTags(storeId);

  // Já aponta para onde queremos: não gasta um POST à toa.
  if (!existing.some((t) => sameCheckoutSrc(t.src, src))) {
    const res = await shopifyAdminFetch(storeId, "script_tags.json", {
      method: "POST",
      body: JSON.stringify({
        script_tag: { event: "onload", src, display_scope: "online_store" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Falha ao instalar o checkout (${res.status}): ${t.slice(0, 200)}`);
    }
  }

  // Só agora, com o novo garantido, limpa os que apontam para outro lugar.
  for (const t of existing) {
    if (!sameCheckoutSrc(t.src, src)) {
      await shopifyAdminFetch(storeId, `script_tags/${t.id}.json`, { method: "DELETE" });
    }
  }
}

// ── Caminho 2: snippet no tema publicado ─────────────────────────────────────

const SNIPPET_NAME = "vox-checkout";
const SNIPPET_KEY = `snippets/${SNIPPET_NAME}.liquid`;
const LAYOUT_KEY = "layout/theme.liquid";
const MARK_START = "vox-checkout:start";
const MARK_END = "vox-checkout:end";

/** Bloco inserido no theme.liquid — delimitado para remoção cirúrgica. */
const LAYOUT_BLOCK =
  `{% comment %}${MARK_START}{% endcomment %}\n` +
  `{% render '${SNIPPET_NAME}' %}\n` +
  `{% comment %}${MARK_END}{% endcomment %}\n`;

const LAYOUT_BLOCK_RE = new RegExp(
  `\\{%-?\\s*comment\\s*-?%\\}${MARK_START}\\{%-?\\s*endcomment\\s*-?%\\}[\\s\\S]*?` +
    `\\{%-?\\s*comment\\s*-?%\\}${MARK_END}\\{%-?\\s*endcomment\\s*-?%\\}\\n?`,
  "g",
);

function snippetContent(src: string): string {
  // O src vai escapado: ele entra em um atributo HTML.
  const safe = src.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return (
    `{%- comment -%}\n` +
    `  Checkout próprio — redireciona o botão de finalizar compra.\n` +
    `  Gerado automaticamente. Para remover, use o painel (Shopify → Remover checkout).\n` +
    `{%- endcomment -%}\n` +
    `<script src="${safe}" defer></script>\n`
  );
}

/** Id do tema PUBLICADO (role "main"). Null se a API não responder. */
export async function getPublishedThemeId(storeId: string): Promise<string | null> {
  const res = await shopifyAdminFetch(storeId, "themes.json");
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const themes: any[] = Array.isArray(data?.themes) ? data.themes : [];
  const main = themes.find((t) => t?.role === "main");
  return main?.id ? String(main.id) : null;
}

async function getAsset(storeId: string, themeId: string, key: string): Promise<string | null> {
  const res = await shopifyAdminFetch(
    storeId,
    `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`,
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return typeof data?.asset?.value === "string" ? data.asset.value : null;
}

async function putAsset(storeId: string, themeId: string, key: string, value: string): Promise<void> {
  const res = await shopifyAdminFetch(storeId, `themes/${themeId}/assets.json`, {
    method: "PUT",
    body: JSON.stringify({ asset: { key, value } }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha ao gravar ${key} no tema (${res.status}): ${t.slice(0, 200)}`);
  }
}

export type SnippetState = { present: boolean; upToDate: boolean };

/** Se o snippet está no tema publicado e se aponta para o src esperado. */
export async function checkCheckoutThemeSnippet(storeId: string, src: string): Promise<SnippetState> {
  const themeId = await getPublishedThemeId(storeId);
  if (!themeId) return { present: false, upToDate: false };
  const layout = await getAsset(storeId, themeId, LAYOUT_KEY);
  if (!layout || !layout.includes(MARK_START)) return { present: false, upToDate: false };
  const snippet = await getAsset(storeId, themeId, SNIPPET_KEY);
  // Compara o src de dentro do snippet, não o arquivo inteiro: o comentário no
  // topo pode mudar sem que o destino tenha mudado.
  const found = snippet?.match(/<script\s+src="([^"]+)"/i)?.[1];
  const current = found ? found.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<") : null;
  return { present: true, upToDate: Boolean(current && sameCheckoutSrc(current, src)) };
}

/**
 * Instala o snippet no tema PUBLICADO: grava snippets/vox-checkout.liquid e
 * insere `{% render %}` antes de </head> no layout. Idempotente — se o bloco já
 * está lá, só atualiza o snippet (não mexe no layout).
 */
export async function installCheckoutThemeSnippet(storeId: string, src: string): Promise<void> {
  const themeId = await getPublishedThemeId(storeId);
  if (!themeId) throw new Error("Não foi possível identificar o tema publicado da loja.");

  // Confere o layout ANTES de gravar o snippet: se a inserção não for possível,
  // não deixa para trás um snippet órfão que ninguém chama (foi o que aconteceu
  // quando a etapa do theme.liquid falhava depois da gravação do arquivo).
  const layout = await getAsset(storeId, themeId, LAYOUT_KEY);
  if (layout === null) throw new Error("não foi possível ler o layout/theme.liquid do tema publicado");
  const already = layout.includes(MARK_START);
  const head = layout.lastIndexOf("</head>");
  if (!already && head === -1) {
    throw new Error("o layout/theme.liquid do tema publicado não tem </head>");
  }

  await putAsset(storeId, themeId, SNIPPET_KEY, snippetContent(src));

  if (already) return; // o {% render %} já está lá; só o snippet foi atualizado
  await putAsset(storeId, themeId, LAYOUT_KEY, layout.slice(0, head) + LAYOUT_BLOCK + layout.slice(head));
}

/** Tira o snippet do tema publicado (bloco do layout + arquivo do snippet). */
export async function removeCheckoutThemeSnippet(storeId: string): Promise<boolean> {
  const themeId = await getPublishedThemeId(storeId);
  if (!themeId) return false;
  let changed = false;

  const layout = await getAsset(storeId, themeId, LAYOUT_KEY);
  if (layout && LAYOUT_BLOCK_RE.test(layout)) {
    LAYOUT_BLOCK_RE.lastIndex = 0;
    await putAsset(storeId, themeId, LAYOUT_KEY, layout.replace(LAYOUT_BLOCK_RE, ""));
    changed = true;
  }
  LAYOUT_BLOCK_RE.lastIndex = 0;

  const del = await shopifyAdminFetch(
    storeId,
    `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(SNIPPET_KEY)}`,
    { method: "DELETE" },
  );
  if (del.ok) changed = true;
  return changed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro de webhooks
// ─────────────────────────────────────────────────────────────────────────────

export type WebhookRegisterResult = {
  created: string[];
  existing: string[];
  errors: { topic: string; error: string }[];
};

/**
 * Registra os webhooks na Shopify de forma idempotente: lista os existentes e
 * só cria os que faltam (mesmo topic + address). Retorna um resumo.
 */
export async function registerShopifyWebhooks(
  storeId: string,
  address: string,
  topics: string[],
): Promise<WebhookRegisterResult> {
  const listRes = await shopifyAdminFetch(storeId, "webhooks.json?limit=250");
  if (!listRes.ok) {
    const t = await listRes.text().catch(() => "");
    throw new Error(`Falha ao listar webhooks (${listRes.status}): ${t.slice(0, 200)}`);
  }
  const listData = await listRes.json();
  const existingWebhooks: any[] = Array.isArray(listData?.webhooks) ? listData.webhooks : [];
  const have = new Set(existingWebhooks.map((w) => `${w.topic}|${w.address}`));

  const created: string[] = [];
  const existing: string[] = [];
  const errors: { topic: string; error: string }[] = [];

  for (const topic of topics) {
    if (have.has(`${topic}|${address}`)) {
      existing.push(topic);
      continue;
    }
    const res = await shopifyAdminFetch(storeId, "webhooks.json", {
      method: "POST",
      body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
    });
    if (res.ok) {
      created.push(topic);
    } else {
      const t = await res.text().catch(() => "");
      errors.push({ topic, error: `${res.status}: ${t.slice(0, 150)}` });
    }
  }
  return { created, existing, errors };
}
