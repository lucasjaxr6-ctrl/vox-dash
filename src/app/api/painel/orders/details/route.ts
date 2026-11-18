import { requireStore } from "@/lib/stores";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/painel/orders/details?id= -> todos os dados de um pedido da loja ativa
// (cliente, endereço, CPF, produtos, pagamento, rastreio) — para NF e envio.
export async function GET(req: Request) {
  try {
    const { store } = await requireStore();
    const id = (new URL(req.url).searchParams.get("id") || "").trim();
    if (!id) return json({ error: "id obrigatório" }, 400);

    const rows = await query<{
      id: string; status: string; paymentMethod: string | null; totalCents: number; createdAt: Date;
      customerName: string | null; customerEmail: string | null; customerDocument: string | null;
      customerPhone: string | null; customerAddress: string | null; trackingCode: string | null;
      pixQrCode: string | null;
    }>(
      `SELECT id, status, paymentMethod, totalCents, createdAt,
              customerName, customerEmail, customerDocument, customerPhone, customerAddress, trackingCode, pixQrCode
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [id, store.id],
    );
    const o = rows[0];
    if (!o) return json({ error: "Pedido não encontrado" }, 404);

    const items = await query<{ name: string; quantity: number; unitPriceCents: number }>(
      `SELECT p.name AS name, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents
       FROM order_items oi JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`,
      [id],
    );

    let address: Record<string, string> | null = null;
    try {
      address = o.customerAddress ? JSON.parse(o.customerAddress) : null;
    } catch {
      address = null;
    }

    return json({
      order: {
        id: o.id,
        status: o.status,
        paymentMethod: o.paymentMethod,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        customerDocument: o.customerDocument,
        customerPhone: o.customerPhone,
        trackingCode: o.trackingCode,
        pixQrCode: o.pixQrCode,
        address,
      },
      items,
    });
  } catch (err) {
    return handleError(err);
  }
}
