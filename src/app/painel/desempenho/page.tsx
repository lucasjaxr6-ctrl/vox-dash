import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { resolveRange, rangeClause } from "@/lib/painel-range";
import PeriodControl from "@/components/painel/dashboard/PeriodControl";
import { PeriodTransition, PendingArea } from "@/components/painel/dashboard/PeriodTransition";
import { thumb } from "@/lib/image";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";

// Desempenho por produto: a mesma lista de Produtos, com o tráfego que cada um
// recebeu e o que cada um vendeu — ordenada por quem mais vendeu.
//
// De onde vem o TRÁFEGO: `abandoned_carts` guarda os itens da sessão em
// `itemsJson` (com productId), e nasce quando o cliente começa a preencher o
// checkout. É a única fonte que liga sessão a produto — `checkout_funnel` só
// guarda sessão e etapa, sem produto nenhum. Então "sessões" aqui significa
// "chegou ao checkout com este produto", não visita na página do produto.

export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
  active: number;
  /** Visitas na página do produto (vitrine). */
  visits: number;
  /** Sessões que chegaram ao checkout com o produto. */
  sessions: number;
  units: number;
  paidOrders: number;
  revenueCents: number;
};

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function Desempenho({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const store = await getActiveStore();
  const { period, from, to } = await searchParams;
  const { key: activeKey, since, until } = resolveRange(period, from, to);

  if (!store) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight text-hi">Desempenho</h1>
        <div className="mt-6 rounded-2xl bg-card p-12 text-center">
          <p className="text-[13px] text-low">Crie sua primeira loja para começar.</p>
        </div>
      </div>
    );
  }

  const rCarts = rangeClause("ac.createdAt", since, until);
  const rOrders = rangeClause("o.createdAt", since, until);
  const rViews = rangeClause("createdAt", since, until);

  const linhas = await query<Linha>(
    `SELECT p.id, p.name, p.priceCents, p.imageUrl, p.active,
            COALESCE(pv.visits, 0) AS visits,
            COALESCE(t.sessions, 0) AS sessions,
            COALESCE(v.units, 0) AS units,
            COALESCE(v.paidOrders, 0) AS paidOrders,
            COALESCE(v.revenueCents, 0) AS revenueCents
       FROM products p
       -- Visita na página do produto, medida pelo script na vitrine. Casa pelo
       -- id da SHOPIFY porque é o único que o navegador da loja conhece.
       LEFT JOIN (
         SELECT shopifyProductId AS sid, COUNT(DISTINCT sessionId) AS visits
           FROM product_views
          WHERE storeId = ?${rViews.sql}
          GROUP BY shopifyProductId
       ) pv ON pv.sid = p.shopifyId
       LEFT JOIN (
         SELECT jt.productId AS pid, COUNT(DISTINCT ac.sessionId) AS sessions
           FROM abandoned_carts ac
           JOIN JSON_TABLE(ac.itemsJson, '$[*]' COLUMNS (productId VARCHAR(64) PATH '$.productId')) jt ON 1 = 1
          WHERE ac.storeId = ?${rCarts.sql}
          GROUP BY jt.productId
       ) t ON t.pid = p.id
       LEFT JOIN (
         SELECT oi.productId AS pid,
                SUM(oi.quantity) AS units,
                COUNT(DISTINCT o.id) AS paidOrders,
                SUM(oi.unitPriceCents * oi.quantity) AS revenueCents
           FROM order_items oi
           JOIN orders o ON o.id = oi.orderId
          WHERE o.storeId = ? AND o.status IN ('PAID','SHIPPED')${rOrders.sql}
          GROUP BY oi.productId
       ) v ON v.pid = p.id
      WHERE p.storeId = ?
      ORDER BY units DESC, revenueCents DESC, sessions DESC, visits DESC, p.name ASC`,
    [store.id, ...rViews.params, store.id, ...rCarts.params, store.id, ...rOrders.params, store.id],
  );

  // O catálogo INTEIRO entra na lista. Quem não teve movimento cai naturalmente
  // no fim pela ordenação, e o desempate por nome evita que esse bloco final
  // apareça numa ordem diferente a cada carregamento.
  // Cada coluna tem a PRÓPRIA escala. Usar a mesma para as duas deixaria as
  // barras de checkout zeradas enquanto o tráfego ainda não tem histórico — e
  // cada coluna responde a uma pergunta diferente: "como este produto se compara
  // ao líder NESTA métrica".
  const maiorTrafego = Math.max(1, ...linhas.map((l) => Number(l.visits)));
  const maiorCheckout = Math.max(1, ...linhas.map((l) => Number(l.sessions)));
  const comMovimento = linhas.filter(
    (l) => Number(l.visits) > 0 || Number(l.sessions) > 0 || Number(l.units) > 0,
  ).length;

  const totalVisitas = linhas.reduce((s, l) => s + Number(l.visits), 0);
  const totalSessoes = linhas.reduce((s, l) => s + Number(l.sessions), 0);
  const totalUnidades = linhas.reduce((s, l) => s + Number(l.units), 0);
  const totalReceita = linhas.reduce((s, l) => s + Number(l.revenueCents), 0);

  return (
    <PeriodTransition>
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">Desempenho dos produtos</h1>
          <p className="mt-1 text-[13px] text-low">
            Quanto tráfego cada produto recebeu no checkout e quanto ele vendeu.
            {linhas.length > 0 && (
              <>
                {" "}
                <span className="text-dim">
                  {linhas.length} produto{linhas.length === 1 ? "" : "s"} · {comMovimento} com movimento
                  no período.
                </span>
              </>
            )}
          </p>
        </div>
        {/* Mesmo seletor da dashboard: a pílula muda NA HORA do clique e a
            tela esmaece até os números novos chegarem. Antes eram links
            comuns — trocar só o período não mostra tela de carregamento, e a
            página ficava parada sem sinal nenhum enquanto o servidor respondia. */}
        <PeriodControl active={activeKey} from={from ?? ""} to={to ?? ""} />
      </div>

      <PendingArea className="space-y-6">

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Tráfego nos produtos" valor={<AnimatedNumber value={totalVisitas} />} />
        <Resumo rotulo="Chegaram ao checkout" valor={<AnimatedNumber value={totalSessoes} />} />
        <Resumo rotulo="Unidades vendidas" valor={<AnimatedNumber value={totalUnidades} />} />

        <Resumo rotulo="Receita" valor={<AnimatedNumber value={totalReceita} format="brl" />} />
      </div>

      {totalVisitas === 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-[13px] font-bold text-amber-700 dark:text-amber-400">
            O tráfego dos produtos começa a contar agora.
          </p>
          <p className="mt-1 text-[12.5px] text-amber-700/90 dark:text-amber-400/90">
            Visita na página do produto acontece na sua loja, fora do checkout — passamos a medir isso
            só a partir desta versão. As colunas <b>Checkout</b>, <b>Vendidas</b> e <b>Receita</b> já
            têm todo o histórico.
          </p>
        </div>
      )}

      {/* ── Tabela (do tablet para cima) ──
          `table-fixed` com larguras declaradas é o que faz o nome TRUNCAR. Em
          `auto` a célula do produto cresce com o texto e empurra as colunas
          numéricas para fora da tela — era por isso que Vendidas, Conversão e
          Receita sumiam. */}
      <div className="hidden overflow-hidden rounded-2xl bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[740px] table-fixed text-sm">
            <thead className="text-left text-low text-[12px] font-medium">
              <tr>
                {/* As larguras somam 530px, deixando o resto para o Produto.
                    A Receita precisa de folga real: "R$ 20.787,00" a 13px pede
                    ~108px com o respiro das laterais, e com menos que isso o
                    valor era cortado a 768px. */}
                <th className="w-[40px] px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Produto</th>
                <th className="w-[110px] px-3 py-3 font-semibold lg:w-[150px]">Tráfego</th>
                <th className="w-[110px] px-3 py-3 font-semibold lg:w-[150px]">Checkout</th>
                <th className="w-[72px] px-3 py-3 text-right font-semibold">Unidades</th>
                <th className="w-[86px] px-3 py-3 text-right font-semibold">Conversão</th>
                <th className="w-[118px] px-3 py-3 text-right font-semibold">Receita</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-center text-[13px] text-dim" colSpan={7}>
                    Nenhum produto sincronizado ainda.
                  </td>
                </tr>
              ) : (
                linhas.map((l, i) => {
                  const visitas = Number(l.visits);
                  const sessoes = Number(l.sessions);
                  const unidades = Number(l.units);
                  const pedidos = Number(l.paidOrders);
                  // Conversão = pedidos pagos ÷ sessões que chegaram com o
                  // produto. Fica sobre CHECKOUT e não sobre tráfego de
                  // propósito: a visita só começou a ser medida agora, e dividir
                  // venda histórica por tráfego novo daria número sem sentido.
                  const conv = sessoes > 0 ? Math.round((pedidos / sessoes) * 100) : null;
                  // Produto parado continua na lista, mas recuado: em catálogo
                  // grande (uma loja aqui tem 425) a cauda de zeros é a maior
                  // parte da tabela e não pode competir com quem vende.
                  const parado = visitas === 0 && sessoes === 0 && unidades === 0;
                  return (
                    <tr
                      key={l.id}
                      className={`border-t border-line transition hover:bg-hover ${parado ? "opacity-55" : ""}`}
                    >
                      <td className="px-3 py-3 text-[12px] font-bold tabular-nums text-dim">{i + 1}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          {l.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={thumb(l.imageUrl, 44)}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              className="h-10 w-10 shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 shrink-0 rounded bg-soft" />
                          )}
                          <div className="min-w-0">
                            <div className="truncate font-medium text-hi" title={l.name}>
                              {l.name}
                            </div>
                            <div className="text-[11.5px] text-dim">
                              {brl(l.priceCents)}
                              {!l.active && " · inativo"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {/* Barra proporcional ao MAIOR tráfego: o número sozinho
                            não diz se 297 é muito ou pouco nesta loja. */}
                        {/* Número à ESQUERDA, em caixa de largura fixa: assim
                            ele cai exatamente sob o rótulo da coluna e a barra
                            começa sempre no mesmo ponto, linha após linha.
                            Alinhado à direita, o valor se descolava do
                            cabeçalho e a coluna parecia torta. */}
                        <div className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-[12.5px] font-semibold tabular-nums text-mid">
                            {visitas > 0 ? visitas.toLocaleString("pt-BR") : <span className="text-dim">—</span>}
                          </span>
                          <div className="h-[6px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-soft">
                            <div
                              className="h-full rounded-full bg-brand/70"
                              style={{ width: `${(visitas / maiorTrafego) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-[12.5px] font-semibold tabular-nums text-mid">
                            {sessoes.toLocaleString("pt-BR")}
                          </span>
                          <div className="h-[6px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-soft">
                            <div
                              className="h-full rounded-full bg-brand/70"
                              style={{ width: `${(sessoes / maiorCheckout) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{unidades}</td>
                      {/* A fração fica VISÍVEL embaixo do percentual porque as
                          duas colunas vizinhas contam coisas diferentes:
                          "Vendidas" são UNIDADES e a conversão são PEDIDOS.
                          Quem compra 3 de uma vez vira 3 unidades e 1 pedido —
                          sem a fração à mostra, a conta parece errada. */}
                      <td className="px-3 py-3 text-right tabular-nums text-mid">
                        {conv === null ? (
                          <span className="text-dim">—</span>
                        ) : (
                          <>
                            <div>{conv}%</div>
                            <div className="text-[11px] leading-tight text-dim">
                              {pedidos}/{sessoes}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-[13px] tabular-nums text-mid">
                        {brl(Number(l.revenueCents))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Cartões (celular) ──
          Seis colunas não cabem em 360px, e rolar de lado para ler um número
          não é leitura. Aqui cada produto vira um cartão com os quatro dados
          empilhados — nada fica fora da tela. */}
      <div className="space-y-2.5 md:hidden">
        {linhas.length === 0 ? (
          <div className="rounded-2xl bg-card p-8 text-center text-[13px] text-dim">
            Nenhum produto sincronizado ainda.
          </div>
        ) : (
          linhas.map((l, i) => {
            const visitas = Number(l.visits);
            const sessoes = Number(l.sessions);
            const unidades = Number(l.units);
            const pedidos = Number(l.paidOrders);
            const conv = sessoes > 0 ? Math.round((pedidos / sessoes) * 100) : null;
            const parado = visitas === 0 && sessoes === 0 && unidades === 0;
            return (
              <div
                key={l.id}
                className={`rounded-2xl bg-card p-3.5 ${parado ? "opacity-55" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className="w-5 shrink-0 pt-0.5 text-[12px] font-bold tabular-nums text-dim">{i + 1}</span>
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb(l.imageUrl, 44)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-11 w-11 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded bg-soft" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-snug text-hi">{l.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-dim">
                      {brl(l.priceCents)}
                      {!l.active && " · inativo"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 pt-3">
                  <Dado rotulo="Tráfego" valor={visitas > 0 ? visitas.toLocaleString("pt-BR") : "—"} />
                  <Dado rotulo="Checkout" valor={sessoes.toLocaleString("pt-BR")} />
                  <Dado rotulo="Unidades" valor={String(unidades)} destaque />
                  <Dado
                    rotulo="Conversão"
                    valor={conv === null ? "—" : `${conv}%`}
                    sub={conv === null ? undefined : `${pedidos} de ${sessoes} pedidos`}
                  />
                  <Dado rotulo="Receita" valor={brl(Number(l.revenueCents))} />
                </div>

                <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-soft">
                  <div
                    className="h-full rounded-full bg-brand/70"
                    style={{ width: `${(visitas / maiorTrafego) * 100}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-dim">
        <b>Tráfego</b> = visitas na página do produto na sua loja (uma por pessoa, por produto).{" "}
        <b>Checkout</b> = sessões que chegaram ao checkout com o produto no carrinho. A distância
        entre os dois é quanta gente olhou e não clicou em comprar.{" "}
        <b>Conversão</b> = <b>pedidos</b> pagos ÷ checkout — repare que <b>Unidades</b> conta peças, não
        pedidos: quem leva 3 de uma vez soma 3 unidades e 1 pedido.
      </p>
      </PendingArea>
    </div>
    </PeriodTransition>
  );
}

/** Par rótulo/valor dos cartões do celular. */
function Dado({
  rotulo,
  valor,
  sub,
  destaque,
}: {
  rotulo: string;
  valor: string;
  sub?: string;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-low text-[12px] font-medium">{rotulo}</div>
      <div className={`mt-0.5 truncate text-[14px] tabular-nums ${destaque ? "font-bold text-hi" : "text-mid"}`}>
        {valor}
      </div>
      {sub && <div className="truncate text-[10.5px] leading-tight text-dim">{sub}</div>}
    </div>
  );
}

// Os números deslizam do valor antigo para o novo na troca de período, como na dashboard.
function Resumo({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <div className="text-low text-[12px] font-medium">{rotulo}</div>
      <div className="mt-2 text-[22px] font-bold leading-none tracking-tight text-hi">{valor}</div>
    </div>
  );
}
