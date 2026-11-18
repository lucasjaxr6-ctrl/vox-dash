import { requireStore } from "@/lib/stores";
import { updateProductSchema } from "@/lib/validation";
import { query, execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// PUT /api/admin/products/[id] -> edita produto da loja ativa.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    const body = await req.json();
    const data = updateProductSchema.parse(body);

    const exists = await query<{ id: string }>(
      `SELECT id FROM products WHERE id = ? AND storeId = ? LIMIT 1`,
      [id, store.id],
    );
    if (!exists.length) return json({ error: "Produto não encontrado" }, 404);

    const sets: string[] = [];
    const p: any[] = [];
    if (data.name !== undefined) {
      sets.push("name = ?");
      p.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push("description = ?");
      p.push(data.description);
    }
    if (data.priceCents !== undefined) {
      sets.push("priceCents = ?");
      p.push(data.priceCents);
    }
    if (data.imageUrl !== undefined) {
      sets.push("imageUrl = ?");
      p.push(data.imageUrl);
    }
    if (data.active !== undefined) {
      sets.push("active = ?");
      p.push(data.active ? 1 : 0);
    }

    if (sets.length) {
      p.push(id, store.id);
      await execute(`UPDATE products SET ${sets.join(", ")} WHERE id = ? AND storeId = ?`, p);
    }

    const rows = await query<any>(
      `SELECT id, name, priceCents, active FROM products WHERE id = ? LIMIT 1`,
      [id],
    );
    return json({ product: { ...rows[0], active: Boolean(rows[0].active) } });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/admin/products/[id] -> desativa (soft delete). Só ADMIN.
// Não apaga: pedidos antigos referenciam o produto.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { store } = await requireStore();
    const { id } = await params;

    const exists = await query<{ id: string }>(
      `SELECT id FROM products WHERE id = ? AND storeId = ? LIMIT 1`,
      [id, store.id],
    );
    if (!exists.length) return json({ error: "Produto não encontrado" }, 404);

    await execute(`UPDATE products SET active = 0 WHERE id = ? AND storeId = ?`, [id, store.id]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
