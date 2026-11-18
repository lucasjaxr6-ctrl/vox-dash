import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkPagarmeCredentials } from "@/lib/pagarme";

// POST /api/painel/pagarme/test
// Confere a chave secreta com uma LEITURA (lista 1 pedido). Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkPagarmeCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Pagar.me." }, 400);
    return json({ ok: true, message: `Chave aceita pela Pagar.me (ambiente de ${r.ambiente}).` });
  } catch (err) {
    return handleError(err);
  }
}
