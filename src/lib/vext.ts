import "server-only";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { storefrontUrl } from "./storefront";
import { getVextCredentials, getStoreName } from "./settings";
import { buildPixBody, missingFields } from "./vext-payload";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Vext — somente PIX.
//
// Quatro endpoints: criar, consultar, estornar e saldo. Sem cartão, sem
// tokenização, sem SDK no navegador — é a integração mais simples da casa.
//
// Auth: `Authorization: Bearer sk_live_…` (ou `sk_test_…` no sandbox deles).
//
// Dois cuidados que a doc deles explicita e que valem mais que o normal:
//  • telefone vai SEPARADO em DDD e número;
//  • sem e-mail, documento ou telefone a cobrança é aceita e volta SEM QR CODE
//    — falha silenciosa, que só apareceria como "o cliente não consegue pagar".
//
// Doc: https://docs.usevext.com (llms-full.txt tem tudo; o OpenAPI está em
// /api-reference/openapi.yaml)
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.usevext.com";

/** Mapeia o status da Vext para o vocabulário interno. */
export function normalizeVextStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "APPROVED";
    // Estorno parcial: o pedido continua pago. Só o total desfaz a venda.
    case "partially_refunded":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
      return "CHARGEBACK";
    case "failed":
    case "expired":
    case "canceled":
    case "cancelled":
      return "DECLINED";
    // pending, processing e in_analysis ainda mudam sozinhos: PENDING é no-op.
    default:
      return "PENDING";
  }
}

async function apiKey(storeId: string): Promise<string | null> {
  const creds = await getVextCredentials(storeId);
  return creds?.apiKey ?? null;
}

/**
 * A Vext usa um envelope único de erro, com `type` e `code` estáveis.
 * Preservamos os dois na mensagem: é o que distingue "cartão recusado" de
 * "chave sem escopo" quando isso for parar no pedido.
 */
function apiError(prefix: string, res: Response, data: any): Error {
  const e = data?.error ?? data;
  const detalhe = e?.message || e?.detail || "sem detalhe";
  const codigo = [e?.type, e?.code].filter(Boolean).join("/");
  console.error("[vext]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  return new Error(`${prefix}: ${detalhe}${codigo ? ` (${codigo})` : ""} [HTTP ${res.status}]`);
}

function cobrancaDe(data: any): any {
  return data?.data ?? data?.charge ?? data ?? {};
}

type Chamada = { method?: string; body?: unknown; idempotencyKey?: string };

async function chamar(storeId: string, caminho: string, opts: Chamada = {}) {
  const key = await apiKey(storeId);
  if (!key) throw new Error("Vext não configurada. Informe a chave secreta no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      // A Vext aceita Idempotency-Key: com ela, repetir um POST depois de um
      // erro de rede devolve a MESMA cobrança em vez de criar outra.
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Cria uma cobrança Pix na Vext. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    externalReference?: string;
    checkoutUrl?: string;
    expiresInSeconds?: number;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
  },
): Promise<PixCharge> {
  const storeName = await getStoreName(storeId).catch(() => "");
  const checkout = input.checkoutUrl ?? "";

  const body = buildPixBody({
    amountCents: input.amountCents,
    customer: input.customer,
    description: input.description,
    reference: input.externalReference,
    items: input.items,
    payerIp: input.payerIp,
    expiresInSeconds: input.expiresInSeconds ?? 86400,
    // Valores como STRING, por exigência do contrato deles.
    metadata: {
      plataforma: "VoxCheckout",
      ...(storeName ? { loja: storeName } : {}),
      ...(checkout ? { checkout } : {}),
      ...(storefrontUrl(checkout) ? { site: storefrontUrl(checkout)! } : {}),
    },
  });

  // Barreira local. Aqui ela vale mais que nos outros gateways: faltar e-mail,
  // documento ou telefone NÃO dá erro na Vext — devolve cobrança sem QR code, e
  // o problema só apareceria como "o cliente não consegue pagar".
  const faltando = missingFields(body);
  if (faltando.length) throw new Error(`Vext: dados do comprador incompletos (${faltando.join(", ")}).`);

  const { res, data } = await chamar(storeId, "/v1/charges", {
    method: "POST",
    body,
    // Mesmo pedido = mesma chave: um retry nosso não vira segunda cobrança.
    idempotencyKey: input.externalReference || randomUUID(),
  });
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const ch = cobrancaDe(data);
  const qrCode = String(ch?.pix?.qr_code ?? "");
  if (!qrCode) throw new Error("Vext não retornou o código Pix (copia e cola).");
  return {
    id: String(ch.id ?? ""),
    status: normalizeVextStatus(ch.status),
    qrCode,
    qrCodeUrl: null, // a doc avisa: não devolvem PNG, a imagem é nossa
    expiresAt: ch?.pix?.expires_at ? String(ch.pix.expires_at) : null,
  };
}

/** Consulta o status normalizado de uma cobrança Vext (ou null). */
export async function getVextTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/v1/charges/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const ch = cobrancaDe(data);
    return typeof ch?.status === "string" ? normalizeVextStatus(ch.status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere a assinatura do webhook.
 *
 * Formato: `X-Vext-Signature: t=<timestamp>,v1=<hmac>`, onde o hmac é
 * `HMAC-SHA256("<timestamp>.<corpo bruto>", <segredo>)`.
 *
 * O timestamp entra no cálculo para que uma entrega capturada não possa ser
 * reenviada depois — por isso também recusamos o que for velho demais.
 */
export function verifyVextSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranciaSegundos = 300,
): boolean {
  if (!header || !secret) return false;
  try {
    const partes = Object.fromEntries(
      header.split(",").map((p) => {
        const [k, ...resto] = p.trim().split("=");
        return [k, resto.join("=")];
      }),
    ) as Record<string, string>;
    const t = partes.t;
    const recebida = partes.v1;
    if (!t || !recebida) return false;

    const idade = Math.abs(Date.now() / 1000 - Number(t));
    if (!Number.isFinite(idade) || idade > toleranciaSegundos) return false;

    const esperada = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
    const a = Buffer.from(recebida, "utf8");
    const b = Buffer.from(esperada, "utf8");
    if (a.length !== b.length) return false;
    // Tempo constante: um `===` vaza, byte a byte, quanto do prefixo acertou.
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Checa se a chave autentica, lendo o saldo (não cria nada). */
export async function checkVextCredentials(storeId: string): Promise<{ ok: boolean; error?: string }> {
  const key = await apiKey(storeId);
  if (!key) return { ok: false, error: "Chave secreta não configurada." };
  try {
    const { res, data } = await chamar(storeId, "/v1/balance");
    if (res.status === 401) return { ok: false, error: "Chave recusada pela Vext." };
    // A doc separa 401 (quem é você) de 403 (pode, mas não neste escopo).
    if (res.status === 403) return { ok: false, error: "Chave sem permissão para consultar saldo." };
    if (!res.ok) return { ok: false, error: `Vext respondeu ${res.status}.` };
    const saldo = cobrancaDe(data);
    const disponivel = typeof saldo?.available === "number" ? ` Disponível: R$ ${(saldo.available / 100).toFixed(2)}.` : "";
    return { ok: true, error: disponivel || undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a Vext." };
  }
}
