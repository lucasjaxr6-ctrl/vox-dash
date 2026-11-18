import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getPixgoTransactionStatus, verifyPixgoWebhook } from "@/lib/pixgo";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive, getPixgoCredentials } from "@/lib/settings";

// POST /api/webhooks/pixgo
// Webhook da PixGo (payment.completed / expired / refunded). NÃO confiamos no
// corpo: resolvemos a loja pelo pedido e RE-CONSULTAMOS o status na API (fonte da
// verdade). A assinatura HMAC é validada com o Webhook Secret da loja. Sempre 2xx.
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const body = JSON.parse(raw) as any;
    const d = (body?.data ?? body ?? {}) as Record<string, any>;

    const paymentId = String(d.payment_id ?? d.id ?? "").trim();
    const externalId = String(d.external_id ?? "").trim();
    if (!paymentId && !externalId) return json({ ok: true });

    // Resolve o pedido por external_id (nosso orderId) OU pelo payment_id (providerTxnId).
    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE id = ? OR providerTxnId = ? LIMIT 1`,
      [externalId || "-", paymentId || "-"],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem PixGo ativo.
    if (order.paymentGateway && order.paymentGateway !== "pixgo") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "pixgo"))) return json({ ok: true });

    // Assinatura HMAC-SHA256 de `${timestamp}.${rawBody}` com o Webhook Secret da loja.
    const creds = await getPixgoCredentials(order.storeId);
    if (creds?.webhookSecret) {
      const ts = req.headers.get("x-webhook-timestamp") ?? "";
      const sig = req.headers.get("x-webhook-signature") ?? "";
      if (!verifyPixgoWebhook(creds.webhookSecret, ts, sig, raw)) return json({ ok: true }); // ignora forjado
    }

    // Fonte da verdade: re-consulta o status na PixGo pelo id da transação.
    const txn = order.providerTxnId || paymentId;
    const rawStatus = txn ? await getPixgoTransactionStatus(order.storeId, txn) : null;
    await aplicarStatusDoGateway(order.storeId, order, rawStatus);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
