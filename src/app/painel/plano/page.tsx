import { getActiveStore } from "@/lib/stores";
import { getFeeConfig } from "@/lib/platform-fees";
import { planoDaConta } from "@/lib/plans";
import { cobrancaPlanoAberta } from "@/lib/plan-billing";
import EscolherPlano from "@/components/painel/EscolherPlano";

export const dynamic = "force-dynamic";

// Troca e renovação de plano. A primeira escolha acontece no layout do painel
// (antes de qualquer seção); esta é a mesma grade, para quem já tem plano.
export default async function PlanoPage() {
  const store = await getActiveStore();
  if (!store) return null;

  const [conta, { pct }, aberta] = await Promise.all([
    planoDaConta(store.ownerUserId),
    getFeeConfig(),
    cobrancaPlanoAberta(store.ownerUserId),
  ]);

  return (
    <EscolherPlano
      padraoPct={pct}
      atual={conta.plano}
      vencido={conta.vencido}
      expiraEm={conta.expiraEm ? conta.expiraEm.toISOString() : null}
      cobrancaAberta={aberta}
    />
  );
}
