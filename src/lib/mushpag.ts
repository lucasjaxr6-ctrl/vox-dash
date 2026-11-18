import "server-only";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { getMushpagCredentials, getStoreName, salvarSegredoWebhookMushpag } from "./settings";
import { buildChargeBody, missingFields, MUSHPAG_MIN_CENTS, MUSHPAG_MAX_PADRAO_CENTS } from "./mushpag-payload";
import { urlWebhook } from "./plataforma";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração MushPag: somente PIX, server-to-server.
//
// Base https://backend.mushpag.com · Auth `Authorization: Bearer {prefixo}.{segredo}`
//  - Criar:    POST /v1/charges        (centavos; Idempotency-Key OBRIGATÓRIO)
//  - Consultar GET  /v1/charges/{id}
//  - Webhook:  cadastrado só pela API (POST /v1/webhook-endpoints). Assinatura
//              `X-Signature: t=<unix>,v1=<hex>`, HMAC-SHA256 de "<t>.<corpo cru>".
//
// Três coisas que diferem dos outros gateways e moldam este arquivo:
//  • A cobrança vai de R$ 2,15 a R$ 300,00 por padrão (a conta pode ter limite
//    maior). Acima disso a API recusa com limit_exceeded.
//  • A criação pode voltar 202 `in_analysis` SEM o copia e cola. A doc manda
//    repetir com a MESMA Idempotency-Key até sair o resultado.
//  • `expired` NÃO é final: Pix pago depois do vencimento ainda vira `paid`.
//    Por isso expirado é PENDING aqui, nunca cancela o pedido.
//
// Doc: https://app.mushpag.com/docs
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://backend.mushpag.com";

/**
 * Eventos que pedimos no cadastro do webhook: só os que resolvem um pedido
 * PENDENTE. Estorno e contestação chegam com o pedido já pago, e o webhook
 * (como o dos outros gateways) não mexe em pedido pago.
 */
const EVENTOS_WEBHOOK = ["charge.paid", "charge.failed", "charge.canceled"];

/** Mapeia o status da MushPag para o vocabulário interno. */
export function normalizeMushpagStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "disputed":
      return "CHARGEBACK";
    case "failed":
    case "canceled":
    case "cancelled":
      return "DECLINED";
    // pending, in_analysis e expired ainda podem virar `paid`: PENDING é no-op.
    default:
      return "PENDING";
  }
}

/**
 * Erro com o envelope único da MushPag (`error.type`, `error.code`,
 * `details.field`, `request_id`). Os códigos que o lojista consegue resolver
 * ganham explicação em português; o resto sai como veio. Esta mensagem vai
 * para o LOG e para o painel, nunca para o comprador (ver safePixMessage).
 */
function apiError(prefix: string, res: Response, data: any): Error {
  const e = data?.error ?? {};
  const code = String(e?.code ?? "");
  const campo = e?.details?.field ? ` (campo ${e.details.field})` : "";
  const explicacao: Record<string, string> = {
    provider_unavailable: "a conta MushPag ainda não está habilitada (nenhuma adquirente ativa). Confira em Minha Adquirente, no painel deles",
    limit_exceeded: `valor acima do limite por cobrança da conta MushPag (padrão R$ ${(MUSHPAG_MAX_PADRAO_CENTS / 100).toFixed(2).replace(".", ",")})`,
    amount_below_minimum: `valor abaixo do mínimo da MushPag (R$ ${(MUSHPAG_MIN_CENTS / 100).toFixed(2).replace(".", ",")})`,
    merchant_not_active: "a conta MushPag está inativa",
    merchant_blocked: "a conta MushPag está bloqueada",
    scope_required: `a chave não tem a permissão ${e?.details?.required_scope ?? "necessária"}`,
    fee_policy_not_configured: "a conta MushPag está sem política de tarifa configurada (falar com o suporte deles)",
  };
  const detalhe = explicacao[code] ?? (e?.message || "sem detalhe");
  const ref = e?.request_id ? ` [request_id ${e.request_id}]` : "";
  console.error("[mushpag]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  return new Error(`${prefix}: ${detalhe}${campo}${code ? ` (${code})` : ""} [HTTP ${res.status}]${ref}`);
}

type Chamada = { method?: string; body?: unknown; idempotencyKey?: string };

async function chamar(apiKey: string, caminho: string, opts: Chamada = {}) {
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

async function chave(storeId: string): Promise<string> {
  const creds = await getMushpagCredentials(storeId);
  if (!creds?.apiKey) throw new Error("MushPag não configurada. Informe a chave de API no painel.");
  return creds.apiKey;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cria uma cobrança Pix na MushPag. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    address?: { uf?: string };
  },
): Promise<PixCharge> {
  const apiKey = await chave(storeId);
  const storeName = await getStoreName(storeId).catch(() => "");

  const body = buildChargeBody({
    amountCents: input.amountCents,
    buyer: { ...input.customer, uf: input.address?.uf },
    productName: input.description || (storeName ? `Pedido ${storeName}` : "Pedido"),
    reference: input.externalReference,
    metadata: {
      plataforma: "VoxCheckout",
      ...(storeName ? { loja: storeName } : {}),
      ...(input.externalReference ? { pedido: input.externalReference } : {}),
    },
  });

  // Barreira local: telefone com máscara, e-mail ausente ou valor abaixo do
  // mínimo viram 422 lá. Falhar aqui deixa a causa clara no log.
  const faltando = missingFields(body);
  if (faltando.length) throw new Error(`MushPag: dados da cobrança incompletos (${faltando.join(", ")}).`);

  // Chave NOVA a cada cobrança: a renovação do Pix cria outra cobrança para o
  // mesmo pedido, e reaproveitar a chave devolveria a cobrança já vencida.
  // A mesma chave só se repete abaixo, nas retentativas desta mesma criação.
  const idempotencyKey = randomUUID();

  // 202 `in_analysis` (sem copia e cola) e 409 `idempotency_key_in_flight`
  // pedem a mesma coisa: repetir com a mesma chave daqui a pouco. Até ~6s no
  // total, que é o que o comprador aguenta olhando o botão "Gerando Pix".
  let ch: any = null;
  for (const espera of [0, 1500, 3000]) {
    if (espera) await esperar(espera);
    const { res, data } = await chamar(apiKey, "/v1/charges", { method: "POST", body, idempotencyKey });
    const emAndamento = res.status === 409 && data?.error?.code === "idempotency_key_in_flight";
    if (!res.ok && !emAndamento) throw apiError("Falha ao gerar o Pix", res, data);
    if (emAndamento) continue;
    ch = data;
    if (String(data?.emv ?? "")) break;
  }

  const qrCode = String(ch?.emv ?? "");
  if (!qrCode) {
    const status = String(ch?.status ?? "sem resposta");
    throw new Error(`MushPag não devolveu o código Pix a tempo (status ${status}).`);
  }
  return {
    id: String(ch.id ?? ""),
    status: normalizeMushpagStatus(ch.status),
    qrCode,
    qrCodeUrl: null, // a MushPag só devolve o copia e cola; a imagem do QR é nossa
    expiresAt: ch?.expires_at ? String(ch.expires_at) : null, // ISO com fuso explícito
  };
}

/** Consulta o status normalizado de uma cobrança MushPag (ou null). */
export async function getMushpagTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const apiKey = await chave(storeId);
    const { res, data } = await chamar(apiKey, `/v1/charges/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return typeof data?.status === "string" ? normalizeMushpagStatus(data.status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere a assinatura do webhook: `X-Signature: t=<unix>,v1=<hex>`, com
 * v1 = HMAC-SHA256("<t>.<corpo cru>", segredo do endpoint).
 *
 * A tolerância de tempo é larga (3 dias) de propósito: a MushPag reenvia por
 * até ~33h, e a doc não diz se o `t` é renovado a cada reenvio. Replay não é
 * risco aqui, porque toda entrega só dispara uma RE-CONSULTA do status na API.
 */
export function verifyMushpagSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  toleranciaSegundos = 3 * 86400,
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
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Confere a chave com LEITURAS (nunca cria cobrança): lista uma cobrança
 * (permissão charge:read, que a consulta de status precisa) e, se a chave
 * puder, lê o saldo para mostrar o limite por cobrança da conta.
 */
export async function checkMushpagCredentials(storeId: string): Promise<{ ok: boolean; info?: string; error?: string }> {
  let apiKey: string;
  try {
    apiKey = await chave(storeId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Chave não configurada." };
  }
  try {
    const { res } = await chamar(apiKey, "/v1/charges?limit=1");
    if (res.status === 401) return { ok: false, error: "Chave recusada pela MushPag. Confira se copiou o par completo (prefixo.segredo)." };
    if (res.status === 403) return { ok: false, error: "A chave não tem a permissão charge:read, necessária para confirmar pagamentos." };
    if (!res.ok) return { ok: false, error: `MushPag respondeu ${res.status}.` };

    const saldo = await chamar(apiKey, "/v1/balance").catch(() => null);
    const max = Number(saldo?.data?.limits?.max_charge_amount);
    const limite = Number.isFinite(max) && max > 0 ? Math.max(max, MUSHPAG_MAX_PADRAO_CENTS) : null;
    const info = limite ? ` Limite por cobrança: R$ ${(limite / 100).toFixed(2).replace(".", ",")}.` : "";
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a MushPag." };
  }
}

/**
 * Garante que a conta MushPag avisa o nosso webhook.
 *
 * A MushPag não tem tela para isso: o endpoint só é cadastrado pela API, e o
 * segredo de assinatura (whsec_…) volta UMA vez, na criação. Por isso:
 *  • já existe endpoint com a nossa URL → não cria outro (a conta tem teto de
 *    12, e dois iguais mandariam cada evento em dobro); reativa se estiver
 *    desligado;
 *  • não existe → cria e grava o segredo.
 * Quando o endpoint já existia, o segredo dele não volta mais. Tudo bem: o
 * webhook confirma o pagamento re-consultando a API, a assinatura é camada extra.
 */
export async function garantirWebhookMushpag(
  storeId: string,
): Promise<{ ok: boolean; estado?: "criado" | "existente" | "reativado"; error?: string }> {
  try {
    const apiKey = await chave(storeId);
    const url = urlWebhook("mushpag");
    const semBarra = (u: unknown) => String(u ?? "").trim().replace(/\/+$/, "");

    const lista = await chamar(apiKey, "/v1/webhook-endpoints");
    if (lista.res.status === 403) {
      return { ok: false, error: "A chave não tem a permissão webhook:manage. Crie uma chave com essa permissão para os pagamentos confirmarem na hora." };
    }
    if (!lista.res.ok) return { ok: false, error: `Não consegui ler os webhooks da conta (HTTP ${lista.res.status}).` };

    const itens: any[] = Array.isArray(lista.data) ? lista.data : (lista.data?.data ?? lista.data?.items ?? []);
    const atual = itens.find((e) => semBarra(e?.url) === url);
    if (atual) {
      if (atual.enabled === false) {
        const id = atual.identifier ?? atual.id;
        const r = await chamar(apiKey, `/v1/webhook-endpoints/${encodeURIComponent(String(id))}`, {
          method: "PATCH",
          body: { enabled: true },
          idempotencyKey: randomUUID(),
        });
        if (!r.res.ok) return { ok: false, error: `O webhook existe mas está desligado, e não consegui religar (HTTP ${r.res.status}).` };
        return { ok: true, estado: "reativado" };
      }
      return { ok: true, estado: "existente" };
    }

    const novo = await chamar(apiKey, "/v1/webhook-endpoints", {
      method: "POST",
      body: { url, event_types: EVENTOS_WEBHOOK },
      idempotencyKey: randomUUID(),
    });
    if (!novo.res.ok) throw apiError("Falha ao cadastrar o webhook", novo.res, novo.data);
    const secret = String(novo.data?.secret ?? novo.data?.data?.secret ?? "");
    if (secret) await salvarSegredoWebhookMushpag(storeId, secret);
    return { ok: true, estado: "criado" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao cadastrar o webhook na MushPag." };
  }
}
