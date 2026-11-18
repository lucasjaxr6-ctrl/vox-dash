import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getPinPayPaymentStatus } from "@/lib/pinpay";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/pinpay
// Notificação da PinPay. NÃO confiamos no corpo: usamos só o id da cobrança para
// RE-CONSULTAR o status na API da PinPay (autenticada com a secret da loja), que
// é a fonte de verdade — assim um webhook forjado não marca como pago.
// Sempre respondemos 2xx (a PinPay re-tenta em caso de falha).
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    // O id da cobrança pode vir em vários formatos do payload/query.
    const chargeId = String(
      body?.data?.id ??
        body?.id ??
        body?.charge?.id ??
        body?.pix?.id ??
        url.searchParams.get("id") ??
        "",
    ).trim();
    if (!chargeId) return json({ ok: true });

    // Descobre a loja pelo pedido (providerTxnId = id da cobrança PinPay).
    const rows = await query<{ id: string; storeId: string; status: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, paymentGateway, shopifyOrderId, shopifyDraftId FROM orders WHERE providerTxnId = ? LIMIT 1`,
      [chargeId],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem PinPay ativo.
    if (order.paymentGateway && order.paymentGateway !== "pinpay") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "pinpay"))) return json({ ok: true });

    const raw = await getPinPayPaymentStatus(order.storeId, chargeId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
