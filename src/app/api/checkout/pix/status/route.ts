import { headers } from "next/headers";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { resolveStoreByHost } from "@/lib/stores";
import { reconcileOrder, NEXT_STATUS } from "@/lib/payments";

// GET /api/checkout/pix/status?orderId=...
// O checkout consulta se o Pix foi pago (fonte de verdade: o provedor). Se
// aprovado, marca o pedido como PAGO (VoxPay) e propaga para a Shopify. Não
// depende do webhook — funciona por polling do próprio cliente.
export async function GET(req: Request) {
  try {
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return json({ error: "Loja não encontrada" }, 404);

    const orderId = new URL(req.url).searchParams.get("orderId") || "";
    if (!orderId) return json({ error: "orderId ausente" }, 400);

    const rows = await query<{ id: string; status: string; paymentMethod: string | null; providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, status, paymentMethod, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, store.id],
    );
    const order = rows[0];
    if (!order) return json({ error: "Pedido não encontrado" }, 404);

    if (order.status === "PAID" || order.status === "CANCELLED" || !order.providerTxnId) {
      return json({ status: order.status });
    }

    // Todas as cobranças do pedido: se o cliente pagou um código anterior à
    // renovação, é aqui, na tela dele, que isso precisa ser percebido.
    const { aplicado, raw } = await reconcileOrder(store.id, order);
    // `aplicado` vem null quando nada mudou — inclusive quando outra aba já
    // liquidou entre a leitura e agora. Nesse caso o gateway ainda diz pago, e
    // a tela do cliente precisa saber. Recusa/expiração continua PENDING: em
    // Pix o pedido segue recuperável.
    if (aplicado === "PAID" || (raw && NEXT_STATUS[raw] === "PAID")) return json({ status: "PAID" });
    return json({ status: "PENDING" });
  } catch (err) {
    return handleError(err);
  }
}
