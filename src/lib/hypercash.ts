import "server-only";
import { storefrontUrl } from "./storefront";
import { getHypercashCredentials, getStoreName } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração HyperCash (motor FastSoft) — Pix + cartão transparente.
// Um único endpoint cria a transação (POST /api/user/transactions).
// Auth: Basic base64("x:SECRET_KEY"). Credenciais por loja, criptografadas.
// Cartão é tokenizado no NAVEGADOR (SDK FastSoft + public key) e enviado como
// token — os dados do cartão nunca passam pelo nosso servidor.
// Status: PAID/AUTHORIZED/WAITING_PAYMENT/IN_ANALYSIS/REFUSED/CANCELED/REFUNDED/
//         CHARGEDBACK/IN_PROTEST/PROCESSING.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.hypercashbrasil.com.br";

/** Mapeia o status da HyperCash para o vocabulário interno. */
export function normalizeHypercashStatus(status: string | undefined): string {
  switch ((status || "").toUpperCase()) {
    case "PAID":
      return "APPROVED";
    case "REFUNDED":
      return "REFUNDED";
    case "CHARGEDBACK":
    case "CHARGEBACK":
      return "CHARGEBACK";
    case "REFUSED":
    case "CANCELED":
    case "CANCELLED":
    case "FAILED":
      return "DECLINED";
    // PROCESSING, WAITING_PAYMENT, IN_ANALYSIS, AUTHORIZED, IN_PROTEST:
    // ainda indefinidos — PENDING não dispara transição (no-op seguro).
    default:
      return "PENDING";
  }
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };

async function hypercashAuth(storeId: string): Promise<string | null> {
  const creds = await getHypercashCredentials(storeId);
  if (!creds) return null;
  // O token é base64("x:CHAVE_SECRETA").
  return "Basic " + Buffer.from(`x:${creds.secretKey}`).toString("base64");
}

/**
 * Cliente da transação.
 *
 * O `address` aqui é o endereço de COBRANÇA, e é campo próprio do `customer` no
 * contrato deles — separado do `shipping.address`, que é a entrega. Mandávamos
 * só a entrega; o endereço de cobrança é exatamente um dos dados que o emissor
 * e o antifraude conferem contra o cadastro do cartão.
 *
 * Fica de fora quando incompleto: os subcampos são obrigatórios no contrato, e
 * meio endereço reprova a requisição inteira.
 */
function buildCustomer(customer: PixCustomer, address?: Address) {
  const doc = (customer.document || "").replace(/\D/g, "");
  const addr = mapAddress(address);
  return {
    name: customer.name,
    email: customer.email,
    phone: (customer.phone || "").replace(/\D/g, ""),
    document: { number: doc, type: doc.length > 11 ? "CNPJ" : "CPF" },
    ...(addr ? { address: addr } : {}),
  };
}

/**
 * Endereço no formato do motor FastSoft (mesmo shape usado na FintPag/HylexPay).
 * Só monta com o mínimo (rua + CEP); país fixo "BR".
 */
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

type Origin = {
  /** Id do pedido no nosso lado — viaja em `metadata.orderId`. */
  externalReference?: string;
  /** URL do checkout onde a venda aconteceu. */
  checkoutUrl?: string;
  address?: Address;
  shippingCents?: number;
};

/**
 * Metadados de ORIGEM da venda (site, checkout, loja, pedido).
 *
 * A HyperCash bloqueou a conta por transações sem esta identificação: "os
 * metadados, as informações sobre o checkout, site etc... precisam constar nas
 * transações".
 *
 * Quem serializa é `applyOrigin`: no contrato deles `metadata` é STRING, com
 * exemplo `{"chave":"valor"}`. Já foi como objeto por analogia com a Freepay
 * (mesmo motor, que recusa a string), e o efeito aqui era pior que um erro —
 * a transação era criada e o campo descartado em silêncio. O suporte deles
 * confirmou em 16/09/2026: "chegaram, mas sem os metadados".
 *
 * Todos os valores em texto, para não esbarrar em validação de tipo.
 */
async function buildMetadata(storeId: string, o: Origin): Promise<Record<string, string>> {
  const storeName = await getStoreName(storeId).catch(() => "");
  // `site` é a VITRINE, não a origem do checkout. Mandar o subdomínio de
  // pagamento nos dois campos foi o que fez a HyperCash dizer que só conseguia
  // acessar o checkout, e que estava "duplicado".
  const site = storefrontUrl(o.checkoutUrl) ?? "";
  const meta: Record<string, string> = { platform: "VoxCheckout" };
  if (storeName) meta.storeName = storeName;
  if (site) meta.site = site;
  if (o.checkoutUrl) meta.checkoutUrl = o.checkoutUrl;
  if (o.externalReference) meta.orderId = o.externalReference;
  return meta;
}

/**
 * Campos comuns de origem/entrega, aplicados aos dois métodos de pagamento.
 *
 * `externalRef` NÃO é mais enviado. Em 15/09/2026 a HyperCash passou a recusar
 * a cobrança inteira com "property externalRef should not exist" — validação de
 * lista branca do lado deles. Até 06/09 o mesmo corpo era aceito (22 cobranças
 * de cartão criadas), então quem mudou foi a API, não o nosso código.
 *
 * Nada se perde: o id do pedido continua em `metadata.orderId`, que é a
 * identificação que eles exigiram depois de terem bloqueado a conta. E a
 * conciliação nunca dependeu disso — o webhook casa pelo `providerTxnId`.
 */
async function applyOrigin(body: Record<string, unknown>, storeId: string, o: Origin): Promise<void> {
  const address = mapAddress(o.address);
  if (address) {
    body.shipping = { fee: Math.max(0, Math.round(o.shippingCents ?? 0)), address };
  }
  // Marca a transação como rastreável (entrega/origem informadas).
  body.traceable = true;
  // STRING, não objeto — ver `buildMetadata`.
  body.metadata = JSON.stringify(await buildMetadata(storeId, o));
}

function apiError(prefix: string, res: Response, data: any): Error {
  const detail = data?.message || data?.error?.message || data?.error || (data?.errors ? JSON.stringify(data.errors).slice(0, 200) : "") || "sem detalhe";
  console.error("[hypercash]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  // O status HTTP entra na mensagem porque ela é gravada no pedido: sem ele,
  // uma recusa de negócio e uma mudança de contrato da API ficam iguais.
  return new Error(`${prefix}: ${detail} [HTTP ${res.status}]`);
}

/** A transação pode vir em data, data.data ou data.transaction. */
function txnFrom(data: any): any {
  return data?.data ?? data?.transaction ?? data ?? {};
}

/** Procura o copia-e-cola do Pix na resposta (tolerante a variações de campo). */
function extractPix(tx: any): { qrCode: string; expiresAt: string | null } {
  const p = tx?.pix ?? tx?.pixData ?? tx ?? {};
  const qrCode = String(
    p.qrcode ?? p.qrCode ?? p.qr_code ?? p.copyPaste ?? p.copy_paste ?? p.emv ?? p.qrCodeText ?? p.payload ?? "",
  );
  const exp = p.expiresAt ?? p.expirationDate ?? p.expiration_date ?? p.expires_at ?? p.dueDate ?? null;
  return { qrCode, expiresAt: exp ? String(exp) : null };
}

/** Cria uma cobrança Pix na HyperCash. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    shippingCents?: number;
    postbackUrl?: string;
    externalReference?: string;
    checkoutUrl?: string;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
  },
): Promise<PixCharge> {
  const auth = await hypercashAuth(storeId);
  if (!auth) throw new Error("HyperCash não configurada. Informe a chave secreta no painel.");

  const items = (input.items?.length ? input.items : [{ name: input.description || "Pedido", quantity: 1, unitPriceCents: input.amountCents }]).map((it) => ({
    title: (it.name || "Item").slice(0, 120),
    quantity: it.quantity,
    unitPrice: Math.round(it.unitPriceCents),
    tangible: true,
  }));

  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    currency: "BRL",
    paymentMethod: "PIX",
    customer: buildCustomer(input.customer, input.address),
    items,
    pix: { expiresInDays: 1 },
  };
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  if (input.payerIp) body.ip = input.payerIp;
  await applyOrigin(body, storeId, input);

  const res = await fetch(`${API_BASE}/api/user/transactions`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const tx = txnFrom(data);
  const { qrCode, expiresAt } = extractPix(tx);
  if (!qrCode) throw new Error("HyperCash não retornou o código Pix (copia e cola).");
  return {
    id: String(tx.id ?? tx.transactionId ?? tx.hash ?? ""),
    status: normalizeHypercashStatus(tx.status),
    qrCode,
    qrCodeUrl: null, // o checkout gera a imagem a partir do copia-e-cola
    expiresAt,
  };
}

export type HypercashCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO (transparente). A API da HyperCash NÃO aceita cartão
 * tokenizado no corpo da transação — ela recusa com `card.property token should
 * not exist` e exige os campos crus: number/holderName/cvv como string e
 * expirationMonth/expirationYear como NÚMERO. O cartão só trafega em memória
 * via TLS: nunca é gravado nem logado.
 */
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
    checkoutUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
    card: { number: string; cvv: string; expirationMonth: string; expirationYear: string; holderName: string };
  },
): Promise<HypercashCardResult> {
  const auth = await hypercashAuth(storeId);
  if (!auth) throw new Error("HyperCash não configurada.");
  const number = (input.card.number || "").replace(/\D/g, "");
  if (!number) throw new Error("Número do cartão ausente.");

  const items = (input.items?.length ? input.items : [{ name: input.description || "Pedido", quantity: 1, unitPriceCents: input.amountCents }]).map((it) => ({
    title: (it.name || "Item").slice(0, 120),
    quantity: it.quantity,
    unitPrice: Math.round(it.unitPriceCents),
    tangible: true,
  }));

  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    currency: "BRL",
    paymentMethod: "CREDIT_CARD",
    customer: buildCustomer(input.customer, input.address),
    items,
    // expirationMonth/expirationYear precisam ser NÚMERO (o ano com 4 dígitos).
    card: {
      number,
      holderName: input.card.holderName,
      expirationMonth: Number(input.card.expirationMonth),
      expirationYear: Number((input.card.expirationYear || "").length === 2 ? `20${input.card.expirationYear}` : input.card.expirationYear),
      cvv: input.card.cvv,
    },
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
  };
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  if (input.payerIp) body.ip = input.payerIp;
  await applyOrigin(body, storeId, input);

  const res = await fetch(`${API_BASE}/api/user/transactions`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    // RECUSA ≠ erro de integração. Na recusa a HyperCash devolve HTTP 400 com a
    // transação criada em `data` (id + status "refused") e o motivo em
    // `error.refusedReason` (ex.: "CARTAO INVALIDO [ECOM - G4]"). Devolvemos como
    // DECLINED para a rota gravar o gateway + txn id e responder 402 (e não 502).
    const t = data?.data;
    if (t?.id && normalizeHypercashStatus(t?.status) === "DECLINED") {
      return {
        id: String(t.id),
        status: "DECLINED",
        statusDetail: String(data?.error?.refusedReason ?? t?.status ?? ""),
      };
    }
    throw apiError("Falha ao processar o cartão", res, data);
  }

  const tx = txnFrom(data);
  return {
    id: String(tx.id ?? tx.transactionId ?? tx.hash ?? ""),
    status: normalizeHypercashStatus(tx.status),
    statusDetail: String(tx.status ?? ""),
  };
}

/**
 * Grava o código de rastreio numa transação HyperCash (status de entrega).
 * Best-effort e à prova de loja não-conectada: nunca lança. Retorna {ok,error}.
 * Docs: PUT /api/user/transactions/{id}/delivery — "atualiza o status de entrega,
 * incluindo código de rastreio". Os nomes dos campos do body não são expostos na
 * doc (SPA); usamos os mais prováveis (camelCase, como o resto da API).
 */
export async function setHypercashTracking(
  storeId: string,
  transactionId: string,
  trackingCode: string,
): Promise<{ ok: boolean; error?: string }> {
  const code = (trackingCode || "").trim();
  if (!transactionId || !code) return { ok: false, error: "id/código inválido" };
  const auth = await hypercashAuth(storeId);
  if (!auth) return { ok: false, error: "HyperCash não configurada" };
  try {
    const res = await fetch(`${API_BASE}/api/user/transactions/${encodeURIComponent(transactionId)}/delivery`, {
      method: "PUT",
      headers: { Authorization: auth, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ trackingCode: code, deliveryStatus: "IN_TRANSIT" }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}) as any);
      return { ok: false, error: data?.message || data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "falha" };
  }
}

/** Consulta o status normalizado de uma transação HyperCash (ou null). */
export async function getHypercashTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const auth = await hypercashAuth(storeId);
  if (!auth) return null;
  try {
    const res = await fetch(`${API_BASE}/api/user/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: auth, accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const tx = txnFrom(data);
    return typeof tx?.status === "string" ? normalizeHypercashStatus(tx.status) : null;
  } catch {
    return null;
  }
}
