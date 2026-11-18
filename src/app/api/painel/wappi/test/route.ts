import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkWappiCredentials } from "@/lib/wappi";

// POST /api/painel/wappi/test
// Confere as chaves com uma LEITURA (GET /v1/company). Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkWappiCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Wappi." }, 400);
    return json({ ok: true, message: `Chaves aceitas pela Wappi.${r.conta ? ` Conta: ${r.conta}.` : ""}` });
  } catch (err) {
    return handleError(err);
  }
}
