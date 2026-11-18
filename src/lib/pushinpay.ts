import "server-only";
import { execute } from "./db";
import { getPushinpayCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração PushinPay — SOMENTE Pix (cash-in). API REST server-to-server.
//
//   Base:  https://api.pushinpay.com.br
//   Auth:  Authorization: Bearer <token>      (valores SEMPRE em centavos)
//   Criar: POST /api/pix/cashIn               (value mínimo 50 = R$ 0,50)
//   Ler:   GET  /api/transactions/{id}
//
// ⚠️ HTTPS de propósito: o OpenAPI deles declara o servidor como
// `http://api.pushinpay.com.br`. Mandar o Bearer token em texto puro seria
// entregar a credencial da loja para qualquer um no caminho. O host atende em
// TLS normalmente (confirmado), então usamos https e ignoramos o spec nesse
// ponto — é erro de documentação, não uma limitação do serviço.
//
// ⚠️ A cobrança NÃO aceita dados do comprador: não há campo de nome, CPF,
// e-mail, telefone, endereço nem itens. Sobram `description` e `utms` — e a
// `description` não serve de metadado interno, porque é justamente o texto que o
// COMPRADOR lê no app do banco (ver PIX_DESCRIPTION). Ou seja: a atribuição da
// venda vai nas UTMs, e a ligação com o nosso pedido é o id da transação, que
// guardamos em orders.providerTxnId.
//
// ⚠️ `player_name`, `player_doc` e `minor_verified` ficam de FORA: são campos de
// aposta/bet ("jogador", reembolso automático a menor de idade). Mandá-los numa
// venda de e-commerce descreveria a operação errado para a adquirente — que é
// exatamente o tipo de divergência de metadado que já derrubou conta aqui.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.pushinpay.com.br";

/** Expiração do QR, em segundos (a API aceita de 300 a 172800). */
const EXPIRES_IN_SECONDS = 3600;

/** Mínimo aceito pela API, em centavos. Abaixo disso ela devolve 422. */
const MIN_VALUE_CENTS = 50;

/**
 * Texto que o COMPRADOR lê no app do banco, no campo "Mensagem recebida" — e que
 * também aparece como "Descrição" no painel da PushinPay.
 *
 * Fixo e genérico por decisão do lojista (14/09/2026). Antes ia
 * `produto | loja | pedido <uuid>`, e o comprador via a coisa toda, UUID
 * incluído. Se um dia precisar mudar, é só aqui — mas lembre que não é campo
 * interno: é a última coisa que o cliente lê antes de confirmar o pagamento.
 */
const PIX_DESCRIPTION = "Pagamento PIX";

/**
 * Status comuns da PushinPay -> vocabulário interno.
 * Tabela oficial (info.description do OpenAPI): pending, processing, paid,
 * completed, failed, canceled, expired.
 */
export function normalizePushinpayStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
    case "completed":
      return "APPROVED";
    case "failed":
      return "DECLINED";
    // `canceled` e `expired` NÃO cancelam o pedido: em Pix o cliente ainda pode
    // voltar e pagar com um código novo, e cancelar aqui mataria a recuperação
    // de carrinho abandonado. pending/processing seguem indefinidos.
    default:
      return "PENDING";
  }
}

/**
 * Erro da API. O spec promete `{ message, errors }`, mas na prática o 401 vem
 * como `{ error: "Token inválido ou expirado." }` — lemos os dois, senão o
 * motivo real vira um "HTTP 401" mudo no log.
 */
function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[pushinpay]", prefix, res.status, JSON.stringify(data).slice(0, 600));
  const fields =
    data?.errors && typeof data.errors === "object"
      ? Object.entries(data.errors)
          .map(([f, msgs]) => `${f}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`)
          .join("; ")
      : "";
  const detail = data?.message || data?.error || `HTTP ${res.status}`;
  return new Error(`${prefix}: ${fields ? `${detail} (${fields})` : detail}`);
}

type Utms = Record<string, string | null | undefined>;

/** UTMs da sessão no formato que a PushinPay espera (só as chaves conhecidas). */
function buildUtms(tracking: Utms | undefined) {
  if (!tracking) return null;
  const keys = ["utm_source", "utm_campaign", "utm_medium", "utm_content", "utm_term", "utm_product"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = tracking[k];
    if (v) out[k] = String(v).slice(0, 255);
  }
  return Object.keys(out).length ? out : null;
}

export type PushinpayCreateInput = {
  amountCents: number;
  customer: PixCustomer;
  /**
   * Id do NOSSO pedido. NÃO vai para a PushinPay: o único campo onde caberia era
   * a `description`, que é lida pelo comprador e por isso é fixa. Serve para o
   * log de criação, que é o que liga o nosso pedido ao id deles quando algo dá
   * errado.
   */
  externalReference?: string;
  postbackUrl?: string;
  tracking?: Utms;
};

/** Cria uma cobrança Pix na PushinPay. */
export async function createPixCharge(storeId: string, input: PushinpayCreateInput): Promise<PixCharge> {
  const creds = await getPushinpayCredentials(storeId);
  if (!creds) throw new Error("PushinPay não configurada. Informe o token de API no painel.");

  const value = Math.round(input.amountCents);
  if (value < MIN_VALUE_CENTS) {
    throw new Error(`Valor abaixo do mínimo da PushinPay (R$ ${(MIN_VALUE_CENTS / 100).toFixed(2)}).`);
  }

  // `description` é FIXA (ver PIX_DESCRIPTION): ela é lida pelo comprador, não é
  // campo interno. A conciliação não depende dela — o id da PushinPay fica em
  // orders.providerTxnId e é por ele que o webhook encontra o pedido.
  const body: Record<string, unknown> = {
    value, // CENTAVOS
    expires_in: EXPIRES_IN_SECONDS,
    description: PIX_DESCRIPTION,
  };
  if (input.postbackUrl) body.webhook_url = input.postbackUrl;
  const utms = buildUtms(input.tracking);
  if (utms) body.utms = utms;

  const res = await fetch(`${API_BASE}/api/pix/cashIn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const qrCode = String(data?.qr_code ?? "");
  if (!qrCode) {
    console.error("[pushinpay] resposta sem qr_code:", JSON.stringify(data).slice(0, 600));
    throw new Error("PushinPay não retornou o código Pix (copia e cola).");
  }

  // O `id` é declarado como integer no spec, mas a API devolve UUID em produção.
  // Guardamos como STRING — funciona nos dois casos e é o que providerTxnId espera.
  const id = String(data?.id ?? data?.transactionId ?? "");
  console.log(`[pushinpay] pix criado id=${id} txid=${data?.txid ?? "-"} pedido=${input.externalReference ?? "-"}`);

  return {
    id,
    status: normalizePushinpayStatus(data?.status),
    qrCode,
    // ⚠️ `qr_code_base64` é DESCARTADO de propósito. Ele é o PNG do QR inteiro em
    // base64 (vários KB) e `orders.pixQrCodeUrl` é VARCHAR(512): gravar ali
    // estourava a coluna, o UPDATE morria DEPOIS da cobrança já criada, o
    // comprador via "Erro interno" e o pedido ficava sem providerTxnId — órfão de
    // uma cobrança real. O checkout desenha o QR a partir do copia-e-cola (todos
    // os consumidores usam `qrDataUrl || qrCodeUrl`), então não se perde nada.
    qrCodeUrl: null,
    expiresAt: data?.expires_at ? String(data.expires_at) : null,
  };
}

// ── Throttle de consulta ─────────────────────────────────────────────────────
// A PushinPay limita a consulta de transação a UMA POR MINUTO e avisa que
// estourar isso pode SUSPENDER a conta. O nosso checkout faz polling a cada ~4s
// (OrderStatusWatcher), então sem freio a primeira venda já estouraria o limite.
//
// O freio é um UPDATE condicional na linha do pedido: só passa quem consegue
// mover `gatewayPolledAt`, e isso é atômico no MySQL — funciona mesmo com várias
// instâncias serverless respondendo em paralelo (um cache em memória não
// funcionaria: cada lambda teria o seu).
//
// Isso NÃO atrasa a confirmação da venda: o webhook liquida o pedido no banco e
// o polling lê o banco antes de falar com o gateway — a tela vira na hora.
const POLL_INTERVAL_SECONDS = 60;

/** Cache em memória — só entra em ação se a coluna do throttle não existir. */
const memoryPolls = new Map<string, number>();

async function allowPoll(storeId: string, txnId: string): Promise<boolean> {
  try {
    const r = await execute(
      `UPDATE orders SET gatewayPolledAt = NOW(3)
        WHERE storeId = ? AND providerTxnId = ?
          AND (gatewayPolledAt IS NULL OR gatewayPolledAt <= DATE_SUB(NOW(3), INTERVAL ? SECOND))`,
      [storeId, txnId, POLL_INTERVAL_SECONDS],
    );
    return r.affectedRows > 0;
  } catch (e) {
    // Migração ainda não rodou (ou o pedido sumiu): cai no freio em memória em
    // vez de liberar geral. Pior caso é 1 consulta por minuto POR INSTÂNCIA —
    // ainda muito longe de um flood de 15/min por cliente.
    console.error("[pushinpay] throttle em memória (fallback):", e instanceof Error ? e.message : e);
    const key = `${storeId}:${txnId}`;
    const last = memoryPolls.get(key) ?? 0;
    if (Date.now() - last < POLL_INTERVAL_SECONDS * 1000) return false;
    memoryPolls.set(key, Date.now());
    return true;
  }
}

/**
 * Status normalizado de uma transação (ou null se não deu para consultar OU se
 * o freio de 1x/minuto bloqueou). Retornar null é seguro: o chamador trata como
 * "sem novidade" e o pedido segue PENDING.
 *
 * `force` pula o freio — usado SÓ pelo webhook, que é um evento da própria
 * PushinPay (não é polling) e precisa confirmar na hora.
 */
export async function getPushinpayTransactionStatus(
  storeId: string,
  id: string,
  opts?: { force?: boolean },
): Promise<string | null> {
  const creds = await getPushinpayCredentials(storeId);
  if (!creds || !id) return null;
  if (!opts?.force && !(await allowPoll(storeId, id))) return null;
  try {
    const res = await fetch(`${API_BASE}/api/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${creds.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const status = (data as any)?.status;
    return typeof status === "string" ? normalizePushinpayStatus(status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere se o token responde (botão de testar do painel). Consulta o SALDO —
 * leitura pura, nunca gera cobrança, e não é consulta de transação, então não
 * entra no limite de 1 por minuto.
 *
 * ⚠️ NÃO trocar por `/api/account`: o OpenAPI deles lista essa rota, mas ela NÃO
 * EXISTE na API real — devolve 404 "The route api/account could not be found."
 * (verificado em 2026-09-14). `/api/transactions/show/{id}` é outra rota
 * fantasma do mesmo spec. As que usamos de verdade — POST /api/pix/cashIn e
 * GET /api/transactions/{id} — foram conferidas e respondem normalmente.
 */
export async function checkPushinpayCredentials(storeId: string): Promise<{ ok: boolean; error?: string }> {
  const creds = await getPushinpayCredentials(storeId);
  if (!creds) return { ok: false, error: "Informe o token de API da PushinPay." };
  try {
    const res = await fetch(`${API_BASE}/api/balance`, {
      headers: { Authorization: `Bearer ${creds.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 401) return { ok: false, error: "Token recusado pela PushinPay (401). Gere um novo no painel deles." };
    if (res.status === 403) return { ok: false, error: "Token sem permissão (403). Confira os escopos no painel da PushinPay." };
    if (!res.ok) return { ok: false, error: `A PushinPay respondeu ${res.status}.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de rede ao falar com a PushinPay." };
  }
}
