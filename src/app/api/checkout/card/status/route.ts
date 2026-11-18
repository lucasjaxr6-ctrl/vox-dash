import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { headers } from "next/headers";
import { resolveStoreByHost } from "@/lib/stores";
import { getOrderGatewayStatus, settlePixOrder, NEXT_STATUS } from "@/lib/payments";

// GET /api/checkout/card/status?orderId=
// Usado pelo checkout enquanto o cartão está "em análise": re-consulta o status
// no gateway (fonte da verdade) e liquida se já foi aprovado/recusado. É a
// verificação "alguns segundos depois" — sem depender do webhook chegar.
export async function GET(req: Request) {
  try {
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return json({ status: "UNKNOWN" });

    const orderId = (new URL(req.url).searchParams.get("orderId") || "").trim();
    if (!orderId) return json({ status: "UNKNOWN" });

    const rows = await query<{
      id: string; storeId: string; status: string; paymentMethod: string | null;
      totalCents: number; providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null;
    }>(
      `SELECT id, storeId, status, paymentMethod, totalCents, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, store.id],
    );
    const o = rows[0];
    if (!o) return json({ status: "UNKNOWN" });
    if (o.status === "PAID") return json({ status: "PAID", amountCents: o.totalCents });
    if (o.status === "CANCELLED") return json({ status: "CANCELLED" });

    const raw = await getOrderGatewayStatus(o.storeId, o);
    const next = raw ? NEXT_STATUS[raw] : undefined;
    if (next) {
      await settlePixOrder(o.storeId, o, next);
      return json({ status: next, amountCents: o.totalCents });
    }
    return json({ status: "PENDING" });
  } catch (err) {
    return handleError(err);
  }
}
