import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkPagnivCredentials } from "@/lib/pagniv";

// POST /api/painel/pagniv/test
// Confere a chave com uma LEITURA (GET /v1/charges?limit=1) e, de carona, diz se
// o cartão está liberado na conta — na PagNiv isso depende de aprovação deles, e
// descobrir só na primeira venda seria tarde. Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkPagnivCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a PagNiv." }, 400);
    return json({
      ok: true,
      message: r.cardEnabled
        ? "Chave aceita. Pix e cartão liberados."
        : "Chave aceita. Cartão NÃO liberado nesta conta — peça a liberação ao suporte da PagNiv.",
    });
  } catch (err) {
    return handleError(err);
  }
}
