import { requireStore } from "@/lib/stores";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/admin/orders -> pedidos da loja ativa. Pedidos de visitante usam customer*.
export async function GET() {
  try {
    const { store } = await requireStore();
    const orders = await query<any>(
      `SELECT o.id, o.status, o.totalCents, o.createdAt,
              COALESCE(u.email, o.customerEmail) AS userEmail,
              COALESCE(u.name, o.customerName) AS userName
       FROM orders o LEFT JOIN users u ON u.id = o.userId
       WHERE o.storeId = ?
       ORDER BY o.createdAt DESC LIMIT 100`,
      [store.id],
    );
    return json({
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
        user: { email: o.userEmail, name: o.userName },
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
