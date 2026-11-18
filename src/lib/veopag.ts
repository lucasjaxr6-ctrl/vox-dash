import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { query, execute } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { getVeopagCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração VeoPag — Pix + cartão.
//
// Os dois saem do mesmo endpoint (POST /api/payments/deposit), mudando
// `paymentMethod`. Valores em REAIS (number com 2 casas), não em centavos.
//
// Auth em duas etapas: client_id + client_secret → JWT de 1 hora. A doc trata
// o cache do token como "o item mais importante da integração": o login aceita
// só 25 tentativas por IP a cada 15 min. Numa função serverless cada instância
// nasce sem memória, então o token fica em memória E no banco (criptografado,
// tabela `gateway_tokens`) — todas as instâncias reaproveitam o mesmo.
//
// `external_id` é chave de idempotência DELES: repetir devolve a cobrança
// antiga. A renovação de Pix cria cobrança nova para o mesmo pedido, então o
// external_id leva um sufixo por tentativa: `<orderId>.<base36>`. O webhook
// casa pelo transaction_id ou pelo orderId no começo do external_id.
//
// Cartão é cru (server-to-server), como Appmax/BlackCat — nunca gravado nem
// logado — e precisa ser liberado pelo suporte deles (senão 403 CARD_DISABLED).
//
// Doc: https://veopag.readme.io/llms.txt
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.veopag.com";
/** A doc manda renovar até ~55 min; deixamos folga. */
const TOKEN_TTL_MS = 50 * 60_000;

/** Status do depósito → vocabulário interno. */
export function normalizeVeopagStatus(status: string | undefined): string {
  switch ((status || "").toUpperCase()) {
    case "COMPLETED":
    case "PAID":
    // Estorno parcial: o pedido continua pago. Só o total desfaz a venda.
    case "PARTIALLY_REFUNDED":
      return "APPROVED";
    case "REFUNDED":
      return "REFUNDED";
    case "CHARGEBACK":
    case "CHARGEDBACK":
      return "CHARGEBACK";
    // FAILED no Pix é "expirou sem pagar": o settle não cancela pedido Pix.
    case "FAILED":
    case "CANCELLED":
    case "CANCELED":
      return "DECLINED";
    default:
      return "PENDING";
  }
}

const reais = (cents: number) => Math.round(cents) / 100;

// ── Token ────────────────────────────────────────────────────────────────────

const memoria = new Map<string, { token: string; ate: number }>();

/** Chave do cache: muda quando o client_id muda, e o token antigo morre junto. */
const chaveDe = (storeId: string, clientId: string) =>
  `${storeId}:${createHash("sha256").update(clientId).digest("hex").slice(0, 16)}`;

async function lerDoBanco(chave: string): Promise<{ token: string; ate: number } | null> {
  try {
    const [r] = await query<{ tokenEnc: string; expiresAt: Date }>(
      `SELECT tokenEnc, expiresAt FROM gateway_tokens WHERE cacheKey = ? AND expiresAt > NOW(3) LIMIT 1`,
      [chave],
    );
    return r ? { token: decryptSecret(r.tokenEnc), ate: new Date(r.expiresAt).getTime() } : null;
  } catch {
    return null; // tabela ausente ou segredo ilegível: segue para o login
  }
}

async function gravarNoBanco(chave: string, token: string, ate: number) {
  try {
    await execute(
      `INSERT INTO gateway_tokens (cacheKey, tokenEnc, expiresAt) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE tokenEnc = VALUES(tokenEnc), expiresAt = VALUES(expiresAt)`,
      [chave, encryptSecret(token), new Date(ate)],
    );
  } catch (e) {
    console.error("[veopag] cache de token:", e instanceof Error ? e.message : e);
  }
}

async function esquecerToken(storeId: string) {
  const creds = await getVeopagCredentials(storeId);
  if (!creds) return;
  const chave = chaveDe(storeId, creds.clientId);
  memoria.delete(chave);
  await execute(`DELETE FROM gateway_tokens WHERE cacheKey = ?`, [chave]).catch(() => {});
}

async function token(storeId: string): Promise<string> {
  const creds = await getVeopagCredentials(storeId);
  if (!creds) throw new Error("VeoPag não configurada. Informe o client_id e o client_secret no painel.");
  const chave = chaveDe(storeId, creds.clientId);

  const mem = memoria.get(chave);
  if (mem && mem.ate > Date.now()) return mem.token;
  const banco = await lerDoBanco(chave);
  if (banco) {
    memoria.set(chave, banco);
    return banco.token;
  }

  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.token) {
    if (res.status === 429) throw new Error("VeoPag: limite de login atingido. Tente de novo em alguns minutos.");
    throw new Error(`Falha na autenticação da VeoPag: ${data?.message || res.status}`);
  }
  const ate = Date.now() + TOKEN_TTL_MS;
  const novo = { token: String(data.token), ate };
  memoria.set(chave, novo);
  await gravarNoBanco(chave, novo.token, ate);
  return novo.token;
}

/** Chamada autenticada. Um 401 (token revogado) renova o token uma vez. */
async function chamar(storeId: string, caminho: string, body?: unknown, tentativa = 1): Promise<{ res: Response; data: any }> {
  const t = await token(storeId);
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if ((res.status === 401 || res.status === 403) && tentativa === 1) {
    // 403 aqui também pode ser "token inválido/expirado" (doc de consultas).
    // Uma renovação só: se persistir, é permissão de verdade.
    await esquecerToken(storeId);
    return chamar(storeId, caminho, body, 2);
  }
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[veopag]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  const detalhe = [data?.message, data?.code].filter(Boolean).join(" — ");
  return new Error(`${prefix}: ${detalhe || "sem detalhe"} [HTTP ${res.status}]`);
}

// ── Cobranças ────────────────────────────────────────────────────────────────

function pagador(c: PixCustomer) {
  let tel = (c.phone || "").replace(/\D/g, "");
  if (tel.startsWith("55") && (tel.length === 12 || tel.length === 13)) tel = tel.slice(2);
  return {
    name: (c.name || "").trim().slice(0, 120),
    email: (c.email || "").trim().slice(0, 180),
    document: (c.document || "").replace(/\D/g, ""),
    ...(tel.length >= 10 ? { phone: tel } : {}),
  };
}

/** `<orderId>.<sufixo>`: único por tentativa, e o orderId recuperável do começo. */
const externalId = (orderId: string | undefined) =>
  `${orderId || "pedido"}.${Date.now().toString(36)}`;

/** O orderId de volta a partir do external_id. */
export const pedidoDoExternalId = (ext: string) => ext.split(".")[0] || "";

function utms(tracking: Record<string, string | null | undefined> | undefined) {
  const out: Record<string, string> = {};
  for (const [k, max] of [["utm_source", 255], ["utm_medium", 64], ["utm_campaign", 255], ["utm_content", 255], ["utm_term", 255]] as const) {
    const v = tracking?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, max);
  }
  return out;
}

const respostaDe = (data: any) => data?.qrCodeResponse ?? data ?? {};

/** Cria um Pix. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    externalReference?: string;
    postbackUrl?: string;
    tracking?: Record<string, string | null | undefined>;
  },
): Promise<PixCharge> {
  const body = {
    amount: reais(input.amountCents),
    external_id: externalId(input.externalReference),
    payer: pagador(input.customer),
    ...(input.postbackUrl ? { clientCallbackUrl: input.postbackUrl } : {}),
    ...utms(input.tracking),
    platform: "VOX",
  };
  const { res, data } = await chamar(storeId, "/api/payments/deposit", body);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const r = respostaDe(data);
  const qrCode = String(r.qrcode ?? "");
  if (!qrCode) throw new Error("VeoPag não retornou o código Pix (copia e cola).");
  return {
    id: String(r.transactionId ?? r.transaction_id ?? ""),
    status: normalizeVeopagStatus(r.status),
    qrCode,
    qrCodeUrl: null, // a doc: o QR é gerado por nós a partir do copia e cola
    expiresAt: null,
  };
}

export type VeopagCardResult = { id: string; status: string; statusDetail: string };

/** Cobrança no cartão (dados crus, repassados via TLS — nunca gravados). */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    installments: number;
    externalReference?: string;
    postbackUrl?: string;
    card: { number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<VeopagCardResult> {
  const ano = (input.card.expirationYear || "").trim();
  const body = {
    paymentMethod: "card",
    amount: reais(input.amountCents),
    external_id: externalId(input.externalReference),
    payer: pagador(input.customer),
    card: {
      number: (input.card.number || "").replace(/\D/g, ""),
      holderName: (input.card.holderName || "").trim().slice(0, 120),
      expirationMonth: (input.card.expirationMonth || "").padStart(2, "0"),
      expirationYear: ano.length === 2 ? `20${ano}` : ano,
      cvv: input.card.cvv,
      installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    },
    ...(input.postbackUrl ? { clientCallbackUrl: input.postbackUrl } : {}),
    platform: "VOX",
  };

  const { res, data } = await chamar(storeId, "/api/payments/deposit", body);
  // 402 = recusa da operadora: é desfecho normal, não erro de integração.
  // Nenhuma transação é criada do lado deles nesse caso.
  if (res.status === 402) {
    return { id: "", status: "DECLINED", statusDetail: [data?.code, data?.message].filter(Boolean).join(" — ") || "CARD_REFUSED" };
  }
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const r = respostaDe(data);
  const c = r.card ?? {};
  const detalhe = [r.status, c.brand, c.last4 ? `final ${c.last4}` : null, c.authorizationCode ? `aut. ${c.authorizationCode}` : null]
    .filter(Boolean)
    .join(" · ");
  return { id: String(r.transactionId ?? ""), status: normalizeVeopagStatus(r.status), statusDetail: detalhe };
}

/** Depósito pelo transaction_id: status normalizado + o pedido a que pertence. */
export async function getVeopagDeposit(storeId: string, id: string): Promise<{ status: string; orderId: string } | null> {
  try {
    const { res, data } = await chamar(storeId, `/api/transactions/deposit?transaction_id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const d = data?.deposit;
    if (!d || typeof d.status !== "string") return null;
    return { status: normalizeVeopagStatus(d.status), orderId: pedidoDoExternalId(String(d.external_id ?? "")) };
  } catch {
    return null;
  }
}

/** Status normalizado de um depósito pelo transaction_id (ou null). */
export async function getVeopagTransactionStatus(storeId: string, id: string): Promise<string | null> {
  return (await getVeopagDeposit(storeId, id))?.status ?? null;
}

/**
 * Confere o HMAC do webhook: hex de HMAC-SHA256("<timestamp>.<corpo bruto>"),
 * com a "Webhook Signature" do painel deles. Recusa o que tiver mais de 5 min.
 */
export function verifyVeopagSignature(rawBody: string, assinatura: string | null, timestamp: string | null, segredo: string): boolean {
  if (!assinatura || !timestamp || !segredo) return false;
  const idade = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(idade) || idade > 300) return false;
  const esperada = createHmac("sha256", segredo).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(assinatura.trim().toLowerCase(), "utf8");
  const b = Buffer.from(esperada, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Confere as credenciais: faz o login e lê o saldo (não cria nada). */
export async function checkVeopagCredentials(storeId: string): Promise<{ ok: boolean; error?: string; saldo?: string }> {
  if (!(await getVeopagCredentials(storeId))) return { ok: false, error: "client_id e client_secret não configurados." };
  try {
    await esquecerToken(storeId); // testa o login de verdade, não um token antigo
    const { res, data } = await chamar(storeId, "/api/accounts/balance");
    if (!res.ok) return { ok: false, error: `VeoPag respondeu ${res.status}${data?.message ? `: ${data.message}` : ""}.` };
    const v = Number(data?.balance ?? data?.available ?? data?.data?.balance);
    return { ok: true, saldo: Number.isFinite(v) ? v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a VeoPag." };
  }
}
