import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { execute } from "@/lib/db";
import { updateReviewSchema } from "@/lib/validation";

// PUT /api/painel/reviews/[id] -> atualiza uma avaliação da loja ativa.
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    const body = await req.json();
    const d = updateReviewSchema.parse(body);
    await execute(
      `UPDATE reviews SET name = ?, stars = ?, text = ?, photoUrl = ?, position = ?, active = ?
       WHERE id = ? AND storeId = ?`,
      [d.name, d.stars, d.text, d.photoUrl || null, d.position, d.active ? 1 : 0, id, store.id],
    );
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

// DELETE /api/painel/reviews/[id] -> exclui uma avaliação da loja ativa.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { store } = await requireStore();
    const { id } = await params;
    await execute(`DELETE FROM reviews WHERE id = ? AND storeId = ?`, [id, store.id]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
