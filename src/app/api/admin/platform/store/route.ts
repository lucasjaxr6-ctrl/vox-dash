import { requireAdmin } from "@/lib/auth";
import { setActiveStore } from "@/lib/stores";
import { query, execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["suspend", "unsuspend", "delete", "impersonate"]),
  storeId: z.string().min(1).max(64),
});

// POST /api/admin/platform/store — ações do super-admin sobre uma loja.
// Só ADMIN. suspend/unsuspend, delete (só loja sem pedidos) e impersonar.
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { action, storeId } = schema.parse(await req.json());

    const rows = await query<{ id: string }>(`SELECT id FROM stores WHERE id = ? LIMIT 1`, [storeId]);
    if (!rows[0]) return json({ error: "Loja não encontrada." }, 404);

    if (action === "suspend" || action === "unsuspend") {
      await execute(`UPDATE stores SET suspended = ? WHERE id = ?`, [action === "suspend" ? 1 : 0, storeId]);
      return json({ ok: true });
    }

    if (action === "impersonate") {
      await setActiveStore(storeId); // ADMIN pode definir qualquer loja
      return json({ ok: true });
    }

    // delete: só permitido em loja SEM nenhum pedido (segurança — não apaga dados reais).
    const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE storeId = ?`, [storeId]);
    if (Number(n) > 0) {
      return json({ error: "Só é possível apagar lojas sem nenhum pedido." }, 400);
    }
    await execute(`DELETE FROM products WHERE storeId = ?`, [storeId]);
    await execute(`DELETE FROM store_settings WHERE storeId = ?`, [storeId]);
    await execute(`DELETE FROM stores WHERE id = ?`, [storeId]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
