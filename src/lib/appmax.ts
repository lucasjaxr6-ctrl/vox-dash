import "server-only";
import crypto from "crypto";
import { getAppmaxCredentials } from "./settings";
import { appmaxEnv } from "./appmax-partner";
import { comoHorarioDeBrasilia } from "./datas";
import type { PixCharge, PixCustomer } from "./pix-types";

/**
 * SKU ESTÁVEL e ÚNICO POR PRODUTO. A Appmax indexa produto por SKU: o primeiro
 * pedido cria a entrada no catálogo dela e os seguintes reaproveitam o cadastro
 * daquele SKU. Então o SKU tem que ser 1-para-1 com o nosso produto.
 *
 * Derivamos do id do produto, não do nome. Derivar do NOME parecia equivalente,
 * mas não é: duas máscaras iguais — ou uma máscara igual ao nome real de outro
 * produto do mesmo catálogo — colapsam no MESMO SKU, e aí um pedido aparece no
 * painel da Appmax com o nome de outro produto. O id não colide nunca e também
 * não vaza nada (é opaco). Mantém o formato P+20hex dos SKUs antigos.
 */
export function skuFromProductId(productId: string): string {
  return "P" + crypto.createHash("sha1").update(`produto:${productId}`).digest("hex").slice(0, 20);
}

/** Fallback para linhas sem productId (ex.: pedido consolidado, sem itens). */
export function skuFromName(name: string): string {
  return "P" + crypto.createHash("sha1").update((name || "item").trim().toLowerCase()).digest("hex").slice(0, 20);
}

// ─────────────────────────────────────────────────────────────────────────────
// Integração Appmax (Pix + cartão TRANSPARENTE — sem redirect).
//
// Autenticação: OAuth2 client_credentials. As credenciais do merchant
// (client_id/client_secret) ficam CRIPTOGRAFADAS por loja; trocamos por um
// access_token Bearer de ~1h, que é cacheado em memória por loja.
//
// Fluxo de cobrança: criar cliente -> criar pedido -> pagar (pix | cartão).
// O status é lido em GET /v1/orders/{id} (por isso guardamos o id do PEDIDO
// Appmax como providerTxnId).
// ─────────────────────────────────────────────────────────────────────────────

// Cache do token por loja (evita um round-trip de auth a cada cobrança).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getToken(storeId: string): Promise<{ token: string; api: string; externalId: string | null }> {
  const creds = await getAppmaxCredentials(storeId);
  if (!creds) throw new Error("Appmax não conectada. Instale o app Appmax no painel (aba Appmax → Conectar).");
  const env = appmaxEnv(creds.sandbox);

  const cached = tokenCache.get(storeId);
  if (cached && cached.expiresAt > Date.now()) return { token: cached.token, api: env.api, externalId: creds.externalId };

  const res = await fetch(env.auth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data?.access_token) {
    throw new Error(`Falha na autenticação da Appmax: ${data?.message || data?.error || res.status}`);
  }
  // Renova 60s antes de expirar, por segurança.
  const ttl = Math.max(60, Number(data.expires_in) || 3600) - 60;
  tokenCache.set(storeId, { token: String(data.access_token), expiresAt: Date.now() + ttl * 1000 });
  return { token: String(data.access_token), api: env.api, externalId: creds.externalId };
}

async function api(storeId: string, path: string, init?: RequestInit): Promise<{ res: Response; data: any }> {
  const { token, api: base, externalId } = await getToken(storeId);
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      accept: "application/json",
      // Identifica o MERCHANT/loja (obrigatório no app parceiro).
      ...(externalId ? { "external-id": externalId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({} as any));
  return { res, data };
}

/** Mensagem de erro legível a partir da resposta da Appmax. */
function apiError(prefix: string, res: Response, data: any): Error {
  const detail =
    data?.message ||
    data?.error?.message ||
    (data?.errors ? JSON.stringify(data.errors).slice(0, 200) : "") ||
    `HTTP ${res.status}`;
  console.error("[appmax]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  return new Error(`${prefix}: ${detail}`);
}

/**
 * Mapeia o status da Appmax para o vocabulário interno.
 *
 * Os quatro estados de PAGO, conforme a tabela de status da doc deles:
 *   aprovado                       "Pagamento confirmado" — o valor caiu
 *   integrado                      aprovado + validações concluídas
 *   pendente_integracao            "PAGO, integração pendente"
 *   pendente_integracao_em_analise "aprovado, com pedido de estorno em análise"
 *
 * Os dois `pendente_integracao*` caíam no `default` e viravam PENDING. O nome
 * engana: o "pendente" é da INTEGRAÇÃO, não do pagamento. Uma venda de Pix
 * parada nesse estado aparecia paga no painel da Appmax e pendente aqui, para
 * sempre — dinheiro recebido e pedido nunca separado.
 *
 * `pendente_integracao_em_analise` entra como pago porque o dinheiro entrou; se
 * o estorno for aprovado depois, chega `estornado` e o pedido é revertido.
 *
 * Segue PENDING de propósito: `pendente` (Pix ainda não pago), `autorizado`
 * (cartão só autorizado, em análise antifraude) e os chargebacks em tratativa
 * ou disputa — PENDING não dispara transição, então é um no-op seguro.
 */
export function normalizeAppmaxStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "aprovado":
    case "integrado":
    case "pendente_integracao":
    case "pendente_integracao_em_analise":
      return "APPROVED";
    case "estornado":
      return "REFUNDED";
    case "chargeback_perdido":
      return "CHARGEBACK";
    case "cancelado":
    case "recusado_por_risco":
      return "DECLINED";
    default:
      return "PENDING";
  }
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };

/** Cria (ou atualiza) o cliente na Appmax e devolve o customer_id. */
async function createCustomer(
  storeId: string,
  customer: PixCustomer,
  opts: { ip?: string; address?: Address },
): Promise<number> {
  const parts = (customer.name || "").trim().split(/\s+/);
  const body: Record<string, unknown> = {
    first_name: parts[0] || customer.name,
    last_name: parts.slice(1).join(" ") || ".",
    email: customer.email,
    phone: (customer.phone || "").replace(/\D/g, ""),
    document_number: (customer.document || "").replace(/\D/g, ""),
    // A Appmax exige o IP de origem (antifraude).
    ip: opts.ip || "0.0.0.0",
  };
  const a = opts.address;
  if (a && (a.cep || a.street)) {
    body.address = {
      postcode: (a.cep || "").replace(/\D/g, ""),
      street: a.street,
      number: a.number,
      complement: a.complement || undefined,
      district: a.neighborhood,
      city: a.city,
      state: a.uf,
    };
  }

  const { res, data } = await api(storeId, "/v1/customers", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw apiError("Falha ao criar o cliente na Appmax", res, data);
  const id = data?.data?.customer?.id ?? data?.customer?.id ?? data?.id;
  if (!id) throw new Error("Appmax não retornou o id do cliente.");
  return Number(id);
}

export type AppmaxOrderLine = { name: string; quantity: number; unitPriceCents: number; productId?: string };

/**
 * Cria o pedido na Appmax. Quando recebe os itens reais, envia a lista com nome
 * (mascarado, se houver), quantidade e preço unitário + frete separado; o
 * DESCONTO é derivado para que "produtos - desconto + frete" bata EXATAMENTE com
 * amountCents (regra de ouro — absorve cupom + desconto Pix + arredondamento).
 * Sem itens, cai no fallback de um produto consolidado.
 */
async function createOrder(
  storeId: string,
  customerId: number,
  amountCents: number,
  description: string,
  opts?: { items?: AppmaxOrderLine[]; shippingCents?: number },
): Promise<number> {
  const total = Math.round(amountCents);
  const shipping = Math.max(0, Math.round(opts?.shippingCents ?? 0));
  const lines = (opts?.items ?? []).filter((it) => it.quantity > 0 && it.unitPriceCents >= 0);

  let products: Record<string, unknown>[];
  let productsValue: number;
  let discount: number;
  if (lines.length) {
    products = lines.map((it) => ({
      sku: it.productId ? skuFromProductId(it.productId) : skuFromName(it.name),
      name: (it.name || "Item").slice(0, 120),
      quantity: it.quantity,
      unit_value: Math.round(it.unitPriceCents),
      type: "physical",
    }));
    productsValue = lines.reduce((s, it) => s + Math.round(it.unitPriceCents) * it.quantity, 0);
    // diff < 0: sobra (cupom/desconto Pix) -> vira discount_value.
    // diff > 0: falta (juros de parcelamento repassados). A Appmax não tem campo
    // de acréscimo, então EMBUTIMOS o juros no valor do produto (no 1º item). Um
    // eventual resto de arredondamento (só se quantidade > 1) vira desconto de
    // centavos. Assim o total sempre bate EXATO (regra de ouro).
    const diff = total - shipping - productsValue;
    if (diff < 0) {
      discount = -diff;
    } else if (diff > 0) {
      const first = products[0] as { quantity: number; unit_value: number };
      const addPerUnit = Math.ceil(diff / first.quantity);
      first.unit_value += addPerUnit;
      const added = addPerUnit * first.quantity;
      productsValue += added;
      discount = added - diff; // 0 quando a quantidade do 1º item é 1
    } else {
      discount = 0;
    }
  } else {
    // Fallback: um produto consolidado cujo unit_value já é o total.
    products = [{ sku: skuFromName(description || "Pedido"), name: (description || "Pedido").slice(0, 120), quantity: 1, unit_value: total, type: "physical" }];
    productsValue = total;
    discount = 0;
  }

  // REGISTRO DO QUE SAIU DAQUI.
  //
  // Sem isto, "a máscara não pegou" vira palavra contra palavra: o painel da
  // Appmax mostra um nome, o nosso banco mostra outro, e não há como saber qual
  // deles nós mandamos. O `sku` é hash do nome enviado, então o par nome+sku
  // identifica a origem sem ambiguidade — inclusive distinguindo pedido criado
  // por nós de pedido que a Appmax ingeriu por outro caminho (Shopify).
  console.log(
    "[appmax] itens enviados:",
    JSON.stringify(products.map((p) => ({ sku: p.sku, name: p.name }))),
  );

  const body = {
    customer_id: customerId,
    products,
    products_value: productsValue,
    discount_value: discount,
    shipping_value: lines.length ? shipping : 0,
  };
  const { res, data } = await api(storeId, "/v1/orders", { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw apiError("Falha ao criar o pedido na Appmax", res, data);
  const id = data?.data?.order?.id ?? data?.order?.id ?? data?.data?.id ?? data?.id;
  if (!id) throw new Error("Appmax não retornou o id do pedido.");
  // O id fecha o par com o log acima: dado um pedido no painel deles, dá para
  // achar exatamente quais nomes saíram daqui.
  console.log("[appmax] pedido criado:", id);
  return Number(id);
}

/** Procura o copia-e-cola do Pix na resposta. A Appmax devolve em
 *  data.payment.pix_emv (o EMV), com a imagem em pix_qrcode e a validade em
 *  pix_expiration_date. Mantém fallbacks por garantia. */
function extractPix(data: any): { qrCode: string; expiresAt: string | null } {
  const p = data?.data?.payment ?? data?.payment ?? data?.data?.pix ?? data?.pix ?? data?.data ?? data ?? {};
  const qrCode = String(
    p.pix_emv ?? p.emv ?? p.qr_code ?? p.qrcode ?? p.copy_paste ?? p.qr_code_emv ?? "",
  );
  // A Appmax manda "Y-m-d H:i:s" no fuso de SÃO PAULO (está na doc do Pix).
  // Sem carimbar o fuso, o servidor lia como UTC e o Pix nascia vencido —
  // 306 de 307 cobranças. Ver src/lib/datas.ts.
  const exp = p.pix_expiration_date ?? p.expiration_date ?? p.expires_at ?? p.expiration ?? null;
  return { qrCode, expiresAt: exp ? comoHorarioDeBrasilia(String(exp)) : null };
}

/** Cria uma cobrança Pix na Appmax (cliente + pedido + pagamento). */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    items?: AppmaxOrderLine[];
    shippingCents?: number;
  },
): Promise<PixCharge> {
  const customerId = await createCustomer(storeId, input.customer, { ip: input.payerIp, address: input.address });
  const orderId = await createOrder(storeId, customerId, input.amountCents, input.description || "Pedido", {
    items: input.items,
    shippingCents: input.shippingCents,
  });

  const { res, data } = await api(storeId, "/v1/payments/pix", {
    method: "POST",
    body: JSON.stringify({
      order_id: orderId,
      payment_data: { pix: { document_number: (input.customer.document || "").replace(/\D/g, "") } },
    }),
  });
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const { qrCode, expiresAt } = extractPix(data);
  if (!qrCode) throw new Error("Appmax não retornou o código Pix (copia e cola).");
  return {
    id: String(orderId), // status é consultado pelo id do PEDIDO
    status: "PENDING",
    qrCode,
    qrCodeUrl: null, // o checkout gera a imagem a partir do copia-e-cola
    expiresAt,
  };
}

export type AppmaxCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO (transparente). Aceita `token` (tokenização no navegador,
 * quando disponível) OU os dados do cartão — nesse caso eles apenas trafegam por
 * aqui em memória, via TLS, e NUNCA são gravados nem logados.
 */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    payerIp?: string;
    address?: Address;
    softDescriptor?: string;
    items?: AppmaxOrderLine[];
    shippingCents?: number;
    card: {
      token?: string;
      number?: string;
      cvv?: string;
      expirationMonth?: string;
      expirationYear?: string;
      holderName?: string;
      holderDocument?: string;
    };
  },
): Promise<AppmaxCardResult> {
  const customerId = await createCustomer(storeId, input.customer, { ip: input.payerIp, address: input.address });
  const orderId = await createOrder(storeId, customerId, input.amountCents, input.description || "Pedido", {
    items: input.items,
    shippingCents: input.shippingCents,
  });

  const cc: Record<string, unknown> = {
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
  };
  if (input.card.token) {
    cc.token = input.card.token;
  } else {
    cc.number = (input.card.number || "").replace(/\D/g, "");
    cc.cvv = input.card.cvv;
    cc.expiration_month = input.card.expirationMonth;
    cc.expiration_year = input.card.expirationYear;
    cc.holder_name = input.card.holderName;
  }
  cc.holder_document_number = (input.card.holderDocument || input.customer.document || "").replace(/\D/g, "");
  if (input.softDescriptor) cc.soft_descriptor = input.softDescriptor.slice(0, 22);

  const { res, data } = await api(storeId, "/v1/payments/credit-card", {
    method: "POST",
    body: JSON.stringify({ order_id: orderId, customer_id: customerId, payment_data: { credit_card: cc } }),
  });
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const raw = String(data?.data?.order?.status ?? data?.order?.status ?? data?.data?.status ?? data?.status ?? "");
  // Se a resposta não trouxer status, consultamos o pedido (fonte da verdade).
  const status = raw ? normalizeAppmaxStatus(raw) : ((await getAppmaxOrderStatus(storeId, String(orderId))) ?? "PENDING");
  return { id: String(orderId), status, statusDetail: raw };
}

/**
 * Grava o código de rastreio num pedido da Appmax. A Appmax EXIGE o tracking nos
 * pedidos para liberar os saques do merchant, então isso não é só cosmético.
 * Best-effort e à prova de formato: só tenta se o id for numérico (id de pedido
 * Appmax) e a loja estiver conectada; nunca lança. Retorna {ok,error}.
 * Docs: POST /v1/orders/shipping-tracking-code { order_id, shipping_tracking_code }
 */
export async function setAppmaxTrackingCode(
  storeId: string,
  appmaxOrderId: string,
  trackingCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const code = (trackingCode || "").trim();
  if (!/^\d+$/.test(appmaxOrderId) || !code) return { ok: false, error: "id/código inválido" };
  try {
    const { res, data } = await api(storeId, "/v1/orders/shipping-tracking-code", {
      method: "POST",
      body: JSON.stringify({ order_id: Number(appmaxOrderId), shipping_tracking_code: code }),
    });
    if (!res.ok) return { ok: false, error: data?.message || data?.error?.message || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha" };
  }
}

/** Consulta o status normalizado de um pedido da Appmax (ou null). */
export async function getAppmaxOrderStatus(storeId: string, orderId: string): Promise<string | null> {
  try {
    const { res, data } = await api(storeId, `/v1/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) return null;
    const o = data?.data?.order ?? data?.data ?? data?.order ?? data ?? {};
    const status = typeof o.status === "string" ? o.status : "";
    // O sinal de PAGO é o STATUS (aprovado/integrado). ATENÇÃO: total_paid NÃO
    // serve — ele traz o valor do pedido mesmo SEM pagamento (dá falso positivo).
    return status ? normalizeAppmaxStatus(status) : null;
  } catch {
    return null;
  }
}

/**
 * Diagnóstico: o pedido CRU da Appmax, sem tradução nenhuma.
 *
 * Existe porque o status normalizado esconde a diferença entre `cancelado` (o
 * Pix venceu) e `recusado_por_risco` (o antifraude barrou) — os dois viram
 * "DECLINED", e a conversa com o suporte deles depende de saber qual foi.
 * Traz também os sinais de pagamento, para confrontar quando o painel deles
 * mostra uma coisa e a API responde outra.
 */
export async function getAppmaxOrderRaw(
  storeId: string,
  orderId: string,
): Promise<Record<string, unknown>> {
  const { res, data } = await api(storeId, `/v1/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) throw apiError("Falha ao consultar o pedido na Appmax", res, data);
  const d = data?.data ?? data ?? {};
  const o = d.order ?? d ?? {};
  const p = d.payment ?? o.payment ?? {};
  return {
    status: o.status ?? null,
    // ATENÇÃO: `total_paid` NÃO prova pagamento — a Appmax preenche com o valor
    // do pedido mesmo sem ter recebido. Vale só como contexto.
    total_paid: o.total_paid ?? null,
    amounts: o.amounts ?? null,
    payment_method: p.method ?? null,
    paid_at: p.paid_at ?? null,
    refunded_at: d.refund?.refunded_at ?? null,
    created_at: o.created_at ?? null,
    updated_at: o.updated_at ?? null,
  };
}

export type AppmaxCatalogItem = { id: number; sku: string; name: string };

/**
 * Diagnóstico: lê o CATÁLOGO de produtos da loja na Appmax (GET /v1/products).
 *
 * Existe porque o painel deles não mostra o SKU e o GET do pedido não devolve os
 * itens — então esta é a única forma de ver que nome a Appmax guardou. Como o
 * nosso `sku` é hash do nome que enviamos, o par (sku, name) do catálogo diz se
 * o nome exibido veio de nós ou entrou por outra porta.
 *
 * Paginado em 20 por página; `maxPages` limita para não varrer catálogo grande.
 */
export async function listAppmaxProducts(
  storeId: string,
  maxPages = 25,
): Promise<{ items: AppmaxCatalogItem[]; truncado: boolean }> {
  const items: AppmaxCatalogItem[] = [];
  let page = 1;
  let lastPage = 1;
  for (; page <= maxPages; page++) {
    const { res, data } = await api(storeId, `/v1/products?status=all&page=${page}`);
    if (!res.ok) throw apiError("Falha ao listar os produtos na Appmax", res, data);
    const lote = data?.data?.products ?? data?.data ?? data?.products ?? [];
    if (!Array.isArray(lote) || lote.length === 0) break;
    for (const p of lote) {
      items.push({ id: Number(p?.id ?? 0), sku: String(p?.sku ?? ""), name: String(p?.name ?? "") });
    }
    lastPage = Number(data?.data?.pagination?.last_page ?? data?.pagination?.last_page ?? page);
    if (page >= lastPage) break;
  }
  return { items, truncado: page >= maxPages && page < lastPage };
}
