import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkNuvraCredentials } from "@/lib/nuvra";

// POST /api/painel/nuvra/test
// Confere a chave com uma LEITURA (GET /balance) e, de carona, diz o ambiente
// (chave nvr_dev_ cobra de mentira) e se o cartão está liberado na conta, que
// depende da Nuvra. Nunca cria cobrança.
//
// O endereço de tokenização vai junto na mensagem: o navegador posta o cartão
// nele, e ele precisa estar liberado no connect-src do CSP (next.config.js).
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkNuvraCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Nuvra." }, 400);

    const teste = r.environment && r.environment !== "live" ? " Atenção: chave de TESTE, as cobranças não são reais." : "";
    const cartao = r.card
      ? ` Cartão liberado (até ${r.card.maxInstallments}x${r.card.tokenizeHost ? `, tokenização em ${r.card.tokenizeHost}` : ""}).`
      : " Cartão NÃO liberado nesta conta: peça a liberação ao suporte da Nuvra.";
    return json({ ok: true, message: `Chave aceita.${cartao}${teste}` });
  } catch (err) {
    return handleError(err);
  }
}
