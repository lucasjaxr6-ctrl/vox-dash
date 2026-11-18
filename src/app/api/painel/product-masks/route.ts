import { requireStore } from "@/lib/stores";
import { execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// PUT /api/painel/product-masks
// Salva o NOME MASCARADO de um produto da loja ativa — é o que será enviado ao
// gateway no lugar do nome real. Em branco = usa o nome original.
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json().catch(() => ({}) as any);
    const productId = String(body?.productId || "").trim();
    const maskedRaw = typeof body?.maskedName === "string" ? body.maskedName.trim() : "";
    if (!productId) return json({ error: "productId obrigatório" }, 400);

    const masked = maskedRaw.slice(0, 255) || null; // vazio -> NULL (nome original)
    const res = await execute(
      `UPDATE products SET maskedName = ? WHERE id = ? AND storeId = ?`,
      [masked, productId, store.id],
    );
    if (res.affectedRows === 0) return json({ error: "Produto não encontrado" }, 404);
    return json({ ok: true, maskedName: masked });
  } catch (err) {
    return handleError(err);
  }
}
