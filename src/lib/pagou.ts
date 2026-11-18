import "server-only";
import { getPagouCredentials } from "./settings";
import type { PixCharge } from "./pix-types";
import { buildPixBody, buildCardBody, type PagouCreateInput } from "./pagou-payload";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Pagou.ai — Pix e cartão. API v2, server-to-server.
//
//   Base:  https://api.pagou.ai  (produção)  ·  https://api.sandbox.pagou.ai
//   Auth:  Authorization: Bearer <token>
//   Criar: POST /v2/transactions        (amount em CENTAVOS)
//   Ler:   GET  /v2/transactions/{id}   (fonte da verdade p/ webhook e reconciliação)
//
// Este arquivo só fala com a REDE. Quem monta o corpo é `pagou-payload.ts`, que
// é função pura e por isso pode ser conferido contra o contrato oficial.
//
// Decisões que seguem a documentação deles:
//  • `external_ref` = id do NOSSO pedido. É a chave de idempotência da Pagou e o
//    checklist de go-live exige persistir isso em toda criação.
//  • A resposta traz `requestId`; logamos junto com external_ref e o id da
//    transação, que é o trio que o suporte deles pede para reconciliar.
//  • No cartão, a resposta volta INTACTA ao navegador: é dela que o Payment
//    Element tira o `next_action` para concluir o 3D Secure.
// ─────────────────────────────────────────────────────────────────────────────

const PROD_BASE = "https://api.pagou.ai";
const SANDBOX_BASE = "https://api.sandbox.pagou.ai";

export type { PagouCreateInput };

/**
 * Status canônicos da Pagou -> vocabulário interno.
 * Tabela oficial: pending, processing, paid, captured, authorized,
 * three_ds_required, partially_paid, refunded, partially_refunded, canceled,
 * expired, refused, chargedback, processed, in_protest.
 */
export function normalizePagouStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
    case "captured":
      return "APPROVED";
    // Estorno parcial: o pedido continua pago. Só o total desfaz a venda.
    case "partially_refunded":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
    case "in_protest":
      return "CHARGEBACK";
    case "refused":
    case "canceled":
    case "cancelled":
      return "DECLINED";
    // `expired` NÃO cancela o pedido: em Pix o cliente ainda pode voltar e pagar
    // com um novo código, e cancelar aqui mataria a recuperação de carrinho.
    // pending / processing / authorized / three_ds_required / partially_paid /
    // processed seguem indefinidos -> PENDING não dispara transição (no-op).
    default:
      return "PENDING";
  }
}

async function auth(storeId: string): Promise<{ token: string; base: string } | null> {
  const creds = await getPagouCredentials(storeId);
  if (!creds) return null;
  return { token: creds.apiToken, base: creds.sandbox ? SANDBOX_BASE : PROD_BASE };
}

/**
 * Erro da API. A Pagou responde RFC 7807 (application/problem+json) com `title`,
 * `detail` e um array `errors` de problemas por campo — extraímos os três para
 * a mensagem não virar um "HTTP 422" mudo.
 */
function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[pagou]", prefix, res.status, JSON.stringify(data).slice(0, 600));
  const fields = Array.isArray(data?.errors)
    ? data.errors.map((e: any) => `${e?.field ?? "campo"}: ${e?.message ?? e?.code ?? ""}`.trim()).filter(Boolean).join("; ")
    : "";
  const detail = data?.detail || data?.title || data?.message || "sem detalhe";
  // O status HTTP e o requestId entram na MENSAGEM porque ela é gravada no
  // pedido (providerPayload). Sem eles, diagnosticar a recusa depois exige achar
  // a requisição no log do servidor — e é exatamente esse trio (status,
  // requestId, external_ref) que o suporte da Pagou pede.
  const ref = `HTTP ${res.status}${data?.requestId ? ` req=${data.requestId}` : ""}`;
  // Sem `errors[]` por campo, um 422 não diz o que reprovou. Aí o corpo cru é a
  // única pista, e vale mais no pedido do que só no log do servidor — foi
  // exatamente essa cegueira que atrasou o diagnóstico do 3DS.
  const cru = fields ? "" : ` corpo=${JSON.stringify(data).slice(0, 300)}`;
  return new Error(`${prefix}: ${fields ? `${detail} (${fields})` : detail} [${ref}]${cru}`);
}

/** POST /v2/transactions com o token da loja. */
async function postTransaction(a: { token: string; base: string }, body: Record<string, unknown>) {
  const res = await fetch(`${a.base}/v2/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${a.token}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  return { res, data: await res.json().catch(() => ({}) as any) };
}

/** Cria uma cobrança Pix na Pagou. */
export async function createPixCharge(storeId: string, input: PagouCreateInput): Promise<PixCharge> {
  const a = await auth(storeId);
  if (!a) throw new Error("Pagou não configurada. Informe o token de API no painel.");

  const { res, data } = await postTransaction(a, buildPixBody(input));
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const tx = data?.data ?? data ?? {};
  const qrCode = String(tx?.pix?.qr_code ?? "");
  if (!qrCode) {
    console.error("[pagou] resposta sem qr_code:", JSON.stringify(data).slice(0, 600));
    throw new Error("Pagou não retornou o código Pix (copia e cola).");
  }

  // Trio que o suporte da Pagou pede para reconciliar: requestId deles, o nosso
  // external_ref e o id do recurso.
  console.log(
    `[pagou] pix criado requestId=${data?.requestId ?? "-"} external_ref=${input.externalReference ?? "-"} id=${tx?.id ?? "-"}`,
  );

  const exp = tx?.pix?.expiration_date ?? null;
  return {
    id: String(tx?.id ?? ""),
    status: normalizePagouStatus(tx?.status),
    qrCode,
    qrCodeUrl: null, // o checkout desenha o QR a partir do copia-e-cola
    expiresAt: exp ? String(exp) : null,
  };
}

export type PagouCardResult = {
  id: string;
  status: string;
  statusDetail: string;
  /**
   * Objeto `data` da Pagou, COMO VEIO. Precisa voltar intacto ao navegador: o
   * Payment Element lê `next_action` daqui para concluir o 3D Secure sozinho
   * ("Return your transaction payload from the backend unchanged. If it asks for
   * further action, the SDK detects it and continues the flow."). Mexer nesse
   * objeto quebra o desafio do banco.
   */
  raw: Record<string, unknown>;
};

/**
 * Cobrança no CARTÃO. O cartão NUNCA passa por aqui: quem tokeniza é o Payment
 * Element, dentro de um iframe da Pagou, e o que chega é um token `pgct_`.
 */
export async function createCardPayment(
  storeId: string,
  input: PagouCreateInput & { token: string; installments: number },
): Promise<PagouCardResult> {
  const a = await auth(storeId);
  if (!a) throw new Error("Pagou não configurada. Informe o token de API no painel.");

  // Lança quando falta ao comprador algo que o 3DS exige — antes de gastar a
  // cobrança numa tentativa que já nasce condenada.
  const body = buildCardBody(input);

  const { res, data } = await postTransaction(a, body);

  // Nota de diagnóstico (13-14/09/2026, reconferida em 15/09 contra o contrato
  // oficial em github.com/PagouAi/examples): o cartão desta conta falha com
  // "Failed to create 3DS charge with the current upstream provider" e o
  // problema NÃO é o nosso corpo:
  //   • o corpo é válido pelo contrato — quando falta algo, a API responde 422
  //     nomeando o campo (foi o que aconteceu no teste de corpo mínimo);
  //   • os campos que a doc do 3DS exige do comprador estavam TODOS presentes
  //     nos pedidos que falharam (conferido no banco: endereço com os 7 campos,
  //     telefone com DDI, CPF);
  //   • chave pública `pk_live_` e API em produção — sem mistura de ambiente;
  //   • Pix na MESMA conta/token/base cria transação normalmente.
  // A mensagem é da ADQUIRENTE da Pagou, não da validação: é a conta que precisa
  // ser habilitada para 3DS/cartão do lado deles.
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const tx = (data?.data ?? data ?? {}) as Record<string, unknown>;
  console.log(
    `[pagou] cartão requestId=${data?.requestId ?? "-"} external_ref=${input.externalReference ?? "-"} id=${tx?.id ?? "-"} status=${tx?.status ?? "-"}`,
  );
  return {
    id: String(tx?.id ?? ""),
    status: normalizePagouStatus(String(tx?.status ?? "")),
    statusDetail: String(tx?.status ?? ""),
    raw: tx,
  };
}

/**
 * Status normalizado de uma transação (ou null se não deu para consultar).
 * É a FONTE DA VERDADE: o webhook da Pagou não tem assinatura documentada, e a
 * reconciliação do cron também passa por aqui.
 */
export async function getPagouTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const a = await auth(storeId);
  if (!a || !id) return null;
  try {
    const res = await fetch(`${a.base}/v2/transactions/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${a.token}`, accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const tx = (data as any)?.data ?? data;
    const status = tx?.status;
    return typeof status === "string" ? normalizePagouStatus(status) : null;
  } catch {
    return null;
  }
}

/**
 * Confere se o token responde (usado no botão de testar do painel). Faz uma
 * LEITURA, nunca uma cobrança.
 */
export async function checkPagouCredentials(storeId: string): Promise<{ ok: boolean; error?: string }> {
  const a = await auth(storeId);
  if (!a) return { ok: false, error: "Informe o token de API da Pagou." };
  try {
    const res = await fetch(`${a.base}/v2/transactions?limit=1`, {
      headers: { Authorization: `Bearer ${a.token}`, accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "Token recusado pela Pagou (401). Confira se é o token do ambiente selecionado." };
    }
    if (!res.ok) return { ok: false, error: `A Pagou respondeu ${res.status}.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de rede ao falar com a Pagou." };
  }
}
