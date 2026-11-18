import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getNuvraCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Nuvra Payments — Pix + cartão.
//
// Doc (página única): https://nuvrapayments.com/documentacao. Sem llms.txt nem
// OpenAPI. O domínio antigo paynuvra.com foi desativado em 30/09/2026.
//
// Autenticação: `Authorization: Bearer nvr_live_…` (ou `nvr_dev_…`, que roda
// em sandbox na MESMA base; o ambiente vem do prefixo da chave, não do host).
// Um endpoint para os dois métodos: POST /charges, com `method` "pix" | "card".
// Valores em CENTAVOS. Pix mínimo R$ 1,00.
//
// O QUE DESTOA DOS OUTROS GATEWAYS DA CASA:
//  1. `externalReference` é chave de IDEMPOTÊNCIA: o mesmo valor com o mesmo
//     corpo devolve a cobrança que já existe (200), e com corpo diferente dá
//     409. A renovação do Pix (lib/pix-renew.ts) manda o mesmo pedido de novo
//     e receberia o Pix VENCIDO de volta. Por isso cada cobrança leva um
//     sufixo (`<orderId>.<carimbo>`) e o webhook recupera o pedido pelo
//     prefixo (ver `pedidoDaReferencia`).
//  2. Cartão: tokenizado no NAVEGADOR contra a `tokenizeUrl` que vem de
//     GET /card-tokenization, junto com o `processor`, que tem de voltar
//     igual na cobrança. O formato do corpo muda pelo `scheme` (s1 / s2 /
//     sandbox) — ver lib/nuvra-card.ts.
//  3. Cartão exige CEP e número do endereço do TITULAR, além de e-mail e
//     telefone do comprador. Faltando um, 422 e nada é cobrado.
//  4. Webhook cadastrado no PAINEL da Nuvra (Desenvolvedor → Webhooks), não
//     por cobrança. Assinado: HMAC-SHA256 do corpo cru, em hex, no header
//     X-Nuvra-Signature.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://nuvrapayments.com/api/v1";

/** Validade do Pix: 30 min, o mesmo que o checkout promete ("vale por 30 minutos"). */
const PIX_VALIDADE_S = 1800;

/** Mapeia o status da Nuvra para o vocabulário interno. */
export function normalizeNuvraStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "APPROVED";
    case "refused":
      return "DECLINED";
    // Pix vencido. O settle não cancela pedido de Pix (ele fica pendente,
    // recuperável); no cartão não acontece.
    case "expired":
      return "DECLINED";
    case "refunded":
      return "REFUNDED";
    // pending (Pix aguardando), authorized e under_review (cartão esperando a
    // liquidação ou em análise): ainda indefinido, no-op seguro. Só `approved`
    // credita saldo, segundo a doc.
    default:
      return "PENDING";
  }
}

/**
 * `externalReference` desta cobrança: o id do pedido + um carimbo curto.
 * Ver o item 1 do cabeçalho. O pedido é um UUID (36 caracteres) e o limite
 * da Nuvra é 128.
 */
function referenciaDaCobranca(orderId: string): string {
  return `${orderId}.${Date.now().toString(36)}`;
}

/** Id do pedido a partir do `externalReference` que volta no webhook. */
export function pedidoDaReferencia(ref: string | undefined | null): string | null {
  const m = String(ref ?? "").match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1].toLowerCase() : null;
}

async function apiKey(storeId: string): Promise<string | null> {
  const creds = await getNuvraCredentials(storeId);
  return creds?.apiKey ?? null;
}

/**
 * Erro legível a partir do corpo da Nuvra: { error, message?, details? }.
 * O `details.fieldErrors` diz QUAL campo faltou, e sem ele um 422 vira
 * adivinhação.
 */
function apiError(prefix: string, res: Response, data: any): Error {
  const campos = data?.details?.fieldErrors ? JSON.stringify(data.details.fieldErrors).slice(0, 300) : "";
  const detail = data?.message || campos || data?.error || "sem detalhe";
  const codigo = data?.error && data?.message ? ` (${data.error})` : "";
  console.error("[nuvra]", prefix, res.status, JSON.stringify(data).slice(0, 400));
  return new Error(`${prefix}: ${detail}${codigo} [HTTP ${res.status}]`);
}

type ChamadaOpts = { method?: string; body?: unknown };

async function chamar(storeId: string, caminho: string, opts: ChamadaOpts = {}) {
  const key = await apiKey(storeId);
  if (!key) throw new Error("Nuvra não configurada. Informe a API Key no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/**
 * Comprador no formato da Nuvra. No Pix tudo é opcional, mas campo enviado é
 * validado (CPF com dígito, telefone BR): mandamos só o que existe, e vazio
 * nunca vai como "" (a doc trata vazio como ausente, mas um CPF malformado
 * derruba a cobrança com 422).
 */
function comprador(c: PixCustomer) {
  const doc = (c.document || "").replace(/\D/g, "");
  const tel = (c.phone || "").replace(/\D/g, "");
  return {
    ...(c.name?.trim() ? { name: c.name.trim() } : {}),
    ...(doc.length === 11 || doc.length === 14 ? { document: doc } : {}),
    ...(c.email?.trim() ? { email: c.email.trim() } : {}),
    ...(tel.length >= 10 ? { phone: tel } : {}),
  };
}

/** Cria uma cobrança Pix na Nuvra. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
  },
): Promise<PixCharge> {
  const orderId = (input.externalReference || "").trim();
  if (!orderId) throw new Error("Nuvra exige o identificador do pedido (externalReference).");
  const amount = Math.round(input.amountCents);
  if (amount < 100) throw new Error("Nuvra: o Pix precisa ser de pelo menos R$ 1,00.");

  const body = {
    amount,
    method: "pix",
    externalReference: referenciaDaCobranca(orderId),
    customer: comprador(input.customer),
    ...(input.description?.trim() ? { description: input.description.trim().slice(0, 200) } : {}),
    expiresIn: PIX_VALIDADE_S,
  };

  const { res, data } = await chamar(storeId, "/charges", { method: "POST", body });
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const qrCode = String(data?.pix?.copyPaste ?? "");
  if (!qrCode) throw new Error("Nuvra não retornou o código Pix (copia e cola).");
  const imagem = data?.pix?.qrCodeBase64;
  return {
    id: String(data?.id ?? ""),
    status: normalizeNuvraStatus(data?.status),
    qrCode,
    // Vem como data URI (PNG em base64). A rota descarta se passar do tamanho
    // da coluna; o checkout desenha o QR a partir do copia e cola de qualquer forma.
    qrCodeUrl: typeof imagem === "string" && imagem.startsWith("data:") ? imagem : null,
    expiresAt: data?.pix?.expiresAt ? String(data.pix.expiresAt) : null,
  };
}

export type NuvraCardConfig = {
  available: boolean;
  /** Código opaco da processadora DESTA conta; volta igual em `card.processor`. */
  processor: string;
  /** Formato da tokenização: "s1" | "s2" | "sandbox". */
  scheme: string;
  publicKey: string;
  /** Endpoint do provedor onde o NAVEGADOR posta o cartão. Ausente no sandbox. */
  tokenizeUrl: string;
  maxInstallments: number;
};

/**
 * Configuração de tokenização da conta (GET /card-tokenization).
 *
 * Em memória por 5 min: é estável, e buscar a cada checkout poria uma chamada
 * de rede no caminho da compra. Com o cartão desligado na conta a Nuvra
 * responde 503 (card_charges_disabled), e aqui vira null.
 */
const cacheCardConfig = new Map<string, { em: number; cfg: NuvraCardConfig }>();
const CACHE_MS = 5 * 60_000;

export async function getNuvraCardConfig(storeId: string): Promise<NuvraCardConfig | null> {
  const agora = Date.now();
  const guardado = cacheCardConfig.get(storeId);
  if (guardado && agora - guardado.em < CACHE_MS) return guardado.cfg;
  try {
    const { res, data } = await chamar(storeId, "/card-tokenization");
    if (!res.ok) return null;
    const cfg: NuvraCardConfig = {
      available: data?.available !== false,
      processor: String(data?.processor ?? ""),
      scheme: String(data?.scheme ?? ""),
      publicKey: String(data?.publicKey ?? ""),
      tokenizeUrl: String(data?.tokenizeUrl ?? ""),
      maxInstallments: Number(data?.maxInstallments ?? 1) || 1,
    };
    // Sandbox não tem URL de tokenização (o token é montado no navegador).
    if (!cfg.processor || !cfg.scheme || (cfg.scheme !== "sandbox" && !cfg.tokenizeUrl)) return null;
    cacheCardConfig.set(storeId, { em: agora, cfg });
    return cfg;
  } catch {
    return null;
  }
}

export type NuvraCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO, só com token: o número nunca chega aqui (a API recusa
 * número, validade e CVV no corpo).
 *
 * A resposta síncrona é `approved`, `authorized`, `under_review` ou
 * `refused`. Só `approved` é dinheiro na conta; os dois do meio ficam
 * pendentes e o webhook (charge.paid / charge.failed) decide.
 */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    installments: number;
    externalReference: string;
    cardToken: string;
    holderName: string;
    holderDocument: string;
    holderPostalCode: string;
    holderAddressNumber: string;
    /** Nome na fatura (soft descriptor). A Nuvra corta em ~13 caracteres. */
    statementDescriptor?: string;
  },
): Promise<NuvraCardResult> {
  const orderId = (input.externalReference || "").trim();
  if (!orderId) throw new Error("Nuvra exige o identificador do pedido (externalReference).");
  const token = (input.cardToken || "").trim();
  if (!token) throw new Error("Token do cartão ausente.");

  const cfg = await getNuvraCardConfig(storeId);
  if (!cfg || !cfg.available) throw new Error("Cartão indisponível na conta Nuvra (tokenização não liberada).");

  // A Nuvra RECUSA parcelas acima do máximo da conta, não corta. Barrar aqui
  // dá um motivo claro no pedido em vez de uma recusa sem explicação.
  const parcelas = Math.max(1, Math.round(input.installments) || 1);
  if (parcelas > cfg.maxInstallments) {
    throw new Error(`Nuvra: parcelamento em ${parcelas}x acima do máximo da conta (${cfg.maxInstallments}x).`);
  }

  // Obrigatórios do cartão (doc). Faltando, a Nuvra responde 422 sem cobrar;
  // conferir antes nomeia o campo no pedido.
  const doc = (input.customer.document || "").replace(/\D/g, "");
  const tel = (input.customer.phone || "").replace(/\D/g, "");
  const cep = (input.holderPostalCode || "").replace(/\D/g, "");
  const numero = (input.holderAddressNumber || "").trim();
  const faltando = [
    !input.customer.name?.trim() && "nome",
    !(doc.length === 11 || doc.length === 14) && "CPF",
    !input.customer.email?.trim() && "e-mail",
    tel.length < 10 && "telefone",
    cep.length !== 8 && "CEP",
    !numero && "número do endereço",
    !input.holderName?.trim() && "nome do titular",
  ].filter(Boolean);
  if (faltando.length) throw new Error(`Nuvra: faltam dados para o cartão (${faltando.join(", ")}).`);

  const titularDoc = (input.holderDocument || "").replace(/\D/g, "") || doc;
  const body = {
    amount: Math.round(input.amountCents),
    method: "card",
    externalReference: referenciaDaCobranca(orderId),
    customer: { name: input.customer.name.trim(), document: doc, email: input.customer.email.trim(), phone: tel },
    ...(input.statementDescriptor?.trim() ? { description: input.statementDescriptor.trim().slice(0, 200) } : {}),
    card: {
      token,
      processor: cfg.processor,
      holderName: input.holderName.trim(),
      holderDocument: titularDoc,
      holderPostalCode: cep,
      holderAddressNumber: numero.slice(0, 20),
      installments: parcelas,
    },
  };

  const { res, data } = await chamar(storeId, "/charges", { method: "POST", body });
  if (!res.ok) {
    // 402 card_charge_failed é RECUSA da adquirente (nada debitado), não falha
    // de integração: devolvemos DECLINED para a rota gravar o motivo e
    // responder 402 ao cliente, e não 502, que soaria como sistema fora do ar.
    if (res.status === 402 || data?.error === "card_charge_failed") {
      return {
        id: String(data?.id ?? ""),
        status: "DECLINED",
        statusDetail: String(data?.message ?? data?.error ?? "Cartão recusado"),
      };
    }
    throw apiError("Falha ao processar o cartão", res, data);
  }

  // 3DS só existe com `returnUrl` (não mandamos). Se a conta tiver 3DS
  // obrigatório e vier `authenticationUrl`, o pedido fica pendente e o log
  // avisa: o cliente não tem como concluir o desafio por aqui.
  if (data?.authenticationUrl) {
    console.error("[nuvra] cartão pediu 3DS, que esta integração não abre", data?.id);
  }

  return {
    id: String(data?.id ?? ""),
    status: normalizeNuvraStatus(data?.status),
    statusDetail: String(data?.status ?? ""),
  };
}

/** Consulta o status normalizado de uma cobrança Nuvra (ou null). */
export async function getNuvraTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/charges/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return typeof data?.status === "string" ? normalizeNuvraStatus(data.status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere a assinatura do webhook: HMAC-SHA256 do corpo CRU com o segredo, em
 * hex, no header X-Nuvra-Signature. Comparação de tempo constante (a doc
 * também mostra um `!==`, que vaza byte a byte quanto do prefixo acertou).
 */
export function verifyNuvraSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  try {
    const recebida = header.trim().toLowerCase();
    const esperada = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(recebida, "utf8");
    const b = Buffer.from(esperada, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Confere a chave com uma LEITURA (GET /balance), sem criar nada. De carona
 * diz o ambiente (chave de teste cobra de mentira) e o estado do cartão, que
 * depende de liberação da Nuvra.
 */
export async function checkNuvraCredentials(storeId: string): Promise<{
  ok: boolean;
  error?: string;
  environment?: string;
  card?: { scheme: string; maxInstallments: number; tokenizeHost: string | null } | null;
}> {
  const key = await apiKey(storeId);
  if (!key) return { ok: false, error: "API Key não configurada." };
  try {
    const { res, data } = await chamar(storeId, "/balance");
    if (res.status === 401) return { ok: false, error: "Chave recusada pela Nuvra (inválida ou revogada)." };
    if (res.status === 403) {
      return { ok: false, error: `Chave sem permissão na Nuvra${data?.required ? ` (falta o escopo ${data.required})` : ""}.` };
    }
    if (!res.ok) return { ok: false, error: `Nuvra respondeu ${res.status}.` };
    cacheCardConfig.delete(storeId);
    const cfg = await getNuvraCardConfig(storeId);
    let tokenizeHost: string | null = null;
    try {
      tokenizeHost = cfg?.tokenizeUrl ? new URL(cfg.tokenizeUrl).host : null;
    } catch {
      tokenizeHost = null;
    }
    return {
      ok: true,
      environment: String(data?.environment ?? ""),
      card: cfg && cfg.available ? { scheme: cfg.scheme, maxInstallments: cfg.maxInstallments, tokenizeHost } : null,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a Nuvra." };
  }
}
