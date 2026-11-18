import "server-only";
import { query } from "./db";

// Score de conversão do checkout: uma nota de 0 a 100 que resume a saúde do
// checkout nos ÚLTIMOS 30 DIAS (fixo, não segue o filtro de período — fica ao
// lado dos visitantes ao vivo, fora da área que o filtro governa).
//
// Três componentes, cada um comparado com uma META. Bater a meta dá a nota
// cheia do componente; abaixo dela, a nota cai em proporção. Pesos e metas
// ficam aqui, num lugar só, para ajustar sem mexer na tela.
export const COMPONENTES = [
  { key: "conversao", label: "Conversão", peso: 50, meta: 0.25, dica: "Quem comprou ÷ quem chegou ao checkout" },
  { key: "aprovacao", label: "Aprovação", peso: 30, meta: 0.9, dica: "Pix pagos + cartões aprovados ÷ Pix gerados + cartões decididos" },
  { key: "avanco", label: "Até o pagamento", peso: 20, meta: 0.6, dica: "Quem chegou à etapa de pagamento ÷ quem chegou ao checkout" },
] as const;

export type ScoreComponente = { key: string; label: string; dica: string; taxa: number | null; pontos: number; peso: number; meta: number };
export type ScoreConversao = { score: number | null; componentes: ScoreComponente[]; checkouts: number };

const DIAS = 30;

export async function scoreConversao(storeId: string): Promise<ScoreConversao> {
  const since = new Date(Date.now() - DIAS * 86400000);

  const [f] = await query<any>(
    `SELECT COUNT(*) AS chegaram,
            COALESCE(SUM(CASE WHEN step >= 3 THEN 1 ELSE 0 END), 0) AS pagamento,
            MIN(createdAt) AS inicio
       FROM checkout_funnel WHERE storeId = ? AND createdAt >= ?`,
    [storeId, since],
  );
  const chegaram = Number(f?.chegaram ?? 0);
  // "Comprou" sai de orders, limitado ao início do rastreio do funil (mesma
  // regra do funil do dashboard: senão a compra passaria do topo do funil).
  const inicio = f?.inicio ? new Date(f.inicio) : since;
  const [o] = await query<any>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') AND createdAt >= ? THEN 1 ELSE 0 END), 0) AS compraram,
            COALESCE(SUM(CASE WHEN paymentMethod = 'PIX' THEN 1 ELSE 0 END), 0) AS pixGerados,
            COALESCE(SUM(CASE WHEN paymentMethod = 'PIX' AND status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS pixPagos,
            COALESCE(SUM(CASE WHEN paymentMethod = 'CREDIT_CARD' AND status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS cartaoAprov,
            COALESCE(SUM(CASE WHEN paymentMethod = 'CREDIT_CARD' AND status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cartaoRecus
       FROM orders WHERE storeId = ? AND cardHiddenBy IS NULL AND createdAt >= ?`,
    [inicio, storeId, since],
  );
  const compraram = Number(o?.compraram ?? 0);
  const tentativas = Number(o?.pixGerados ?? 0) + Number(o?.cartaoAprov ?? 0) + Number(o?.cartaoRecus ?? 0);
  const aprovados = Number(o?.pixPagos ?? 0) + Number(o?.cartaoAprov ?? 0);

  const taxas: Record<string, number | null> = {
    conversao: chegaram > 0 ? Math.min(1, compraram / chegaram) : null,
    aprovacao: tentativas > 0 ? aprovados / tentativas : null,
    avanco: chegaram > 0 ? Number(f?.pagamento ?? 0) / chegaram : null,
  };

  const componentes = COMPONENTES.map((c) => {
    const taxa = taxas[c.key];
    const pontos = taxa === null ? 0 : Math.min(1, taxa / c.meta) * c.peso;
    return { key: c.key, label: c.label, dica: c.dica, taxa, pontos, peso: c.peso, meta: c.meta };
  });
  // Sem checkout no período não há nota: zero seria injusto, e "—" é honesto.
  const score = chegaram > 0 ? Math.round(componentes.reduce((s, c) => s + c.pontos, 0)) : null;
  return { score, componentes, checkouts: chegaram };
}
