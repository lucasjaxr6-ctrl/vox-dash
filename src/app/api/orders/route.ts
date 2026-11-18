import { requireUser } from "@/lib/auth";
import { query, inPlaceholders } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/orders -> APENAS os pedidos do usuário logado (escopo por userId).
export async function GET() {
  try {
    const user = await requireUser();

    const orders = await query<any>(
      `SELECT id, status, totalCents, createdAt
       FROM orders WHERE userId = ? ORDER BY createdAt DESC`,
      [user.id],
    );
    if (orders.length === 0) return json({ orders: [] });

    // Busca os itens de todos os pedidos de uma vez (evita N+1).
    const ids = orders.map((o) => o.id);
    const items = await query<any>(
      `SELECT oi.orderId, oi.quantity, oi.unitPriceCents,
              p.id AS productId, p.name AS productName, p.imageUrl AS imageUrl
       FROM order_items oi JOIN products p ON p.id = oi.productId
       WHERE oi.orderId IN (${inPlaceholders(ids.length)})`,
      ids,
    );

    const byOrder: Record<string, any[]> = {};
    for (const it of items) {
      (byOrder[it.orderId] ??= []).push({
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        product: { id: it.productId, name: it.productName, imageUrl: it.imageUrl },
      });
    }

    return json({
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
        items: byOrder[o.id] ?? [],
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
