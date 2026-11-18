import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { resolveRange, rangeClause, rangeLabel } from "@/lib/painel-range";
import { abandonedCartsSql, recoveredOrdersSql } from "@/lib/abandoned-carts";
import DashboardView, { type DashboardData } from "@/components/painel/dashboard/DashboardView";
import { dashboardSeries } from "@/lib/dashboard-series";
import { scoreConversao } from "@/lib/score-conversao";

// A resolução de período vive em @/lib/painel-range (compartilhada com a tela
// de Dispositivos), para as duas nunca discordarem do que é "7 dias".

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const store = await getActiveStore();
  const { period: periodParam, from: fromParam, to: toParam } = await searchParams;
  const { key: activeKey, since, until } = resolveRange(periodParam, fromParam, toParam);

  if (!store) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dashboard</h1>
        <div className="mt-6 rounded-2xl bg-card p-12 text-center">
          <p className="text-[13px] text-low">Crie sua primeira loja no seletor à esquerda para começar.</p>
        </div>
      </div>
    );
  }

  // Cláusulas de período (createdAt entre since e until). Vazias quando "Tudo".
  const rOrders = rangeClause("createdAt", since, until);
  const rOrdersAlias = rangeClause("o.createdAt", since, until);
  // Prefixado com o alias: a consulta de leads agora tem um NOT EXISTS sobre
  // `orders`, e um `updatedAt` solto ficaria ambíguo entre as duas tabelas.
  const rLeads = rangeClause("ac.updatedAt", since, until);

  // "Pago" = PAID ou SHIPPED: ao enviar o código de rastreio o pedido vira
  // SHIPPED, mas continua sendo uma venda paga (não pode sumir do faturamento).
  const [stats] = await query<any>(
    `SELECT COUNT(*) AS totalOrders,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END), 0) AS paidCents,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS paidCount,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'PIX' THEN totalCents ELSE 0 END), 0) AS paidPixCents,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'PIX' THEN 1 ELSE 0 END), 0) AS paidPixCount,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'CREDIT_CARD' THEN totalCents ELSE 0 END), 0) AS paidCardCents,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'CREDIT_CARD' THEN 1 ELSE 0 END), 0) AS paidCardCount,
            COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pendingCount,
            -- Denominadores das roscas de aprovação. Pix e cartão medem coisas
            -- DIFERENTES: o Pix é gerado e pago ou não (conversão sobre o total
            -- gerado); o cartão é decidido na hora, então o que conta é
            -- aprovado ÷ decidido — pendente de cartão (análise) fica de fora
            -- para não ser lido como recusa.
            COALESCE(SUM(CASE WHEN paymentMethod = 'PIX' THEN 1 ELSE 0 END), 0) AS pixTotal,
            COALESCE(SUM(CASE WHEN status = 'CANCELLED' AND paymentMethod = 'CREDIT_CARD' THEN 1 ELSE 0 END), 0) AS cardDeclined
     FROM orders
     -- Recusa REPETIDA do mesmo cartão (cliente apertando "Pagar" de novo)
     -- conta uma vez só: as anteriores ficam agrupadas na mais nova
     -- (cardHiddenBy, lib/card-tentativas.ts). Cartão diferente conta à parte.
     -- Só recusas são agrupadas, então pago e pendente não mudam; e o total
     -- de pedidos passa a bater com a lista de Vendas, que já esconde as mesmas.
     WHERE storeId = ? AND cardHiddenBy IS NULL${rOrders.sql}`,
    [store.id, ...rOrders.params],
  );

  // Carrinhos abandonados = pedidos PENDENTES (Pix gerado, não pago) + leads
  // abertos (preencheram contato, não geraram Pix). São conjuntos disjuntos:
  // um lead que gera Pix vira CONVERTED.
  const [pendAgg] = await query<any>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(totalCents), 0) AS v,
            COALESCE(SUM(CASE WHEN paymentMethod = 'PIX' THEN 1 ELSE 0 END), 0) AS pixC,
            COALESCE(SUM(CASE WHEN paymentMethod = 'PIX' THEN totalCents ELSE 0 END), 0) AS pixV,
            COALESCE(SUM(CASE WHEN paymentMethod = 'CREDIT_CARD' THEN 1 ELSE 0 END), 0) AS cardC,
            COALESCE(SUM(CASE WHEN paymentMethod = 'CREDIT_CARD' THEN totalCents ELSE 0 END), 0) AS cardV
     FROM orders WHERE storeId = ? AND status = 'PENDING'${rOrders.sql}`,
    [store.id, ...rOrders.params],
  );
  // Dispositivos: celular x computador no faturamento pago. TABLET entra em
  // MOBILE (é aparelho de toque, e a pergunta do lojista tem dois lados) e os
  // pedidos anteriores ao registro de dispositivo ficam de fora do
  // denominador — incluí-los achataria as duas barras. Mesma regra da tela
  // cheia em /painel/dispositivos, aberta pelo link "Detalhes" da dashboard.
  const [devAgg] = await query<any>(
    `SELECT COALESCE(SUM(CASE WHEN device IN ('MOBILE','TABLET') AND status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END), 0) AS mobV,
            COALESCE(SUM(CASE WHEN device IN ('MOBILE','TABLET') AND status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS mobC,
            COALESCE(SUM(CASE WHEN device = 'DESKTOP' AND status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END), 0) AS deskV,
            COALESCE(SUM(CASE WHEN device = 'DESKTOP' AND status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS deskC
       FROM orders WHERE storeId = ?${rOrders.sql}`,
    [store.id, ...rOrders.params],
  );
  const mobValue = Number(devAgg?.mobV ?? 0);
  const mobCount = Number(devAgg?.mobC ?? 0);
  const deskValue = Number(devAgg?.deskV ?? 0);
  const deskCount = Number(devAgg?.deskC ?? 0);

  // MESMA regra da tela de Carrinhos, importada de @/lib/abandoned-carts: só
  // leads, sem quem pagou depois e sem duplicar o mesmo cliente com o mesmo
  // carrinho. Se o número aqui discordasse da lista, o lojista clicaria no
  // cartão e encontraria outra contagem.
  const [leadAgg] = await query<any>(
    `SELECT COUNT(*) AS c, COALESCE(SUM(totalCents), 0) AS v
       FROM (${abandonedCartsSql(rLeads.sql)}) deduplicado`,
    [store.id, ...rLeads.params],
  );
  const abandonedCount = Number(leadAgg?.c ?? 0);
  const abandonedValue = Number(leadAgg?.v ?? 0);

  // Recuperação = VENDAS que vieram de um e-mail de reengajamento (carrinho
  // abandonado ou Pix não pago). Conta quem voltou e pagou — disparo sem venda
  // não entra.
  //
  // Datado pela VENDA, como todos os outros cards desta tela, e com a MESMA
  // condição que a cobrança da taxa usa. Antes era datado pelo disparo do
  // e-mail: uma venda de hoje, vinda de um e-mail de ontem, era cobrada como
  // recuperada e não aparecia no card de hoje.
  const rRecovered = rangeClause("o.createdAt", since, until);
  const [recAgg] = await query<any>(recoveredOrdersSql(rRecovered.sql), [store.id, ...rRecovered.params]);

  const recoveredCount = Number(recAgg?.n ?? 0);
  const recoveredValue = Number(recAgg?.valor ?? 0);
  const recCartCount = Number(recAgg?.cartN ?? 0);
  const recCartValue = Number(recAgg?.cartValor ?? 0);
  const recPixCount = Number(recAgg?.pixN ?? 0);
  const recPixValue = Number(recAgg?.pixValor ?? 0);
  // Quebra por método (só os pedidos pendentes; os leads ainda não escolheram forma).
  const pendPixCount = Number(pendAgg?.pixC ?? 0);
  const pendPixValue = Number(pendAgg?.pixV ?? 0);
  const pendCardCount = Number(pendAgg?.cardC ?? 0);
  const pendCardValue = Number(pendAgg?.cardV ?? 0);

  // ── Funil do checkout ──────────────────────────────────────────────────────
  // Fonte única e própria: checkout_funnel (uma linha por sessão, com o passo
  // máximo alcançado). Não depende de abandoned_carts — que existe para
  // recuperação de carrinho e tem outro histórico —, então todas as etapas
  // nascem juntas e sempre cobrem a mesma janela.
  const [funnelAgg] = await query<any>(
    `SELECT COUNT(*) AS chegaram,
            COALESCE(SUM(CASE WHEN step >= 1 THEN 1 ELSE 0 END), 0) AS dados,
            COALESCE(SUM(CASE WHEN step >= 2 THEN 1 ELSE 0 END), 0) AS endereco,
            COALESCE(SUM(CASE WHEN step >= 3 THEN 1 ELSE 0 END), 0) AS pagamento
     FROM checkout_funnel WHERE storeId = ?${rOrders.sql}`,
    [store.id, ...rOrders.params],
  );

  // "Comprou" vem de orders (o beat não vê o Pix pago depois que o cliente sai
  // da página). Limitado ao início do rastreio para não contar vendas de antes
  // de o funil existir — senão a última etapa ficaria maior que o topo.
  const [trackRow] = await query<{ startedAt: string | Date | null }>(
    `SELECT MIN(createdAt) AS startedAt FROM checkout_funnel WHERE storeId = ?`,
    [store.id],
  );
  const funnelStart = trackRow?.startedAt ? new Date(trackRow.startedAt) : null;
  const funnelSince = funnelStart && (!since || funnelStart > since) ? funnelStart : since;
  const rFunnelPaid = rangeClause("createdAt", funnelSince, until);
  const [funnelPaid] = await query<any>(
    `SELECT COUNT(*) AS n FROM orders
      WHERE storeId = ? AND status IN ('PAID','SHIPPED')${rFunnelPaid.sql}`,
    [store.id, ...rFunnelPaid.params],
  );

  const recent = await query<any>(
    // Sem as tentativas de cartão empilhadas: a mais nova mostra "Recusado N×".
    `SELECT o.id, o.status, o.totalCents, o.createdAt, o.paymentMethod, o.cardAttempts,
            COALESCE(u.name, o.customerName) AS userName,
            COALESCE(u.email, o.customerEmail) AS userEmail
     FROM orders o LEFT JOIN users u ON u.id = o.userId
     WHERE o.storeId = ? AND o.cardHiddenBy IS NULL${rOrdersAlias.sql}
     ORDER BY o.createdAt DESC LIMIT 8`,
    [store.id, ...rOrdersAlias.params],
  );

  const totalOrders = Number(stats?.totalOrders ?? 0);
  const paidCount = Number(stats?.paidCount ?? 0);
  const pendingCount = Number(stats?.pendingCount ?? 0);
  const paidCents = Number(stats?.paidCents ?? 0);
  // Ticket médio = faturamento PAGO ÷ vendas PAGAS.
  //
  // Antes era `SUM(todos os totais) / COUNT(todos os pedidos)`, então Pix
  // gerado e não pago e cartão recusado entravam nas duas pontas e puxavam o
  // número para baixo. É a mesma regra que o admin e a tela de Dispositivos já
  // usavam — o dashboard do lojista era o único fora do padrão.
  const ticket = paidCount ? paidCents / paidCount : 0;

  // Denominadores das taxas de aprovação. O do cartão é "decididos", não
  // "todos": um pedido de cartão PENDENTE está em análise, e contá-lo embaixo
  // puxaria a taxa para baixo como se já tivesse sido recusado.
  const paidPixCount = Number(stats?.paidPixCount ?? 0);
  const paidCardCount = Number(stats?.paidCardCount ?? 0);
  const pixTotal = Number(stats?.pixTotal ?? 0);
  const cardDecided = paidCardCount + Number(stats?.cardDeclined ?? 0);

  // Séries no tempo dos gráficos (período atual + anterior de mesmo tamanho).
  const [series, score] = await Promise.all([dashboardSeries(store.id, activeKey, since, until), scoreConversao(store.id)]);

  const data: DashboardData = {
    storeName: store.name,
    series,
    score,
    period: {
      key: activeKey,
      label: rangeLabel(activeKey, fromParam, toParam),
      from: fromParam ?? "",
      to: toParam ?? "",
    },
    paid: {
      cents: paidCents,
      count: paidCount,
      pixCents: Number(stats?.paidPixCents ?? 0),
      pixCount: paidPixCount,
      cardCents: Number(stats?.paidCardCents ?? 0),
      cardCount: paidCardCount,
    },
    orders: { total: totalOrders, pending: pendingCount },
    ticketCents: Math.round(ticket),
    approval: { pixPaid: paidPixCount, pixTotal, cardApproved: paidCardCount, cardDecided },
    devices: { mobileCents: mobValue, mobileCount: mobCount, desktopCents: deskValue, desktopCount: deskCount },
    pending: {
      cents: Number(pendAgg?.v ?? 0),
      count: pendingCount,
      pixCents: pendPixValue,
      pixCount: pendPixCount,
      cardCents: pendCardValue,
      cardCount: pendCardCount,
    },
    abandoned: { cents: abandonedValue, count: abandonedCount },
    recovered: {
      cents: recoveredValue,
      count: recoveredCount,
      cartCents: recCartValue,
      cartCount: recCartCount,
      pixCents: recPixValue,
      pixCount: recPixCount,
    },
    // Funil do checkout no período (dados reais: visitas + leads + pagos).
    // Todas as etapas sempre aparecem — 0 quando não há dado no período.
    funnel: [
      { label: "Chegaram no checkout", short: "Checkout", value: Number(funnelAgg?.chegaram ?? 0) },
      { label: "Dados pessoais", short: "Dados", value: Number(funnelAgg?.dados ?? 0) },
      { label: "Endereço", short: "Endereço", value: Number(funnelAgg?.endereco ?? 0) },
      { label: "Pagamento", short: "Pagamento", value: Number(funnelAgg?.pagamento ?? 0) },
      { label: "Comprou", short: "Compra", value: Number(funnelPaid?.n ?? 0), done: true },
    ],
    recent: recent.map((o) => ({
      id: String(o.id),
      status: String(o.status),
      paymentMethod: o.paymentMethod ?? null,
      cardAttempts: Number(o.cardAttempts ?? 1),
      totalCents: Number(o.totalCents ?? 0),
      createdAt: o.createdAt,
      name: o.userName ?? "Visitante",
      email: o.userEmail ?? null,
    })),
  };

  return <DashboardView data={data} />;
}