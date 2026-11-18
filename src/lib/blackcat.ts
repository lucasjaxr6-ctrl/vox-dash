import "server-only";
import { getBlackcatCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração BlackCat — Pix + cartão.
//
// Um endpoint só cria as duas coisas (POST /sales/create-sale), mudando
// `paymentMethod`. Auth: header `X-API-Key`. Valores em centavos.
//
// Cartão é DIRETO (server-to-server, sem SDK no navegador): os dados chegam à
// nossa rota e são repassados via TLS — nunca gravados nem logados, mesma
// política da Appmax. Quando o banco pede 3DS a resposta vem `PENDING_3DS` com
// `acsUrl` + `creq`, e o checkout abre o desafio no iframe (ThreeDSChallenge);
// a BlackCat conclui sozinha e avisa pelo postback.
//
// Webhook SEM assinatura (a doc só manda X-Webhook-Event/X-Webhook-Source): o
// corpo serve para achar o pedido, e o status vem sempre do GET de status, com
// a chave da loja.
//
// Doc: https://docs.blackcatoficial.com (página única)
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.blackcatoficial.com/api";

/** Status da BlackCat → vocabulário interno. */
export function normalizeBlackcatStatus(status: string | undefined): string {
  switch ((status || "").toUpperCase()) {
    case "PAID":
    case "APPROVED":
      return "APPROVED";
    case "REFUNDED":
      return "REFUNDED";
    case "CHARGEBACK":
    case "CHARGEDBACK":
      return "CHARGEBACK";
    // CANCELLED cobre "cancelada ou expirada": no Pix o settle não cancela o
    // pedido (fica recuperável); no cartão é recusa de fato.
    case "FAILED":
    case "REFUSED":
    case "CANCELLED":
    case "CANCELED":
    case "EXPIRED":
      return "DECLINED";
    // PENDING e PENDING_3DS ainda mudam sozinhos.
    default:
      return "PENDING";
  }
}

async function apiKey(storeId: string): Promise<string | null> {
  return (await getBlackcatCredentials(storeId))?.apiKey ?? null;
}

async function chamar(storeId: string, caminho: string, body?: unknown) {
  const key = await apiKey(storeId);
  if (!key) throw new Error("BlackCat não configurada. Informe a API Key no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: body ? "POST" : "GET",
    headers: {
      "X-API-Key": key,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Envelope de erro deles: `{ success:false, message, error }`. */
function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[blackcat]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  const detalhe = [data?.message, data?.error].filter((v) => typeof v === "string" && v).join(" — ");
  return new Error(`${prefix}: ${detalhe || "sem detalhe"} [HTTP ${res.status}]`);
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
type Item = { name: string; quantity: number; unitPriceCents: number };

/** Telefone só com dígitos e sem o 55 redigitado. */
function telefone(bruto: string | undefined): string {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d;
}

function cliente(c: PixCustomer) {
  const doc = (c.document || "").replace(/\D/g, "");
  return {
    name: (c.name || "").trim().slice(0, 120),
    email: (c.email || "").trim().slice(0, 180),
    phone: telefone(c.phone),
    document: { number: doc, type: doc.length > 11 ? "cnpj" : "cpf" },
  };
}

/** Entrega no formato deles — só quando o endereço está completo. */
function entrega(nome: string, a: Address | undefined) {
  if (!a) return null;
  const zipCode = (a.cep || "").replace(/\D/g, "");
  const campos = {
    name: nome.slice(0, 120),
    street: (a.street || "").trim().slice(0, 160),
    number: (a.number || "").trim().slice(0, 20) || "S/N",
    neighborhood: (a.neighborhood || "").trim().slice(0, 120),
    city: (a.city || "").trim().slice(0, 120),
    state: (a.uf || "").trim().toUpperCase().slice(0, 2),
    zipCode,
    ...(a.complement?.trim() ? { complement: a.complement.trim().slice(0, 120) } : {}),
  };
  const completo = campos.street && campos.neighborhood && campos.city && campos.state.length === 2 && zipCode.length === 8;
  return completo ? campos : null;
}

/**
 * Itens + entrega.
 *
 * A doc manda `shipping` quando há item físico, e o exemplo dela fecha a soma
 * dos itens com o total (o frete entra como item). Fazemos igual: produtos +
 * frete quando a conta fecha EXATAMENTE com o valor cobrado; senão (cupom,
 * desconto do Pix, juros do cartão) um item único com o total. Assim a soma
 * nunca diverge do `amount`, que é o tipo de detalhe que vira recusa.
 *
 * Físico só com endereço completo: item físico sem `shipping` é erro na API.
 */
function itensEEntrega(
  amountCents: number,
  items: Item[] | undefined,
  shippingCents: number | undefined,
  descricao: string,
  ship: ReturnType<typeof entrega>,
) {
  const fisico = !!ship;
  const lista = (items ?? []).map((it) => ({
    title: (it.name || "Item").slice(0, 120),
    unitPrice: Math.round(it.unitPriceCents),
    quantity: it.quantity,
    tangible: fisico,
  }));
  const frete = Math.max(0, Math.round(shippingCents ?? 0));
  if (frete > 0) lista.push({ title: "Frete", unitPrice: frete, quantity: 1, tangible: false });
  const soma = lista.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const itens = lista.length && soma === Math.round(amountCents)
    ? lista
    : [{ title: descricao.slice(0, 120) || "Pedido", unitPrice: Math.round(amountCents), quantity: 1, tangible: fisico }];
  return { items: itens, ...(ship ? { shipping: ship } : {}) };
}

/** UTMs da sessão: a BlackCat guarda e devolve nos webhooks. */
function utms(tracking: Record<string, string | null | undefined> | undefined) {
  const out: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = tracking?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

function vendaDe(data: any): any {
  return data?.data ?? data ?? {};
}

/** Cria uma cobrança Pix. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    postbackUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: Item[];
    tracking?: Record<string, string | null | undefined>;
  },
): Promise<PixCharge> {
  const ship = entrega(input.customer.name, input.address);
  const body = {
    amount: Math.round(input.amountCents),
    currency: "BRL",
    paymentMethod: "pix",
    customer: cliente(input.customer),
    ...itensEEntrega(input.amountCents, input.items, input.shippingCents, input.description || "Pedido", ship),
    pix: { expiresInDays: 1 },
    ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
    ...(input.externalReference ? { externalRef: input.externalReference } : {}),
    ...utms(input.tracking),
  };

  const { res, data } = await chamar(storeId, "/sales/create-sale", body);
  if (!res.ok || data?.success === false) throw apiError("Falha ao gerar o Pix", res, data);

  const v = vendaDe(data);
  const pd = v?.paymentData ?? {};
  const qrCode = String(pd.copyPaste ?? pd.qrCode ?? "");
  if (!qrCode) throw new Error("BlackCat não retornou o código Pix (copia e cola).");
  return {
    id: String(v.transactionId ?? ""),
    status: normalizeBlackcatStatus(v.status),
    qrCode,
    // A imagem vem em base64 (data URI) e é grande demais para guardar; o
    // checkout gera o QR a partir do copia e cola, como nos outros gateways.
    qrCodeUrl: null,
    expiresAt: pd.expiresAt ? String(pd.expiresAt) : null,
  };
}

export type BlackcatCardResult = {
  id: string;
  status: string;
  statusDetail: string;
  threeDs?: { externalResourceUrl: string; creq: string };
};

/** Cobrança no cartão (dados crus, repassados via TLS — nunca gravados). */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    externalReference?: string;
    postbackUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: Item[];
    /** Navegador do comprador: a doc diz que melhora a aprovação sem desafio 3DS. */
    device?: { userAgent?: string; language?: string };
    card: { number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<BlackcatCardResult> {
  const ano = (input.card.expirationYear || "").trim();
  const ship = entrega(input.customer.name, input.address);
  const body = {
    amount: Math.round(input.amountCents),
    currency: "BRL",
    paymentMethod: "credit_card",
    customer: cliente(input.customer),
    ...itensEEntrega(input.amountCents, input.items, input.shippingCents, input.description || "Pedido", ship),
    card: {
      number: (input.card.number || "").replace(/\D/g, ""),
      holderName: (input.card.holderName || "").trim().slice(0, 120),
      expiryMonth: (input.card.expirationMonth || "").padStart(2, "0"),
      expiryYear: ano.length === 2 ? `20${ano}` : ano,
      cvv: input.card.cvv,
      installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    },
    device: {
      ...(input.device?.language ? { http_browser_language: input.device.language.split(",")[0].trim().slice(0, 20) } : {}),
      http_browser_javascript_enabled: true,
      ...(input.device?.userAgent ? { user_agent: input.device.userAgent.slice(0, 500) } : {}),
    },
    ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
    ...(input.externalReference ? { externalRef: input.externalReference } : {}),
  };

  const { res, data } = await chamar(storeId, "/sales/create-sale", body);
  if (!res.ok || data?.success === false) throw apiError("Falha ao processar o cartão", res, data);

  const v = vendaDe(data);
  const bruto = String(v.status ?? "");
  const id = String(v.transactionId ?? "");

  if (bruto.toUpperCase() === "PENDING_3DS") {
    const start = v?.threeDS?.start ?? {};
    const url = String(start.acsUrl ?? "");
    const creq = String(start.acsPayload?.creq ?? "");
    // Sem URL ou creq não há desafio a abrir: fica pendente e o postback (ou a
    // conciliação) decide. Melhor que inventar uma recusa.
    return url && creq
      ? { id, status: "PENDING", statusDetail: bruto, threeDs: { externalResourceUrl: url, creq } }
      : { id, status: "PENDING", statusDetail: bruto };
  }

  const motivo = v?.refusedReason;
  const detalhe = motivo ? [motivo.code, motivo.description].filter(Boolean).join(" ") : bruto;
  return { id, status: normalizeBlackcatStatus(bruto), statusDetail: detalhe || bruto };
}

/** Status normalizado de uma transação (ou null). */
export async function getBlackcatTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/sales/${encodeURIComponent(id)}/status`);
    if (!res.ok) return null;
    const v = vendaDe(data);
    return typeof v?.status === "string" ? normalizeBlackcatStatus(v.status) : null;
  } catch {
    return null;
  }
}

/** Confere a chave lendo os dados do vendedor (não cria nada). */
export async function checkBlackcatCredentials(storeId: string): Promise<{ ok: boolean; error?: string; vendedor?: string }> {
  if (!(await apiKey(storeId))) return { ok: false, error: "API Key não configurada." };
  try {
    const { res, data } = await chamar(storeId, "/sales/seller");
    if (res.status === 401) return { ok: false, error: "API Key recusada pela BlackCat." };
    if (res.status === 403) return { ok: false, error: "Conta BlackCat não aprovada ou bloqueada." };
    if (!res.ok) return { ok: false, error: `BlackCat respondeu ${res.status}.` };
    const v = vendaDe(data);
    return { ok: true, vendedor: [v?.name, v?.cnpj].filter(Boolean).join(" · ") || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a BlackCat." };
  }
}
