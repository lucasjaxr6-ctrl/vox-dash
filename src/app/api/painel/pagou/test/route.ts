import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkPagouCredentials } from "@/lib/pagou";

// POST /api/painel/pagou/test
// Confere se o token da Pagou responde, usando uma LEITURA (GET /v2/transactions
// ?limit=1). Nunca cria cobrança — testar integração não pode gerar movimento na
// conta do lojista.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkPagouCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Pagou." }, 400);
    return json({ ok: true, message: "Token aceito pela Pagou." });
  } catch (err) {
    return handleError(err);
  }
}
