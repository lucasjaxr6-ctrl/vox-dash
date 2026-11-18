import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkBlackcatCredentials } from "@/lib/blackcat";

// POST /api/painel/blackcat/test
// Confere a API Key com uma LEITURA (GET /sales/seller). Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkBlackcatCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a BlackCat." }, 400);
    return json({ ok: true, message: `Chave aceita pela BlackCat.${r.vendedor ? ` Conta: ${r.vendedor}.` : ""}` });
  } catch (err) {
    return handleError(err);
  }
}
