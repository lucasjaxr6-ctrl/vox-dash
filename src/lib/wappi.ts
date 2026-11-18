import "server-only";
import { getWappiCredentials, salvarWappiCompanyId } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";
import { lerCorpo, mensagemDaApi } from "./mensagem-da-api";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Wappi (Pix + cartão TRANSPARENTE). Mesmo motor da Freepay: a doc
// (wappibrasil.readme.io) é o mesmo modelo, com os mesmos endpoints, campos,
// status e postback. Auth: Basic base64(publicKey:secretKey).
// Docs: POST /payment-transaction/create · GET /payment-transaction/info/{id}
//       GET /company
//
// O que a doc diz e a Freepay em produção desmente (valem as duas, é o mesmo
// motor):
//  - `amount` em CENTAVOS. A doc mostra 120.5 nos exemplos e "Em reais" no
//    postback, mas o esquema diz "Total amount in cents". A Freepay cobra em
//    centavos com esse mesmo texto. Para não arriscar o valor, o Pix é conferido
//    pelo valor gravado dentro do próprio código (campo 54 do BR Code).
//  - `metadata` como OBJETO (a doc diz string JSON; a Freepay recusa string).
//  - `company_id` no topo do corpo (a doc só o mostra dentro de `split`).
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.wappibrasil.com.br/v1";

/** Mapeia o status da Wappi para o vocabulário interno. */
export function normalizeWappiStatus(status: string | undefined): string {
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
type Creds = { auth: string; companyId: string | null };

async function wappiAuth(storeId: string): Promise<Creds | null> {
  const creds = await getWappiCredentials(storeId);
  if (!creds) return null;
  return {
    auth: "Basic " + Buffer.from(`${creds.publicKey}:${creds.secretKey}`).toString("base64"),
    companyId: creds.companyId,
  };
}

/** A resposta vem em data[0] (ou data direto). */
function firstTxn(data: any): any {
  if (Array.isArray(data?.data)) return data.data[0] ?? {};
  return data?.data ?? data ?? {};
}

const ID_EMPRESA = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Empresa dona das chaves (GET /v1/company). Serve ao teste da chave no painel
 * e à descoberta do company_id. `ok` false = chave recusada ou API fora.
 */
export async function consultarEmpresaWappi(auth: string): Promise<{ ok: boolean; status: number; id: string | null; nome: string | null }> {
  const res = await fetch(`${API_BASE}/company`, { headers: { authorization: auth, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const data = await res.json().catch(() => null);
  const emp = firstTxn(data);
  const id = typeof emp?.id === "string" ? emp.id.trim() : "";
  const nome = typeof emp?.fantasy_name === "string" ? emp.fantasy_name.trim() : "";
  return { ok: res.ok, status: res.status, id: ID_EMPRESA.test(id) ? id : null, nome: nome || null };
}

/**
 * Teste da chave no painel: só LEITURA (GET /v1/company), nunca cria cobrança.
 * Aproveita e grava o company_id da conta.
 */
export async function checkWappiCredentials(storeId: string): Promise<{ ok: boolean; error?: string; conta?: string | null }> {
  const creds = await wappiAuth(storeId);
  if (!creds) return { ok: false, error: "Salve a Public Key e a Secret Key antes de testar." };
  try {
    const emp = await consultarEmpresaWappi(creds.auth);
    if (emp.status === 401 || emp.status === 403) return { ok: false, error: "A Wappi recusou as chaves. Confira a Public Key e a Secret Key." };
    if (!emp.ok) return { ok: false, error: `A Wappi não respondeu como esperado (HTTP ${emp.status}). Tente de novo em instantes.` };
    if (emp.id) {
      await salvarWappiCompanyId(storeId, emp.id);
      semCompany.delete(storeId);
    }
    return { ok: true, conta: emp.nome };
  } catch (e) {
    console.error("[wappi] teste", e instanceof Error ? e.message : e);
    return { ok: false, error: "Não foi possível falar com a Wappi agora. Tente de novo em instantes." };
  }
}

// Lojas cuja consulta da empresa falhou há pouco: não repete a chamada em cada
// cobrança (cada uma somaria a latência no checkout).
const SEM_COMPANY_MS = 5 * 60_000;
const semCompany = new Map<string, number>();

/**
 * O company_id: na Freepay, sem ele o cartão não é roteado para a adquirente
 * da conta (500 vazio). O lojista não digita: GET /v1/company devolve a empresa
 * dona das chaves, e o id fica salvo na loja.
 */
async function companyIdDaConta(storeId: string, creds: Creds): Promise<string | null> {
  if (creds.companyId) return creds.companyId;
  if ((semCompany.get(storeId) ?? 0) > Date.now()) return null;
  try {
    const emp = await consultarEmpresaWappi(creds.auth);
    if (emp.ok && emp.id) {
      await salvarWappiCompanyId(storeId, emp.id);
      return emp.id;
    }
    console.error("[wappi] company", emp.status);
  } catch (e) {
    console.error("[wappi] company", e instanceof Error ? e.message : e);
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

/**
 * Teto por transação que a Wappi informa para a CONTA. Abaixo de R$ 5 não é teto
 * de verdade, é a conta sem limite liberado (veio "R$ 0,01" na Fut dedo em
 * 10/11/2026): quem resolve é a Wappi, e o painel precisa dizer isso.
 */
function contaSemLimite(frase: string): boolean {
  const m = /limite m[áa]ximo de R\$\s*([\d.]+,\d{2})/i.exec(frase);
  return !!m && Number(m[1].replace(/\./g, "").replace(",", ".")) < 5;
}

function apiError(prefix: string, res: Response, data: any, texto: string): Error {
  const frase = mensagemDaApi(data, texto);
  console.error("[wappi]", prefix, res.status, (texto || JSON.stringify(data)).slice(0, 400));
  const dica = contaSemLimite(frase) ? " A conta Wappi está sem limite por transação liberado: peça à Wappi para liberar." : "";
  return new Error(`${prefix}: ${frase || `HTTP ${res.status}`}${dica}`);
}

/**
 * Valor gravado no copia e cola (campo 54 do BR Code), em centavos. Null se o
 * código não traz valor (Pix dinâmico pode deixar o valor só na URL do PSP).
 */
export function valorDoBrCode(code: string): number | null {
  let i = 0;
  while (i + 4 <= code.length) {
    const tag = code.slice(i, i + 2);
    const len = Number(code.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > code.length) return null;
    if (tag === "54") {
      const v = code.slice(i + 4, i + 4 + len);
      return /^\d+(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null;
    }
    i += 4 + len;
  }
  return null;
}

/** Cria uma cobrança Pix na Wappi. */
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
  const creds = await wappiAuth(storeId);
  if (!creds) throw new Error("Wappi não configurada. Informe as chaves no painel.");

  const amount = Math.round(input.amountCents);
  const body: Record<string, unknown> = {
    amount,
    payment_method: "pix",
    customer: buildCustomer(input.customer),
    items: [{ title: (input.description || "Pedido").slice(0, 120), unit_price: amount, quantity: 1, tangible: true }],
    pix: { expires_in_days: 1 },
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
  if (!qrCode) throw new Error("Wappi não retornou o código Pix (copia e cola).");
  // Trava do valor: o código só vai ao cliente se cobrar exatamente o pedido.
  const noCodigo = valorDoBrCode(qrCode);
  if (noCodigo !== null && noCodigo !== amount) {
    console.error("[wappi] valor do Pix diferente do pedido", { pedido: amount, codigo: noCodigo, id: tx.id });
    throw new Error(`Wappi gerou o Pix com valor diferente do pedido (${(noCodigo / 100).toFixed(2)} em vez de ${(amount / 100).toFixed(2)}).`);
  }
  // Data-zero ("0001-01-01...") fica fora do range de datetime do MySQL:
  // tratamos como sem expiração (o checkout usa 30 min padrão).
  const exp = pix?.expiration_date ? String(pix.expiration_date) : "";
  const expiresAt = exp && !exp.startsWith("0001") ? exp : null;
  return {
    id: String(tx.id),
    status: normalizeWappiStatus(tx.status),
    qrCode,
    qrCodeUrl: null, // o checkout gera a imagem a partir do copia-e-cola
    expiresAt,
  };
}

export type WappiCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO (transparente). Os dados do cartão só trafegam em memória
 * via TLS e NUNCA são gravados/logados.
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
      number?: string;
      cvv?: string;
      expirationMonth?: string;
      expirationYear?: string;
      holderName?: string;
    };
  },
): Promise<WappiCardResult> {
  const creds = await wappiAuth(storeId);
  if (!creds) throw new Error("Wappi não configurada.");

  const amount = Math.round(input.amountCents);
  const body: Record<string, unknown> = {
    amount,
    payment_method: "credit_card",
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    customer: buildCustomer(input.customer),
    items: [{ title: (input.description || "Pedido").slice(0, 120), unit_price: amount, quantity: 1, tangible: true }],
    card: {
      number: (input.card.number || "").replace(/\D/g, ""),
      holder_name: input.card.holderName,
      expiration_month: Number(input.card.expirationMonth),
      expiration_year: Number(input.card.expirationYear),
      cvv: input.card.cvv,
    },
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
    if (res.status >= 500 && !companyId) {
      throw new Error("Cartão indisponível na Wappi: a conta não foi identificada pelas chaves. Confira a Public Key e a Secret Key no painel.");
    }
    // Adquirente de cartão não configurada/funcional na conta Wappi.
    if (/acquirer|adquirente/i.test(raw)) {
      console.error("[wappi] cartão", res.status, raw.slice(0, 400));
      throw new Error("Cartão recusado pela adquirente da Wappi. A adquirente de cartão da sua conta não está ativa, fale com o suporte da Wappi. O Pix funciona normalmente.");
    }
    throw apiError("Falha ao processar o cartão", res, data, texto);
  }

  const tx = firstTxn(data);
  return {
    id: String(tx.id),
    status: normalizeWappiStatus(tx.status),
    statusDetail: String(tx.status ?? ""),
  };
}

/** Consulta o status normalizado de uma transação Wappi (ou null). */
export async function getWappiTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const creds = await wappiAuth(storeId);
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
    if (ID_EMPRESA.test(cid) && cid !== creds.companyId) {
      await salvarWappiCompanyId(storeId, cid).catch(() => {});
    }
    return typeof tx?.status === "string" ? normalizeWappiStatus(tx.status) : null;
  } catch {
    return null;
  }
}
