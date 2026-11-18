import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { execute, query } from "@/lib/db";
import { updateCouponSchema } from "@/lib/validation";

// PUT /api/painel/coupons/[id] -> atualiza um cupom da loja ativa.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    const body = await req.json();
    const d = updateCouponSchema.parse(body);
    const code = d.code.trim().toUpperCase();
    const expiresAt = d.expiresAt ? `${d.expiresAt} 23:59:59` : null;

    const dup = await query<{ id: string }>(
      `SELECT id FROM coupons WHERE storeId = ? AND code = ? AND id <> ? LIMIT 1`,
      [store.id, code, id],
    );
    if (dup[0]) return json({ error: "Já existe um cupom com esse código." }, 409);

    await execute(
      `UPDATE coupons SET code = ?, type = ?, value = ?, active = ?, minOrderCents = ?, maxRedemptions = ?, expiresAt = ?
       WHERE id = ? AND storeId = ?`,
      [code, d.type, d.value, d.active ? 1 : 0, d.minOrderCents ?? null, d.maxRedemptions ?? null, expiresAt, id, store.id],
    );
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/painel/coupons/[id] -> exclui um cupom da loja ativa.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    await execute(`DELETE FROM coupons WHERE id = ? AND storeId = ?`, [id, store.id]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
