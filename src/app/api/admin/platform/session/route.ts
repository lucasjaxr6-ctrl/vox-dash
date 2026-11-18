import { requireAdmin } from "@/lib/auth";
import { execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { z } from "zod";

const schema = z.object({ sessionId: z.string().min(1).max(191) });

// DELETE /api/admin/platform/session — encerra (desloga) uma sessão. Só ADMIN.
export async function DELETE(req: Request) {
  try {
    await requireAdmin();
    const { sessionId } = schema.parse(await req.json());
    await execute(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
