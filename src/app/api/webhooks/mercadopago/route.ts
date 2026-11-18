import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getMercadoPagoPaymentStatus } from "@/lib/mercadopago";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/mercadopago
// Notificação do Mercado Pago (payment). NÃO confiamos no corpo: usamos só o id
// para RE-CONSULTAR o status na API do MP (autenticada com o token da loja), que
// é a fonte de verdade — assim um webhook forjado não consegue marcar como pago.
// Sempre respondemos 2xx (o MP re-tenta em caso de falha).
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    // O id do pagamento vem de vários formatos (body novo, query, IPN legado).
    const paymentId = String(
      body?.data?.id ??
        url.searchParams.get("data.id") ??
        url.searchParams.get("id") ??
        body?.resource ??
        "",
    ).replace(/\D/g, "");

    const type = String(body?.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "");
    if (!paymentId || (type && !type.includes("payment"))) return json({ ok: true });

    // Descobre a loja pelo pedido (providerTxnId = id do pagamento MP).
    const rows = await query<{ id: string; storeId: string; status: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, paymentGateway, shopifyOrderId, shopifyDraftId FROM orders WHERE providerTxnId = ? LIMIT 1`,
      [paymentId],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem Mercado Pago ativo.
    if (order.paymentGateway && order.paymentGateway !== "mercadopago") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "mercadopago"))) return json({ ok: true });

    const raw = await getMercadoPagoPaymentStatus(order.storeId, paymentId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    // Nunca derruba o webhook (o MP re-tenta).
    return json({ ok: true });
  }
}
