import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getPagouTransactionStatus } from "@/lib/pagou";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/pagou
//
// Evento da Pagou.ai. Envelope documentado:
//   { id: "evt_...", event: "transaction", api_version: "v1", data: { ... } }
// com o tipo real em `data.event_type` (transaction.paid, transaction.refunded,
// transaction.chargedback, ...).
//
// ⚠️ A Pagou NÃO documenta assinatura de webhook (não há header tipo
// X-Signature nem segredo compartilhado na doc). Por isso NÃO confiamos em
// nada do corpo além do identificador: usamos o id da transação para
// RE-CONSULTAR GET /v2/transactions/{id} com o nosso token e decidir pelo que a
// API responde. Assim um POST forjado nesta URL não consegue marcar pedido como
// pago.
//
// Responde 2xx sempre, como a doc pede ("responda 200 OK rapidamente"), para a
// Pagou não ficar reenfileirando o evento por erro nosso.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}) as any);
    const eventId = typeof body?.id === "string" ? body.id : null;
    const eventType = typeof body?.data?.event_type === "string" ? body.data.event_type : null;

    // Ids candidatos: o id da transação da Pagou (uuid) e o nosso external_ref.
    const txId = firstString(body?.data?.id, body?.data?.transaction?.id, body?.data?.object?.id);
    // O nosso external_ref volta no evento como `correlation_id` (é assim no
    // envelope documentado). Aceitamos também `external_ref` por segurança.
    const externalRef = firstString(
      body?.data?.correlation_id,
      body?.data?.external_ref,
      body?.data?.transaction?.correlation_id,
      body?.data?.transaction?.external_ref,
      body?.data?.object?.correlation_id,
    );

    // A doc pede o `id` de topo como chave de deduplicação e cita
    // "missing_event_id" como erro comum de ingestão. Registramos a ausência em
    // vez de engolir — mas seguimos processando: o que protege contra evento
    // repetido aqui é a idempotência do settle (só age na transição real).
    if (!eventId) console.error("[pagou webhook] evento sem id de topo (missing_event_id)");

    if (!txId && !externalRef) {
      console.error("[pagou webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ received: true });
    }

    // Casa o pedido pelo id da transação OU pelo nosso id (external_ref é o
    // orders.id), o que cobre o evento chegar antes de gravarmos providerTxnId.
    const ids = [txId, externalRef].filter(Boolean) as string[];
    const rows = await query<{
      id: string; storeId: string; status: string; providerTxnId: string | null;
      paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null;
    }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders
       WHERE providerTxnId IN (${inPlaceholders(ids.length)}) OR id IN (${inPlaceholders(ids.length)})
       LIMIT 1`,
      [...ids, ...ids],
    );
    const order = rows[0];
    if (!order) {
      console.error(`[pagou webhook] pedido não encontrado evento=${eventId} tipo=${eventType} tx=${txId} ref=${externalRef}`);
      return json({ received: true });
    }

    // Dedupe: pedido cancelado não é reprocessado. Pedido pago passa, porque pode
    // ser estorno, e aplicarStatusDoGateway ignora os avisos repetidos.
    if (order.status === "CANCELLED") return json({ received: true });

    // Só processa se o pedido é DESTE gateway e a loja tem Pagou ativa.
    if (order.paymentGateway && order.paymentGateway !== "pagou") return json({ received: true });
    if (!(await isGatewayActive(order.storeId, "pagou"))) return json({ received: true });

    const lookupId = order.providerTxnId || txId;
    if (!lookupId) return json({ received: true });

    // FONTE DA VERDADE: o status vem da API, não do corpo do evento.
    const raw = await getPagouTransactionStatus(order.storeId, lookupId);
    console.log(`[pagou webhook] evento=${eventId} tipo=${eventType} pedido=${order.id} api=${raw ?? "-"}`);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ received: true });
  } catch (e) {
    console.error("[pagou webhook]", e);
    return json({ received: true });
  }
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}
