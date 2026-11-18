import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { execute, query } from "@/lib/db";
import { updateOrderBumpSchema } from "@/lib/validation";

// PUT /api/painel/order-bumps/[id] -> atualiza um order bump da loja ativa.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    const d = updateOrderBumpSchema.parse(await req.json());

    const prod = await query<{ id: string }>(
      `SELECT id FROM products WHERE id = ? AND storeId = ? LIMIT 1`,
      [d.productId, store.id],
    );
    if (!prod[0]) return json({ error: "Produto não encontrado nesta loja." }, 400);

    await execute(
      `UPDATE order_bumps SET productId = ?, title = ?, description = ?, active = ?, position = ?
       WHERE id = ? AND storeId = ?`,
      [d.productId, d.title, d.description || null, d.active === false ? 0 : 1, d.position ?? 0, id, store.id],
    );
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/painel/order-bumps/[id] -> exclui um order bump da loja ativa.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    await execute(`DELETE FROM order_bumps WHERE id = ? AND storeId = ?`, [id, store.id]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
