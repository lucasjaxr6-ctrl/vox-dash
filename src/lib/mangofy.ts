import "server-only";
import { getMangofyCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração MangoFy — Pix + cartão.
//
// Auth: dois headers em toda chamada — `Authorization: <API Key>` (a chave
// PURA, sem "Bearer") e `Store-Code: <código da loja>`.
//
// Endpoints por método: POST /api/v1/payment/pix e /credit-card. Consulta em
// GET /api/v1/payment/{payment_code}. Valores em centavos.
//
// Limites do contrato deles (OpenAPI): payment_amount de 500 a 200.000
// (R$ 5 a R$ 2.000) e frete até 20.000 (R$ 200). Checamos antes de chamar, com
// mensagem clara, em vez de deixar virar um 422 genérico.
//
// O IP do comprador é OBRIGATÓRIO em `customer.ip` (e o telefone também).
//
// Cartão cru (server-to-server), como Appmax/BlackCat — nunca gravado nem
// logado. Recusa volta como HTTP 400 com o pagamento no corpo e o motivo em
// `card.card_rejected`.
//
// Webhook SEM assinatura: o corpo só aponta o pagamento; o status vem do GET,
// com a chave da loja. Reenviam até 4 vezes (4, 16, 64, 256 min).
//
// `external_code` leva sufixo por tentativa (`<orderId>.<base36>`): a doc cita
// PaymentAlreadyProcessedException para código repetido, e a renovação de Pix
// cria uma cobrança nova para o mesmo pedido.
//
// Doc: https://app.mangofy.com.br/checkout/doc (OpenAPI embutido no HTML)
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://checkout.mangofy.com.br";
export const MANGOFY_MIN_CENTS = 500;
export const MANGOFY_MAX_CENTS = 200_000;
const FRETE_MAX_CENTS = 20_000;

/** Status do pagamento → vocabulário interno. */
export function normalizeMangofyStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "APPROVED";
    // Estorno parcial: o pedido continua pago. Só o total desfaz a venda.
    case "partial_refunded":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "charge_back":
      return "CHARGEBACK";
    // expired no Pix = venceu sem pagar: o settle não cancela pedido Pix.
    case "refused":
    case "canceled":
    case "cancelled":
    case "canceled_antifraud":
    case "expired":
    case "gateway_error":
    case "system_error":
      return "DECLINED";
    // pending, in_process, in_review, review_question, refunded_requested,
    // charge_back_requested, in_dispute, refunded_error: não mudam o pedido.
    default:
      return "PENDING";
  }
}

async function chamar(storeId: string, caminho: string, body?: unknown) {
  const creds = await getMangofyCredentials(storeId);
  if (!creds) throw new Error("MangoFy não configurada. Informe a API Key e o Store Code no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: creds.apiKey,
      "Store-Code": creds.storeCode,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Erros: `{ message }`, `{ message, errors: { campo: [..] } }` ou `{ status:"error", message }`. */
function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[mangofy]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  const campos = data?.errors && typeof data.errors === "object"
    ? Object.entries(data.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ")
    : "";
  const status = typeof data?.payment_status === "string" ? `status ${data.payment_status}` : "";
  const detalhe = [typeof data === "string" ? data : data?.message, campos, status].filter(Boolean).join(" — ");
  return new Error(`${prefix}: ${detalhe || "sem detalhe"} [HTTP ${res.status}]`);
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
type Item = { name: string; quantity: number; unitPriceCents: number; code?: string };

function cliente(c: PixCustomer, ip: string | undefined, a: Address | undefined) {
  let tel = (c.phone || "").replace(/\D/g, "");
  // O exemplo deles manda com DDI (5511…): completamos quando vier sem.
  if (tel.length === 10 || tel.length === 11) tel = `55${tel}`;
  const cep = (a?.cep || "").replace(/\D/g, "");
  return {
    name: (c.name || "").trim().slice(0, 254),
    email: (c.email || "").trim().slice(0, 254),
    document: (c.document || "").replace(/\D/g, "").slice(0, 14),
    phone: tel.slice(0, 20),
    ip: (ip || "").slice(0, 100),
    ...(a?.street ? { street: a.street.trim().slice(0, 254) } : {}),
    ...(a?.number ? { street_number: a.number.trim().slice(0, 254) } : {}),
    ...(a?.complement?.trim() ? { complement: a.complement.trim().slice(0, 254) } : {}),
    ...(a?.neighborhood ? { neighborhood: a.neighborhood.trim().slice(0, 254) } : {}),
    ...(a?.city ? { city: a.city.trim().slice(0, 254) } : {}),
    ...(a?.uf ? { state: a.uf.trim().toUpperCase().slice(0, 254) } : {}),
    ...(cep.length === 8 ? { zip_code: cep, country: "BR" } : {}),
  };
}

/**
 * Itens + frete.
 *
 * A doc não diz se `payment_amount` precisa bater com a soma dos itens. Para
 * não depender disso, os itens só vão detalhados quando a conta fecha
 * exatamente (produtos + frete = total); senão vai um item único com o total
 * e frete zero — nunca uma combinação que possa ser lida como "cobrar a mais".
 */
function itensEFrete(amountCents: number, items: Item[] | undefined, shippingCents: number | undefined, descricao: string, fisico: boolean) {
  const total = Math.round(amountCents);
  const frete = Math.max(0, Math.round(shippingCents ?? 0));
  const lista = (items ?? []).map((it, i) => ({
    code: (it.code || `item-${i + 1}`).slice(0, 100),
    name: (it.name || "Item").slice(0, 254),
    quantity: it.quantity,
    price: Math.round(it.unitPriceCents),
    digital_flag: !fisico,
  }));
  const fecha = lista.length > 0 && frete <= FRETE_MAX_CENTS && lista.reduce((s, i) => s + i.price * i.quantity, 0) + frete === total;
  return fecha
    ? { items: lista, shipping_amount: frete }
    : { items: [{ code: "pedido", name: descricao.slice(0, 254) || "Pedido", quantity: 1, price: total, digital_flag: !fisico }], shipping_amount: 0 };
}

/** `<orderId>.<sufixo>`: único por tentativa; o orderId sai do começo. */
const externalCode = (orderId: string | undefined) => `${orderId || "pedido"}.${Date.now().toString(36)}`.slice(0, 100);
export const pedidoDoExternalCode = (ext: string) => ext.split(".")[0] || "";

function conferirValor(amountCents: number) {
  const v = Math.round(amountCents);
  // Nesta forma o comprador vê o teto (ver motivoDeLimite em customer-errors).
  if (v > MANGOFY_MAX_CENTS) {
    const teto = (MANGOFY_MAX_CENTS / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    throw new Error(`Valor máximo por transação na MangoFy: R$ ${teto} (pedido de R$ ${(v / 100).toFixed(2)}).`);
  }
  if (v < MANGOFY_MIN_CENTS) {
    throw new Error(
      `MangoFy só aceita cobranças entre R$ ${(MANGOFY_MIN_CENTS / 100).toFixed(2)} e R$ ${(MANGOFY_MAX_CENTS / 100).toFixed(2)} (pedido de R$ ${(v / 100).toFixed(2)}).`,
    );
  }
}

type Base = {
  amountCents: number;
  customer: PixCustomer;
  description?: string;
  externalReference?: string;
  postbackUrl?: string;
  payerIp?: string;
  userAgent?: string;
  address?: Address;
  shippingCents?: number;
  items?: Item[];
  tracking?: Record<string, string | null | undefined>;
};

function corpoBase(input: Base) {
  const fisico = !!(input.address?.street && input.address?.cep);
  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.tracking ?? {})) {
    if (/^utm_/.test(k) && typeof v === "string" && v.trim()) meta[k] = v.trim().slice(0, 255);
  }
  if (input.externalReference) meta.pedido = input.externalReference;
  return {
    external_code: externalCode(input.externalReference),
    payment_format: "regular",
    payment_amount: Math.round(input.amountCents),
    ...itensEFrete(input.amountCents, input.items, input.shippingCents, input.description || "Pedido", fisico),
    ...(input.postbackUrl ? { postback_url: input.postbackUrl } : {}),
    customer: cliente(input.customer, input.payerIp, input.address),
    extra: {
      ...(input.userAgent ? { user_agent: input.userAgent.slice(0, 500) } : {}),
      ...(Object.keys(meta).length ? { metadata: meta } : {}),
    },
  };
}

/** Cria um Pix. */
export async function createPixCharge(storeId: string, input: Base): Promise<PixCharge> {
  conferirValor(input.amountCents);
  if (!input.payerIp) throw new Error("MangoFy exige o IP do comprador e ele não chegou na cobrança.");
  const body = { ...corpoBase(input), payment_method: "pix", installments: 1, pix: { expires_in_days: 1 } };

  const { res, data } = await chamar(storeId, "/api/v1/payment/pix", body);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const qrCode = String(data?.pix?.pix_qrcode_text ?? "");
  if (!qrCode) throw new Error(`MangoFy não retornou o código Pix (status ${data?.payment_status ?? "?"}).`);
  return {
    id: String(data?.payment_code ?? ""),
    status: normalizeMangofyStatus(data?.payment_status),
    qrCode,
    // A imagem vem em base64 (data URI) — grande demais para guardar; o
    // checkout gera o QR a partir do copia e cola.
    qrCodeUrl: null,
    // "2026-06-13 14:02:01" sem fuso: deixamos o checkout usar o padrão dele
    // em vez de adivinhar o fuso e mostrar um prazo errado.
    expiresAt: null,
  };
}

export type MangofyCardResult = { id: string; status: string; statusDetail: string };

/** Cobrança no cartão (dados crus, repassados via TLS — nunca gravados). */
export async function createCardPayment(
  storeId: string,
  input: Base & {
    installments: number;
    storeName?: string;
    card: { number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<MangofyCardResult> {
  conferirValor(input.amountCents);
  if (!input.payerIp) throw new Error("MangoFy exige o IP do comprador e ele não chegou na cobrança.");
  const ano = (input.card.expirationYear || "").trim();
  // Nome na fatura: mínimo 3 caracteres; eles cortam em 13.
  const descritor =
    (input.storeName || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .trim()
      .slice(0, 13) || "LOJA";
  const body = {
    ...corpoBase(input),
    payment_method: "credit_card",
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    card: {
      number: (input.card.number || "").replace(/\D/g, "").slice(0, 20),
      holder_name: (input.card.holderName || "").trim().slice(0, 100),
      expiration_month: Number(input.card.expirationMonth),
      expiration_year: Number(ano.length === 2 ? `20${ano}` : ano),
      cvv: input.card.cvv,
      soft_descriptor: descritor.length >= 3 ? descritor : "LOJA",
    },
  };

  const { res, data } = await chamar(storeId, "/api/v1/payment/credit-card", body);
  // 400 com o pagamento no corpo = recusa (refused/canceled/expirado): é
  // desfecho normal, não erro de integração.
  if (res.status === 400 && typeof data?.payment_status === "string") {
    const c = data?.card ?? {};
    const detalhe = [data.payment_status, c.card_rejected, c.card_rejected_detail, c.card_gateway_message].filter(Boolean).join(" — ");
    return { id: String(data?.payment_code ?? ""), status: "DECLINED", statusDetail: detalhe };
  }
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const c = data?.card ?? {};
  const detalhe = [data?.payment_status, c.card_flag, c.card_last_four_digits ? `final ${c.card_last_four_digits}` : null].filter(Boolean).join(" · ");
  return { id: String(data?.payment_code ?? ""), status: normalizeMangofyStatus(data?.payment_status), statusDetail: detalhe };
}

/** Pagamento pelo código: status normalizado + o pedido a que pertence. */
export async function getMangofyPayment(storeId: string, code: string): Promise<{ status: string; orderId: string } | null> {
  try {
    const { res, data } = await chamar(storeId, `/api/v1/payment/${encodeURIComponent(code)}`);
    if (!res.ok || typeof data?.payment_status !== "string") return null;
    return { status: normalizeMangofyStatus(data.payment_status), orderId: pedidoDoExternalCode(String(data?.external_code ?? "")) };
  } catch {
    return null;
  }
}

/** Status normalizado de um pagamento (ou null). */
export async function getMangofyTransactionStatus(storeId: string, code: string): Promise<string | null> {
  return (await getMangofyPayment(storeId, code))?.status ?? null;
}

/**
 * Confere as credenciais sem criar cobrança.
 *
 * A API não tem rota de leitura de conta: consultamos um pagamento que não
 * existe. 404 ("Pagamento não encontrado") = chave e Store Code aceitos;
 * 401/403 = recusados.
 */
export async function checkMangofyCredentials(storeId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await getMangofyCredentials(storeId))) return { ok: false, error: "API Key e Store Code não configurados." };
  try {
    const { res, data } = await chamar(storeId, `/api/v1/payment/vox-teste-${Date.now().toString(36)}`);
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Credenciais recusadas pela MangoFy${data?.message ? `: ${data.message}` : ""}.` };
    if (res.status === 404 || res.ok) return { ok: true };
    return { ok: false, error: `MangoFy respondeu ${res.status}${data?.message ? `: ${data.message}` : ""}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a MangoFy." };
  }
}
