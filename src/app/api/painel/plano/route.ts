import { z } from "zod";
import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { planoDaConta, ativarBasic } from "@/lib/plans";
import { gerarCobrancaPlano, conferirCobrancaPlano, tabelaDePlanosAusente } from "@/lib/plan-billing";
import { PLANOS, PLANOS_IDS } from "@/lib/planos";
import { cadastroPendenteParaPix } from "@/lib/merchant-profile";

// O plano é da CONTA dona da loja ativa — e essa conta vem da sessão (via
// requireStore), nunca do corpo. Com o id no corpo, dava para pagar (ou
// rebaixar) o plano de outra pessoa.

const dataBR = (d: Date | null) =>
  d ? d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }) : "";

const escolhaSchema = z.object({ plano: z.enum(PLANOS_IDS) });

// GET /api/painel/plano?cobranca=<id> — plano atual; com `cobranca`, confere
// antes se aquele Pix já caiu (é o que a tela consulta enquanto ele está aberto).
export async function GET(req: Request) {
  try {
    const { store } = await requireStore();
    const conta = store.ownerUserId;
    const cobrancaId = new URL(req.url).searchParams.get("cobranca");
    const status = cobrancaId ? await conferirCobrancaPlano(conta, cobrancaId.slice(0, 64)) : null;
    const plano = await planoDaConta(conta);
    return json({ plano, status });
  } catch (err) {
    if (tabelaDePlanosAusente(err)) return json({ error: INDISPONIVEL }, 503);
    return handleError(err);
  }
}

// POST /api/painel/plano { plano } — Basic ativa na hora; pago devolve o Pix.
export async function POST(req: Request) {
  try {
    const { user, store } = await requireStore();
    const conta = store.ownerUserId;
    const { plano: alvo } = escolhaSchema.parse(await req.json().catch(() => ({})));
    const atual = await planoDaConta(conta);
    const pagoEmVigor = PLANOS[atual.plano].precoCents > 0;

    // Rebaixar no meio de um período pago jogaria fora dias que a pessoa já
    // pagou. O plano vence sozinho e a conta volta para o Basic sem congelar.
    if (pagoEmVigor && PLANOS[alvo].precoCents < PLANOS[atual.plano].precoCents) {
      return json(
        {
          error: `Seu plano ${PLANOS[atual.plano].nome} vale até ${dataBR(atual.expiraEm)}. Para ir a um plano menor, espere o período atual acabar — a troca para o Basic é automática.`,
        },
        409,
      );
    }

    if (alvo === "basic") {
      await ativarBasic(conta);
      return json({ ok: true, ativo: true });
    }

    const pendente = await cadastroPendenteParaPix(conta, user.id);
    if (pendente) return json(pendente, 409);

    const r = await gerarCobrancaPlano(conta, alvo);
    if (!r.ok) return json({ error: r.erro ?? "Não foi possível gerar o Pix." }, 400);
    return json({ ok: true, cobranca: r.cobranca });
  } catch (err) {
    if (tabelaDePlanosAusente(err)) return json({ error: INDISPONIVEL }, 503);
    return handleError(err);
  }
}

const INDISPONIVEL = "A troca de plano ainda está sendo ativada. Tente de novo em alguns minutos.";
