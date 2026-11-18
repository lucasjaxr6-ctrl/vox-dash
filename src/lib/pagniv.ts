import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPagnivCredentials, getStoreName } from "./settings";
import { buildPixBody, buildCardBody, missingFields } from "./pagniv-payload";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração PagNiv — Pix + cartão.
//
// Um endpoint só (POST /v1/charges) para os dois métodos; o que muda é
// `paymentMethod`. Autenticação simples: header `X-API-Key: sk_live_...`.
// Toda resposta vem envelopada em { success, data }.
//
// TRÊS COISAS QUE DESTOAM DOS OUTROS GATEWAYS DA CASA:
//  1. `externalId` é OBRIGATÓRIO e volta no webhook — dá conciliação 1:1 com o
//     nosso pedido, sem adivinhar id.
//  2. O cartão é síncrono: 201 já vem PAID, ou 402 CARD_DECLINED.
//  3. A chave de tokenização e a URL vêm de GET /v1/charges/card-config, e a doc
//     manda NÃO fixá-las no código ("se a Pagniv trocar de infraestrutura, sua
//     integração continua funcionando"). Por isso não há coluna de public key.
//
// Doc: https://devs.pagniv.com/docs/introducao
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.pagniv.com/v1";

/** Mapeia o status da PagNiv para o vocabulário interno. */
export function normalizePagnivStatus(status: string | undefined): string {
  switch ((status || "").toUpperCase()) {
    case "PAID":
      return "APPROVED";
    case "REFUNDED":
      return "REFUNDED";
    case "DISPUTED":
      return "CHARGEBACK";
    case "EXPIRED":
    case "CANCELLED":
    case "CANCELED":
      return "DECLINED";
    // PENDING: ainda indefinido — no-op seguro.
    default:
      return "PENDING";
  }
}

async function apiKey(storeId: string): Promise<string | null> {
  const creds = await getPagnivCredentials(storeId);
  return creds?.apiKey ?? null;
}

function apiError(prefix: string, res: Response, data: any): Error {
  const detail =
    data?.error?.message ||
    data?.message ||
    data?.error ||
    (data?.errors ? JSON.stringify(data.errors).slice(0, 200) : "") ||
    "sem detalhe";
  const codigo = data?.error?.code ? ` (${data.error.code})` : "";
  console.error("[pagniv]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  return new Error(`${prefix}: ${detail}${codigo} [HTTP ${res.status}]`);
}

/** Toda resposta da PagNiv vem em { success, data }. */
function dadosDe(data: any): any {
  return data?.data ?? data ?? {};
}

type ChamadaOpts = { method?: string; body?: unknown };

async function chamar(storeId: string, caminho: string, opts: ChamadaOpts = {}) {
  const key = await apiKey(storeId);
  if (!key) throw new Error("PagNiv não configurada. Informe a chave de API no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? "GET",
    headers: {
      "X-API-Key": key,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Cria uma cobrança Pix na PagNiv. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    expiresInSeconds?: number;
  },
): Promise<PixCharge> {
  // Sem `externalId` a PagNiv recusa — e é ele que casa o webhook com o pedido.
  const externalId = (input.externalReference || "").trim();
  if (!externalId) throw new Error("PagNiv exige o identificador do pedido (externalId).");

  const body = buildPixBody({
    amountCents: input.amountCents,
    externalId,
    customer: input.customer,
    description: input.description,
    expiresInSeconds: input.expiresInSeconds,
  });

  // Barreira local: a doc lista os obrigatórios, então um corpo incompleto é
  // erro NOSSO. Melhor falhar aqui, com o campo nomeado, do que receber um 400
  // genérico e ficar adivinhando.
  const faltando = missingFields(body);
  if (faltando.length) throw new Error(`PagNiv: faltam campos obrigatórios (${faltando.join(", ")}).`);

  const { res, data } = await chamar(storeId, "/charges", { method: "POST", body });
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const c = dadosDe(data);
  const qrCode = String(c.qrCode ?? "");
  if (!qrCode) throw new Error("PagNiv não retornou o código Pix (copia e cola).");
  return {
    id: String(c.id ?? ""),
    status: normalizePagnivStatus(c.status),
    qrCode,
    // Eles JÁ devolvem a imagem pronta em base64 (data:image/png;base64,...) —
    // raro entre os gateways, e poupa o checkout de desenhar o QR.
    qrCodeUrl: typeof c.qrCodeBase64 === "string" && c.qrCodeBase64.startsWith("data:") ? c.qrCodeBase64 : null,
    expiresAt: c.expiresAt ? String(c.expiresAt) : null,
  };
}

export type PagnivCardResult = { id: string; status: string; statusDetail: string; brand?: string; last4?: string };

/**
 * Cobrança no CARTÃO. Síncrona e SÓ com token: o cartão é tokenizado no
 * navegador contra `tokenizeUrl`, e o número nunca chega aqui.
 */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    maxInstallments?: number;
    externalReference?: string;
    cardToken: string;
  },
): Promise<PagnivCardResult> {
  const externalId = (input.externalReference || "").trim();
  if (!externalId) throw new Error("PagNiv exige o identificador do pedido (externalId).");
  const token = (input.cardToken || "").trim();
  if (!token) throw new Error("Token do cartão ausente.");

  const storeName = await getStoreName(storeId).catch(() => "");
  const body = buildCardBody({
    amountCents: input.amountCents,
    externalId,
    customer: input.customer,
    description: input.description,
    cardToken: token,
    installments: input.installments,
    maxInstallments: input.maxInstallments,
    statementDescriptor: storeName || undefined,
  });

  const faltando = missingFields(body);
  if (faltando.length) throw new Error(`PagNiv: faltam campos obrigatórios (${faltando.join(", ")}).`);

  const { res, data } = await chamar(storeId, "/charges", { method: "POST", body });
  if (!res.ok) {
    // 402 CARD_DECLINED é RECUSA, não falha de integração: devolvemos DECLINED
    // para a rota gravar o gateway + o id e responder 402 ao cliente — e não
    // 502, que soaria como sistema fora do ar.
    const codigo = String(data?.error?.code ?? "");
    if (res.status === 402 || codigo === "CARD_DECLINED") {
      const c = dadosDe(data);
      return {
        id: String(c?.id ?? ""),
        status: "DECLINED",
        statusDetail: String(data?.error?.message ?? (codigo || "Cartão recusado")),
        brand: c?.cardBrand ? String(c.cardBrand) : undefined,
        last4: c?.cardLastDigits ? String(c.cardLastDigits) : undefined,
      };
    }
    // 403 CARD_NOT_ENABLED é configuração da conta, não do cliente. Vira erro
    // para a rota logar — o cliente vê a mensagem genérica de sempre.
    throw apiError("Falha ao processar o cartão", res, data);
  }

  const c = dadosDe(data);
  return {
    id: String(c.id ?? ""),
    status: normalizePagnivStatus(c.status),
    statusDetail: String(c.status ?? ""),
    brand: c.cardBrand ? String(c.cardBrand) : undefined,
    last4: c.cardLastDigits ? String(c.cardLastDigits) : undefined,
  };
}

export type PagnivCardConfig = { publicKey: string; tokenizeUrl: string; maxInstallments: number; cardEnabled: boolean };

/**
 * Configuração de tokenização (chave pública + URL).
 *
 * Vem da API por exigência da doc — nada de fixar no código. Guardamos em
 * memória por 5 min: é valor estável, e buscar a cada checkout colocaria uma
 * chamada de rede no caminho crítico da compra.
 */
const cacheCardConfig = new Map<string, { em: number; cfg: PagnivCardConfig }>();
const CACHE_MS = 5 * 60_000;

export async function getPagnivCardConfig(storeId: string): Promise<PagnivCardConfig | null> {
  const agora = Date.now();
  const guardado = cacheCardConfig.get(storeId);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.cfg;
  try {
    const { res, data } = await chamar(storeId, "/charges/card-config");
    if (!res.ok) return null;
    const d = dadosDe(data);
    const cfg: PagnivCardConfig = {
      publicKey: String(d.publicKey ?? ""),
      tokenizeUrl: String(d.tokenizeUrl ?? ""),
      maxInstallments: Number(d.maxInstallments ?? 12) || 12,
      cardEnabled: d.cardEnabled !== false,
    };
    if (!cfg.publicKey || !cfg.tokenizeUrl) return null;
    cacheCardConfig.set(storeId, { em: agora, cfg });
    return cfg;
  } catch {
    return null;
  }
}

/** Consulta o status normalizado de uma cobrança PagNiv (ou null). */
export async function getPagnivTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/charges/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const c = dadosDe(data);
    return typeof c?.status === "string" ? normalizePagnivStatus(c.status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere a assinatura HMAC-SHA256 do webhook (`X-Webhook-Signature`).
 *
 * Formato do header: `sha256=<hex>`. Usa comparação de tempo constante — um
 * `===` aqui vaza, byte a byte, quanto do prefixo está certo.
 */
export function verifyPagnivSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  try {
    const recebida = header.replace(/^sha256=/, "").trim();
    const esperada = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(recebida, "utf8");
    const b = Buffer.from(esperada, "utf8");
    // timingSafeEqual exige o mesmo tamanho: comparar antes evita o throw e já
    // descarta assinatura de tamanho errado.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Checa se a chave autentica. Bate em /charges com limite 1 — leitura barata,
 * sem criar nada. 401 distingue chave errada de instabilidade.
 */
export async function checkPagnivCredentials(storeId: string): Promise<{ ok: boolean; error?: string; cardEnabled?: boolean }> {
  const key = await apiKey(storeId);
  if (!key) return { ok: false, error: "Chave de API não configurada." };
  try {
    const { res } = await chamar(storeId, "/charges?limit=1");
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Chave recusada pela PagNiv." };
    if (!res.ok) return { ok: false, error: `PagNiv respondeu ${res.status}.` };
    // De carona: diz se o cartão está liberado na conta, que é a pergunta
    // seguinte do lojista e evita descobrir isso só na primeira venda.
    const cfg = await getPagnivCardConfig(storeId);
    return { ok: true, cardEnabled: cfg?.cardEnabled ?? false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a PagNiv." };
  }
}
