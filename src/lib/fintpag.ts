import "server-only";
import { getFintpagCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração FintPag (motor FastSoft-family) — Pix + cartão TRANSPARENTE (raw).
// Endpoint único: POST /v1/transactions (pix | credit_card). Auth: Basic
// base64("x:SECRET"). O cartão vai CRU ao servidor (não tokeniza no navegador) e
// só trafega em memória via TLS — nunca é gravado nem logado.
// Status: paid / waiting_payment / processing / refused / refunded / chargedback.
// ─────────────────────────────────────────────────────────────────────────────

// Mudou de fintpag.com para fintpag.tech em nov/2026; o domínio antigo saiu do DNS.
const API_BASE = "https://api.fintpag.tech";

export function normalizeFintpagStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
    case "chargeback":
      return "CHARGEBACK";
    case "refused":
    case "canceled":
    case "cancelled":
    case "failed":
      return "DECLINED";
    // waiting_payment, processing, authorized, in_analysis... -> PENDING (no-op).
    default:
      return "PENDING";
  }
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };

async function fintpagAuth(storeId: string): Promise<string | null> {
  const creds = await getFintpagCredentials(storeId);
  if (!creds) return null;
  return "Basic " + Buffer.from(`x:${creds.secretKey}`).toString("base64");
}

function buildCustomer(customer: PixCustomer) {
  const doc = (customer.document || "").replace(/\D/g, "");
  return {
    name: customer.name,
    email: customer.email,
    phone: (customer.phone || "").replace(/\D/g, ""),
    document: { type: doc.length > 11 ? "cnpj" : "cpf", number: doc },
  };
}

function buildItems(items: { name: string; quantity: number; unitPriceCents: number }[] | undefined, description: string | undefined, amountCents: number) {
  const list = items?.length ? items : [{ name: description || "Pedido", quantity: 1, unitPriceCents: amountCents }];
  return list.map((it) => ({ title: (it.name || "Item").slice(0, 120), quantity: it.quantity, unitPrice: Math.round(it.unitPriceCents), tangible: true }));
}

// Endereço no formato da FintPag/Shield. Só monta se houver o mínimo (rua + CEP);
// país fixo "BR". Alimenta o antifraude (reduz recusa genérica em cartão).
function mapAddress(a: Address | undefined) {
  if (!a) return null;
  const cep = (a.cep || "").replace(/\D/g, "");
  const street = (a.street || "").trim();
  if (!street || !cep) return null;
  return {
    street: street.slice(0, 60),
    streetNumber: (a.number || "S/N").replace(/[^0-9A-Za-z/]/g, "").slice(0, 10) || "S/N",
    neighborhood: (a.neighborhood || "").trim().slice(0, 60) || "Centro",
    city: (a.city || "").trim().slice(0, 60),
    state: (a.uf || "").trim().toUpperCase().slice(0, 2),
    zipCode: cep.slice(0, 8),
    country: "BR",
    ...(a.complement?.trim() ? { complement: a.complement.trim().slice(0, 60) } : {}),
  };
}

// Achata o objeto de erros da FintPag ({ card: { expirationMonth: "..." } }) numa
// string legível ("expirationMonth: ...; document: ...").
function flattenErrors(err: any): string {
  if (!err || typeof err !== "object") return "";
  const out: string[] = [];
  for (const [k, v] of Object.entries(err)) {
    if (typeof v === "string") out.push(`${k}: ${v}`);
    else if (v && typeof v === "object") { const inner = flattenErrors(v); if (inner) out.push(inner); }
  }
  return out.join("; ");
}

function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[fintpag]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  // 424 = erro/recusa na adquirente (cartão não processado).
  if (res.status === 424) {
    return new Error(`${prefix}: cartão recusado pela adquirente. Tente outro cartão ou pague com Pix.`);
  }
  const fields = flattenErrors(data?.error);
  const detail = fields ? `${data?.message || "Dados inválidos"} (${fields})` : (data?.message || `HTTP ${res.status}`);
  return new Error(`${prefix}: ${detail}`);
}

function txnFrom(data: any): any {
  return data?.data ?? data ?? {};
}

function extractPix(tx: any): { qrCode: string; expiresAt: string | null } {
  const p = tx?.pix ?? {};
  const qrCode = String(p.qrcode ?? p.qrCode ?? p.qr_code ?? p.copyPaste ?? p.emv ?? "");
  const exp = p.expirationDate ?? p.expiration_date ?? p.expiresAt ?? null;
  return { qrCode, expiresAt: exp ? String(exp) : null };
}

async function post(
  storeId: string,
  body: Record<string, unknown>,
  errPrefix: string,
  opts?: { declineOn424?: boolean },
): Promise<any> {
  const auth = await fintpagAuth(storeId);
  if (!auth) throw new Error("FintPag não configurada. Informe a chave secreta no painel.");
  const res = await fetch(`${API_BASE}/v1/transactions`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    // 424 = a adquirente recusou o cartão. Isso é RECUSA, não erro de
    // integração: devolvemos como transação "refused" para a rota responder 402
    // (pedido cancelado + página de "pagamento não aprovado" + webhook de
    // pedido recusado). Lançar aqui virava um 502 sem orderId, e o cliente
    // ficava preso num aviso vermelho no checkout.
    if (opts?.declineOn424 && res.status === 424) {
      const t = txnFrom(data);
      return {
        ...t,
        status: "refused",
        refusedReason: t?.refusedReason ?? data?.message ?? "Recusado pela adquirente",
      };
    }
    throw apiError(errPrefix, res, data);
  }
  return txnFrom(data);
}

/** Cria uma cobrança Pix na FintPag. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    postbackUrl?: string;
    externalReference?: string;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
  },
): Promise<PixCharge> {
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    paymentMethod: "pix",
    customer: buildCustomer(input.customer),
    items: buildItems(input.items, input.description, input.amountCents),
    pix: { expiresInDays: 1 },
  };
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  if (input.externalReference) body.externalRef = input.externalReference;
  if (input.payerIp) body.ip = input.payerIp;

  const tx = await post(storeId, body, "Falha ao gerar o Pix");
  const { qrCode, expiresAt } = extractPix(tx);
  if (!qrCode) throw new Error("FintPag não retornou o código Pix (copia e cola).");
  return { id: String(tx.id ?? ""), status: normalizeFintpagStatus(tx.status), qrCode, qrCodeUrl: null, expiresAt };
}

export type FintpagCardResult = { id: string; status: string; statusDetail: string };

/** Cobrança no CARTÃO. Tokenizado (hash + sessionId do SDK) ou cru como fallback. */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    payerIp?: string;
    postbackUrl?: string;
    externalReference?: string;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
    address?: Address;
    shippingCents?: number;
    // sessionId = fingerprint do antifraude (ThreatMetrix) gerado pelo SDK /v1/js.
    sessionId?: string;
    // hash = cartão tokenizado pelo SDK. Se vier, NÃO manda os campos crus.
    card: { hash?: string; number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<FintpagCardResult> {
  let card: Record<string, unknown>;
  if (input.card.hash) {
    card = { hash: input.card.hash };
  } else {
    const expYear = (input.card.expirationYear || "").length === 2 ? `20${input.card.expirationYear}` : input.card.expirationYear || "";
    card = {
      number: (input.card.number || "").replace(/\D/g, ""),
      holderName: input.card.holderName,
      expirationMonth: Number(input.card.expirationMonth),
      expirationYear: Number(expYear),
      cvv: input.card.cvv,
    };
  }

  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    paymentMethod: "credit_card",
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    customer: buildCustomer(input.customer),
    items: buildItems(input.items, input.description, input.amountCents),
    card,
  };
  // Endereço (topo) + entrega — sinais fortes de antifraude. shipping.fee em centavos
  // como NÚMERO (a API rejeita string: "O tipo do valor de 'fee' deve ser numérico").
  const addr = mapAddress(input.address);
  if (addr) {
    body.address = addr;
    body.shipping = { fee: Math.max(0, Math.round(input.shippingCents ?? 0)), address: addr };
  }
  // Fingerprint do antifraude — só o gerado pelo SDK da FintPag (nunca um sid nosso).
  if (input.sessionId) body.sessionId = input.sessionId;
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  if (input.externalReference) body.externalRef = input.externalReference;
  if (input.payerIp) body.ip = input.payerIp;

  const tx = await post(storeId, body, "Falha ao processar o cartão", { declineOn424: true });
  return { id: String(tx.id ?? ""), status: normalizeFintpagStatus(tx.status), statusDetail: String(tx.refusedReason ?? tx.status ?? "") };
}

/** Consulta o status normalizado de uma transação FintPag (ou null). */
export async function getFintpagTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const auth = await fintpagAuth(storeId);
  if (!auth) return null;
  try {
    const res = await fetch(`${API_BASE}/v1/transactions/${encodeURIComponent(id)}`, { headers: { Authorization: auth, accept: "application/json" } });
    if (!res.ok) return null;
    const tx = txnFrom(await res.json().catch(() => null));
    return typeof tx?.status === "string" ? normalizeFintpagStatus(tx.status) : null;
  } catch {
    return null;
  }
}

/** Grava o código de rastreio (best-effort). */
export async function setFintpagTracking(storeId: string, id: string, trackingCode: string): Promise<{ ok: boolean; error?: string }> {
  const code = (trackingCode || "").trim();
  if (!id || !code) return { ok: false, error: "id/código inválido" };
  const auth = await fintpagAuth(storeId);
  if (!auth) return { ok: false, error: "FintPag não configurada" };
  try {
    const res = await fetch(`${API_BASE}/v1/transactions/${encodeURIComponent(id)}/delivery`, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ trackingCode: code, deliveryStatus: "IN_TRANSIT" }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha" };
  }
}
