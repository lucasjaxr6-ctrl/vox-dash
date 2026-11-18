import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { checkoutSchema } from "@/lib/validation";
import { query, withTransaction, newId, inPlaceholders } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { resolveStoreByHost } from "@/lib/stores";

// POST /api/checkout -> cria um pedido para o usuário logado.
//
// ⭐ Regra de ouro ⭐ NUNCA confie em valores monetários do frontend. O cliente
// só envia { productId, quantity }. O preço de cada item vem do BANCO e o total
// é recalculado no servidor.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return json({ error: "Loja não encontrada para este domínio" }, 404);

    const body = await req.json();
    const { items } = checkoutSchema.parse(body);

    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await query<{ id: string; priceCents: number }>(
      `SELECT id, priceCents FROM products
       WHERE active = 1 AND storeId = ? AND id IN (${inPlaceholders(ids.length)})`,
      [store.id, ...ids],
    );
    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));

    for (const item of items) {
      if (!priceById.has(item.productId)) {
        return json({ error: "Produto indisponível" }, 400);
      }
    }

    const totalCents = items.reduce(
      (sum, i) => sum + priceById.get(i.productId)! * i.quantity,
      0,
    );

    // Pedido + itens em uma transação (snapshot do preço atual).
    const order = await withTransaction(async (conn) => {
      const orderId = newId();
      await conn.execute(
        `INSERT INTO orders (id, storeId, userId, totalCents, status) VALUES (?, ?, ?, ?, 'PENDING')`,
        [orderId, store.id, user.id, totalCents],
      );
      for (const item of items) {
        await conn.execute(
          `INSERT INTO order_items (id, orderId, productId, quantity, unitPriceCents)
           VALUES (?, ?, ?, ?, ?)`,
          [newId(), orderId, item.productId, item.quantity, priceById.get(item.productId)!],
        );
      }
      return { id: orderId, totalCents, status: "PENDING" as const };
    });

    // 👉 Aqui você inicia o pagamento (gateway/Shopify) usando order.totalCents.
    return json({ order }, 201);
  } catch (err) {
    return handleError(err);
  }
}
