import "server-only";
import { query } from "./db";

// Premiação do lojista: marcos de faturamento PAGO somado de todas as lojas da
// conta, desde o início. A barra do topo mostra o caminho até o próximo marco.
//
// Os marcos ficam aqui, num lugar só: para mudar valores ou nomes das placas,
// é só editar esta lista (em centavos).
export const MARCOS: { cents: number; label: string }[] = [
  { cents: 10_000_00, label: "R$ 10 mil" },
  { cents: 100_000_00, label: "R$ 100 mil" },
  { cents: 500_000_00, label: "R$ 500 mil" },
  { cents: 1_000_000_00, label: "R$ 1 milhão" },
  { cents: 5_000_000_00, label: "R$ 5 milhões" },
  { cents: 10_000_000_00, label: "R$ 10 milhões" },
];

export type Premiacao = {
  /** Faturamento pago da conta, em centavos. */
  totalCents: number;
  /** Último marco batido (null se nenhum). */
  atual: { cents: number; label: string } | null;
  /** Próximo marco (null quando todos foram batidos). */
  proximo: { cents: number; label: string } | null;
  /** 0–1: quanto do caminho até o próximo marco já foi feito. */
  progresso: number;
  conquistados: number;
  totalMarcos: number;
};

export async function premiacaoDaConta(userId: string): Promise<Premiacao> {
  // "Pago" = PAID ou SHIPPED, a mesma regra do dashboard.
  const [row] = await query<{ v: number | string | null }>(
    `SELECT COALESCE(SUM(o.totalCents), 0) AS v
       FROM orders o JOIN stores s ON s.id = o.storeId
      WHERE s.ownerUserId = ? AND o.status IN ('PAID','SHIPPED')`,
    [userId],
  );
  const total = Number(row?.v ?? 0);
  const batidos = MARCOS.filter((m) => total >= m.cents);
  const atual = batidos.at(-1) ?? null;
  const proximo = MARCOS.find((m) => total < m.cents) ?? null;
  // A barra mede do ZERO até o próximo marco: o lojista lê "R$ 26 mil de R$ 100 mil".
  const progresso = proximo ? Math.min(1, total / proximo.cents) : 1;
  return { totalCents: total, atual, proximo, progresso, conquistados: batidos.length, totalMarcos: MARCOS.length };
}
