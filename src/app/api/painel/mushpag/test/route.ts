import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkMushpagCredentials, garantirWebhookMushpag } from "@/lib/mushpag";

// POST /api/painel/mushpag/test
//
// Duas coisas, nesta ordem:
//  1. confere a chave só com LEITURA (nunca cria cobrança);
//  2. cadastra o nosso webhook na conta MushPag, que não tem tela para isso:
//     é só pela API. Sem ele o pagamento ainda confirma pela consulta
//     periódica, mas com atraso; com ele, na hora.
// O painel chama esta rota sozinho logo depois de salvar uma chave nova.
export async function POST() {
  try {
    const { store } = await requireStore();
    const chave = await checkMushpagCredentials(store.id);
    if (!chave.ok) return json({ error: chave.error ?? "Falha ao falar com a MushPag." }, 400);

    const hook = await garantirWebhookMushpag(store.id);
    if (!hook.ok) {
      // Chave boa, webhook não: avisa sem esconder que a chave funciona.
      return json({ error: `Chave aceita, mas o webhook não foi cadastrado: ${hook.error}` }, 400);
    }
    const textoHook =
      hook.estado === "criado"
        ? "Webhook cadastrado na sua conta MushPag."
        : hook.estado === "reativado"
          ? "Webhook que estava desligado foi religado."
          : "Webhook já estava cadastrado.";
    return json({ ok: true, message: `Chave aceita pela MushPag.${chave.info ?? ""} ${textoHook}` });
  } catch (err) {
    return handleError(err);
  }
}
