import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getPagarmeTransactionStatus } from "@/lib/pagarme";
import { aplicarStatusDoGateway, NEXT_STATUS } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/pagarme
//
// Corpo: `{ id: "hook_…", type: "order.paid" | "charge.refunded" | …, data }`.
// Em `order.*` o `data` é o pedido (id `or_…`, `code` = nosso orderId); em
// `charge.*` é a cobrança, que traz o pedido em `data.order`.
//
// A Pagar.me não assina o webhook. O corpo serve só para ACHAR o pedido: o
// status vem do GET /orders/{id} com a chave da loja, então um POST forjado
// aqui não liquida nada. Sempre 2xx — eles reenviam o que falhar.
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const tipo = String(body?.type ?? "");
    if (!tipo.startsWith("order.") && !tipo.startsWith("charge.")) return json({ ok: true });

    const d = body?.data ?? {};
    const orId = String(String(d?.id ?? "").startsWith("or_") ? d.id : (d?.order?.id ?? "")).trim();
    const code = String(d?.code ?? d?.order?.code ?? d?.metadata?.pedido ?? d?.order?.metadata?.pedido ?? "").trim();
    if (!orId && !code) return json({ ok: true });

    // `paymentGateway IS NULL` cobre o cartão, cujo gateway é gravado logo
    // depois da cobrança síncrona — o aviso pode chegar antes.
    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE (paymentGateway = 'pagarme' OR paymentGateway IS NULL) AND (providerTxnId = ? OR id = ?)
        LIMIT 1`,
      [orId || "-", code || "-"],
    );
    const order = rows[0];
    // Pedido já pago só interessa se o evento for de estorno ou chargeback.
    if (!order || (order.status === "PAID" && !/refund|chargeback|chargedback/.test(tipo))) return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "pagarme"))) return json({ ok: true });

    const id = order.providerTxnId || orId;
    if (!id) return json({ ok: true });
    const bruto = await getPagarmeTransactionStatus(order.storeId, id);
    const next = bruto ? NEXT_STATUS[bruto] : undefined;
    if (next && next !== order.status) await aplicarStatusDoGateway(order.storeId, order, bruto);

    return json({ ok: true });
  } catch (e) {
    console.error("[pagarme webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
