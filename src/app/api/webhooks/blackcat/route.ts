import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getBlackcatTransactionStatus } from "@/lib/blackcat";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/blackcat
//
// Eventos: transaction.created, transaction.paid, transaction.failed e os de
// saque (withdrawal.*), que não mexem em pedido.
//
// A BlackCat NÃO assina o webhook — só manda X-Webhook-Event e
// X-Webhook-Source. Por isso o corpo serve apenas para ACHAR o pedido: o status
// que liquida vem sempre do GET /sales/{id}/status, feito com a chave da loja.
// Um POST forjado aqui, no máximo, faz a gente consultar a API à toa.
//
// Casa por `externalReference` (o nosso orderId, enviado como externalRef) ou
// pelo `transactionId` gravado em providerTxnId. Sempre 2xx: a doc pede 200 em
// até 10 s e o que ignoramos não deve virar retentativa.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const evento = String(body?.event ?? req.headers.get("x-webhook-event") ?? "");
    if (!evento.startsWith("transaction.")) return json({ ok: true });

    const reference = String(body?.externalReference ?? body?.externalRef ?? "").trim();
    const txnId = String(body?.transactionId ?? "").trim();
    if (!reference && !txnId) return json({ ok: true });

    // `paymentGateway IS NULL` cobre o cartão: o postback pode chegar antes de a
    // rota gravar o gateway no pedido (a cobrança é síncrona). A consulta abaixo
    // usa a chave da loja, então um pedido de outro gateway só não acha nada.
    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE (paymentGateway = 'blackcat' OR paymentGateway IS NULL) AND (id = ? OR providerTxnId = ?)
        LIMIT 1`,
      [reference || "-", txnId || "-"],
    );
    const order = rows[0];
    if (!order) return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "blackcat"))) return json({ ok: true });

    const id = order.providerTxnId || txnId;
    if (!id) return json({ ok: true });
    const bruto = await getBlackcatTransactionStatus(order.storeId, id);
    // Pedido já cancelado só volta se agora estiver PAGO (3DS concluído depois
    // de a tela desistir, por exemplo); cancelar de novo seria no-op.
    if (order.status !== "CANCELLED" || bruto === "APPROVED") await aplicarStatusDoGateway(order.storeId, order, bruto);

    return json({ ok: true });
  } catch (e) {
    console.error("[blackcat webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
