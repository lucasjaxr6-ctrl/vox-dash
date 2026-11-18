import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { statusOnboarding } from "@/lib/onboarding";

// GET /api/painel/onboarding — situação das etapas da loja ativa. A tela de
// uma etapa consulta isto enquanto está aberta: quando a etapa fica pronta, o
// lojista volta sozinho para o Início.
export async function GET() {
  try {
    const { store } = await requireStore();
    const { concluido, etapas } = await statusOnboarding(store.id);
    return json({
      concluido,
      etapas: etapas.map(({ id, feito, rotas }) => ({ id, feito, rotas })),
    });
  } catch (err) {
    return handleError(err);
  }
}
