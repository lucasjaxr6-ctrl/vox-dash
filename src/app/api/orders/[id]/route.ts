import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/orders/[id] -> detalhe de UM pedido.
//
// ⭐ Anti-IDOR ⭐ O WHERE exige `userId = <id da sessão>`. Se o pedido não for do
// usuário, a consulta não retorna nada e respondemos 404 (não 403) — sem revelar
// se aquele id existe.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const rows = await query<any>(
      `SELECT id, status, totalCents, createdAt
       FROM orders WHERE id = ? AND userId = ? LIMIT 1`,
      [id, user.id],
    );
    const order = rows[0];
    if (!order) return json({ error: "Pedido não encontrado" }, 404);

    const items = await query<any>(
      `SELECT oi.quantity, oi.unitPriceCents,
              p.id AS productId, p.name AS productName, p.imageUrl AS imageUrl
       FROM order_items oi JOIN products p ON p.id = oi.productId
       WHERE oi.orderId = ?`,
      [id],
    );

    return json({
      order: {
        id: order.id,
        status: order.status,
        totalCents: order.totalCents,
        createdAt: order.createdAt,
        items: items.map((it) => ({
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          product: { id: it.productId, name: it.productName, imageUrl: it.imageUrl },
        })),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
