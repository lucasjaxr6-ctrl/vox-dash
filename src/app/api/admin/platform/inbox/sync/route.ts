import { requireAdmin } from "@/lib/auth";
import { json, handleError } from "@/lib/http";
import { sincronizarCaixaPlataforma } from "@/lib/platform-inbox";

// POST /api/admin/platform/inbox/sync
// Busca na Resend o que ainda não está na caixa da Vox. Ver lib/platform-inbox.ts.
export async function POST() {
  try {
    await requireAdmin();
    const r = await sincronizarCaixaPlataforma();
    if (r.erro) return json({ error: r.erro }, 400);
    return json({ ok: true, novos: r.novos });
  } catch (err) {
    return handleError(err);
  }
}
