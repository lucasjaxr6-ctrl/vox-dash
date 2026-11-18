import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkVeopagCredentials } from "@/lib/veopag";

// POST /api/painel/veopag/test
// Faz o login com client_id/client_secret e lê o saldo. Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkVeopagCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a VeoPag." }, 400);
    return json({ ok: true, message: `Credenciais aceitas pela VeoPag.${r.saldo ? ` Saldo: ${r.saldo}.` : ""}` });
  } catch (err) {
    return handleError(err);
  }
}
