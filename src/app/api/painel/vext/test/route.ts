import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkVextCredentials } from "@/lib/vext";

// POST /api/painel/vext/test
// Confere a chave com uma LEITURA (GET /v1/balance). Nunca cria cobrança.
// A Vext separa 401 (chave inválida) de 403 (chave válida sem escopo), e a
// mensagem preserva essa diferença — são problemas com soluções diferentes.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkVextCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Vext." }, 400);
    return json({ ok: true, message: `Chave aceita pela Vext.${r.error ?? ""}` });
  } catch (err) {
    return handleError(err);
  }
}
