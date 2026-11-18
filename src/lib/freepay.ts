import "server-only";
import { getFreepayCredentials, salvarFreepayCompanyId } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";
import { lerCorpo, mensagemDaApi } from "./mensagem-da-api";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Freepay (Pix + cartão TRANSPARENTE — sem redirect). Um único
// endpoint cria a transação (pix/credit_card/boleto). Auth: Basic
// base64(publicKey:secretKey). As credenciais ficam por loja, criptografadas.
// Docs: POST /payment-transaction/create · GET /payment-transaction/info/{id}
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.freepaybrasil.com/v1";

/** Mapeia o status da Freepay para o vocabulário interno. */
export function normalizeFreepayStatus(status: string | undefined): string {
  switch ((status || "").toUpperCase()) {
    case "PAID":
      return "APPROVED";
    case "REFUNDED":
      return "REFUNDED";
    case "CHARGEBACK":
    case "PRECHARGEBACK":
      return "CHARGEBACK";
    case "REFUSED":
    case "EXPIRED":
    case "ERROR":
    case "FAILED":
      return "DECLINED";
    default:
      return "PENDING";
  }
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };

async function freepayAuth(storeId: string): Promise<{ auth: string; companyId: string | null } | null> {
  const creds = await getFreepayCredentials(storeId);
  if (!creds) return null;
  return {
    auth: "Basic " + Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString("base64"),
    companyId: creds.companyId,
  };
}

// Lojas cuja consulta da empresa falhou há pouco: não repete a chamada em cada
// cobrança (cada uma somaria a latência no checkout).
const SEM_COMPANY_MS = 5 * 60_000;
const semCompany = new Map<string, number>();

/**
 * O company_id é obrigatório: sem ele a Freepay não roteia o cartão para a
 * adquirente da conta e responde 500 vazio. O lojista não digita mais: GET
 * /v1/company devolve a empresa dona das chaves, e o id fica salvo na loja.
 */
async function companyIdDaConta(storeId: string, creds: { auth: string; companyId: string | null }): Promise<string | null> {
  if (creds.companyId) return creds.companyId;
  if ((semCompany.get(storeId) ?? 0) > Date.now()) return null;
  try {
    const res = await fetch(`${API_BASE}/company`, { headers: { authorization: creds.auth, accept: "application/json" } });
    const data = await res.json().catch(() => null);
    const id = typeof firstTxn(data)?.id === "string" ? firstTxn(data).id.trim() : "";
    if (res.ok && /^[A-Za-z0-9-]{8,64}$/.test(id)) {
      await salvarFreepayCompanyId(storeId, id);
      return id;
    }
    console.error("[freepay] company", res.status, JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.error("[freepay] company", e);
  }
  semCompany.set(storeId, Date.now() + SEM_COMPANY_MS);
  return null;
}

function buildCustomer(customer: PixCustomer) {
  const doc = (customer.document || "").replace(/\D/g, "");
  return {
    name: customer.name,
    email: customer.email,
    phone: (customer.phone || "").replace(/\D/g, ""),
    document: { number: doc, type: doc.length > 11 ? "cnpj" : "cpf" },
  };
}

function buildShipping(a?: Address) {
  if (!a || (!a.cep && !a.street)) return undefined;
  return {
    fee: 0,
    address: {
      street: a.street,
      street_number: a.number,
      complement: a.complement || undefined,
      zip_code: (a.cep || "").replace(/\D/g, ""),
      neighborhood: a.neighborhood,
      city: a.city,
      state: a.uf,
      country: "BR",
    },
  };
}

// Mesmo motor da Wappi: o motivo pode vir aninhado no corpo (ver lib/mensagem-da-api.ts).
function apiError(prefix: string, res: Response, data: any, texto: string): Error {
  const detail = mensagemDaApi(data, texto) || `HTTP ${res.status}`;
  console.error("[freepay]", prefix, res.status, (texto || JSON.stringify(data)).slice(0, 400));
  return new Error(`${prefix}: ${detail}`);
}

/** A resposta vem em data[0] (ou data direto). */
function firstTxn(data: any): any {
  if (Array.isArray(data?.data)) return data.data[0] ?? {};
  return data?.data ?? data ?? {};
}

/** Cria uma cobrança Pix na Freepay. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    postbackUrl?: string;
  },
): Promise<PixCharge> {
  const creds = await freepayAuth(storeId);
  if (!creds) throw new Error("Freepay não configurada. Informe as chaves no painel.");

  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    payment_method: "pix",
    customer: buildCustomer(input.customer),
    items: [{ title: (input.description || "Pedido").slice(0, 120), unit_price: Math.round(input.amountCents), quantity: 1, tangible: true }],
    pix: { expires_in_days: 1 },
    // A Freepay EXIGE metadata como OBJETO (não string JSON).
    metadata: { provider_name: "VoxPay" },
  };
  const companyId = await companyIdDaConta(storeId, creds);
  if (companyId) body.company_id = companyId;
  if (input.postbackUrl) body.postback_url = input.postbackUrl;
  if (input.payerIp) body.ip = input.payerIp;
  const shipping = buildShipping(input.address);
  if (shipping) body.shipping = shipping;

  const res = await fetch(`${API_BASE}/payment-transaction/create`, {
    method: "POST",
    headers: { authorization: creds.auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const { data, texto } = await lerCorpo(res);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data, texto);

  const tx = firstTxn(data);
  const pix = Array.isArray(tx.pix) ? tx.pix[0] : tx.pix;
  const qrCode = String(pix?.qr_code ?? pix?.copy_paste ?? "");
  if (!qrCode) throw new Error("Freepay não retornou o código Pix (copia e cola).");
  // A Freepay às vezes devolve uma data-zero ("0001-01-01...") — fora do range de
  // datetime do MySQL. Tratamos como sem expiração (o checkout usa 30 min padrão).
  const exp = pix?.expiration_date ? String(pix.expiration_date) : "";
  const expiresAt = exp && !exp.startsWith("0001") ? exp : null;
  return {
    id: String(tx.id),
    status: normalizeFreepayStatus(tx.status),
    qrCode,
    qrCodeUrl: null, // o checkout gera a imagem a partir do copia-e-cola
    expiresAt,
  };
}

export type FreepayCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO (transparente). Aceita `hash` (token) OU os dados do cartão
 * — que só trafegam em memória via TLS e NUNCA são gravados/logados.
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
    postbackUrl?: string;
    card: {
      token?: string;
      number?: string;
      cvv?: string;
      expirationMonth?: string;
      expirationYear?: string;
      holderName?: string;
    };
  },
): Promise<FreepayCardResult> {
  const creds = await freepayAuth(storeId);
  if (!creds) throw new Error("Freepay não configurada.");

  const card: Record<string, unknown> = input.card.token
    ? { hash: input.card.token }
    : {
        number: (input.card.number || "").replace(/\D/g, ""),
        holder_name: input.card.holderName,
        expiration_month: Number(input.card.expirationMonth),
        expiration_year: Number(input.card.expirationYear),
        cvv: input.card.cvv,
      };

  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    payment_method: "credit_card",
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    customer: buildCustomer(input.customer),
    items: [{ title: (input.description || "Pedido").slice(0, 120), unit_price: Math.round(input.amountCents), quantity: 1, tangible: true }],
    card,
    metadata: { provider_name: "VoxPay" },
  };
  const companyId = await companyIdDaConta(storeId, creds);
  if (companyId) body.company_id = companyId;
  if (input.postbackUrl) body.postback_url = input.postbackUrl;
  if (input.payerIp) body.ip = input.payerIp;
  const shipping = buildShipping(input.address);
  if (shipping) body.shipping = shipping;

  const res = await fetch(`${API_BASE}/payment-transaction/create`, {
    method: "POST",
    headers: { authorization: creds.auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const { data, texto } = await lerCorpo(res);
  if (!res.ok) {
    const raw = texto || JSON.stringify(data || "");
    // Falta de company_id -> a Freepay crasha com 500 vazio (não roteia o cartão).
    if (res.status >= 500 && !companyId) {
      throw new Error("Cartão indisponível na Freepay: a conta não foi identificada pelas chaves. Confira a Public Key e a Secret Key no painel.");
    }
    // Adquirente de cartão não configurada/funcional na conta Freepay.
    if (/acquirer|adquirente/i.test(raw)) {
      console.error("[freepay] cartão", res.status, raw.slice(0, 400));
      throw new Error("Cartão recusado pela adquirente da Freepay. A adquirente de cartão da sua conta não está ativa — fale com o suporte da Freepay. O Pix funciona normalmente.");
    }
    throw apiError("Falha ao processar o cartão", res, data, texto);
  }

  const tx = firstTxn(data);
  return {
    id: String(tx.id),
    status: normalizeFreepayStatus(tx.status),
    statusDetail: String(tx.status ?? ""),
  };
}

/** Consulta o status normalizado de uma transação Freepay (ou null). */
export async function getFreepayTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const creds = await freepayAuth(storeId);
  if (!creds) return null;
  try {
    const res = await fetch(`${API_BASE}/payment-transaction/info/${encodeURIComponent(id)}`, {
      headers: { authorization: creds.auth, accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const tx = firstTxn(data);
    // A transação traz o company_id real da conta: corrige o salvo se diferir.
    const cid = typeof tx?.company_id === "string" ? tx.company_id.trim() : "";
    if (/^[A-Za-z0-9-]{8,64}$/.test(cid) && cid !== creds.companyId) {
      await salvarFreepayCompanyId(storeId, cid).catch(() => {});
    }
    return typeof tx?.status === "string" ? normalizeFreepayStatus(tx.status) : null;
  } catch {
    return null;
  }
}
