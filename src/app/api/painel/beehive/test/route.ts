import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkBeehiveCredentials } from "@/lib/beehive";

// POST /api/painel/beehive/test
//
// Confere a chave com uma LEITURA (GET /v1/balance) e, de quebra, descobre QUAL
// formato de autenticação a conta aceita — a doc da Beehive se contradiz (prosa
// diz Bearer, exemplo em curl diz Basic, visão geral cita x-api-key), então
// provamos os formatos em vez de escolher um por fé.
//
// Nunca cria cobrança: testar integração não pode gerar movimento na conta.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkBeehiveCredentials(store.id);
    if (!r.ok) {
      // `detalhe` traz o que a API respondeu em cada formato. Vai para o
      // lojista porque é a conta DELE — e sem isso "recusada" não ajuda ninguém
      // a descobrir se errou a chave ou se a API mudou.
      return json({ error: r.error ?? "Falha ao falar com a Beehive.", detalhe: r.detalhe }, 400);
    }
    return json({ ok: true, message: `Chave aceita pela Beehive (autenticação: ${r.modo}).` });
  } catch (err) {
    return handleError(err);
  }
}
