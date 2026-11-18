import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getVextTransactionStatus, verifyVextSignature } from "@/lib/vext";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive, getVextCredentials } from "@/lib/settings";

// POST /api/webhooks/vext
//
// Eventos: charge.paid, charge.failed, charge.in_analysis, charge.refunded,
// charge.chargedback, withdrawal.paid.
//
// A cobrança casa com o pedido por `reference` (o nosso orderId, que mandamos na
// criação) ou pelo `id` público (ch_…) gravado em providerTxnId.
//
// Duas camadas antes de liquidar: a assinatura HMAC e a RE-CONSULTA do status na
// API. Qualquer 2xx encerra a entrega do lado deles, então respondemos 2xx
// sempre — inclusive quando ignoramos o evento, para não gerar retentativa de
// algo que nunca vamos processar.
export async function POST(req: Request) {
  try {
    // CRU primeiro: a assinatura é sobre os bytes exatos que eles enviaram.
    // Um JSON.stringify do objeto já parseado muda espaços e ordem.
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {} as any;
      }
    })();

    const evento = String(body?.type ?? body?.event ?? "");
    // Saque não mexe em pedido — e o id dele é de outro domínio.
    if (!evento.startsWith("charge.")) return json({ ok: true });

    const ch = body?.data?.object ?? body?.data ?? body?.charge ?? {};
    const reference = String(ch?.reference ?? "").trim();
    const chargeId = String(ch?.id ?? "").trim();
    if (!reference && !chargeId) return json({ ok: true });

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE paymentGateway = 'vext' AND (id = ? OR providerTxnId = ?)
        LIMIT 1`,
      [reference || "-", chargeId || "-"],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "vext"))) return json({ ok: true });

    const creds = await getVextCredentials(order.storeId);
    if (creds?.webhookSecret) {
      const ok = verifyVextSignature(raw, req.headers.get("x-vext-signature"), creds.webhookSecret);
      if (!ok) {
        console.error("[vext webhook] assinatura inválida", evento, order.id);
        return json({ ok: true });
      }
    }

    const id = order.providerTxnId || chargeId;
    if (!id) return json({ ok: true });
    const bruto = await getVextTransactionStatus(order.storeId, id);
    await aplicarStatusDoGateway(order.storeId, order, bruto);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
