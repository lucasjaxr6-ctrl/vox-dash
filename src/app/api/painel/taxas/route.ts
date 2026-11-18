import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { gerarCobranca, cobrancasAbertas } from "@/lib/platform-fees";
import { cadastroPendenteParaPix } from "@/lib/merchant-profile";

// POST /api/painel/taxas — o LOJISTA gera o Pix da própria taxa.
//
// O storeId vem da sessão, nunca do corpo: com ele no corpo, um lojista
// poderia gerar (e ver) a cobrança de outra loja.
export async function POST() {
  try {
    const { user, store } = await requireStore();

    const pendente = await cadastroPendenteParaPix(store.ownerUserId, user.id);
    if (pendente) return json(pendente, 409);

    // Cobrança já aberta é devolvida em vez de criar outra — dois Pix para a
    // mesma dívida terminam com o lojista pagando duas vezes.
    const abertas = await cobrancasAbertas(store.id);
    if (abertas[0]) return json({ ok: true, cobranca: abertas[0], jaExistia: true });

    const r = await gerarCobranca(store.id);
    if (!r.ok) return json({ error: r.erro ?? "Não foi possível gerar o Pix." }, 400);
    return json({ ok: true, cobranca: r.cobranca });
  } catch (err) {
    return handleError(err);
  }
}
