import Link from "next/link";
import { getOverview, getPaymentMix, getStoresOverview, parseRange } from "@/lib/admin";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";
import { BAR_MOTION } from "@/components/painel/dashboard/Viz";
import { PendingArea } from "@/components/painel/dashboard/PeriodTransition";
import { PageHeader, Panel, MetricCard, EmptyState, brl, pct, RANGE_LABELS, METHOD_LABEL } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const REPORTS = [
  {
    type: "transacoes",
    title: "Transações",
    detail: "Um pedido por linha: loja, status, método, gateway, valores, dados do cliente e datas.",
  },
  {
    type: "lojas",
    title: "Lojas",
    detail: "Uma loja por linha: receita, aprovadas, recusadas, pendentes, taxa de aprovação e situação.",
  },
  {
    type: "clientes",
    title: "Clientes",
    detail: "Um comprador por linha: quanto gastou, quantos pedidos, em quantas lojas e período de compra.",
  },
];

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range);
  const [o, mix, stores] = await Promise.all([
    getOverview(range),
    getPaymentMix(range),
    getStoresOverview(range),
  ]);

  const active = stores.filter((s) => s.gmvCents > 0 || s.orders > 0);
  const mixTotal = mix.reduce((s, m) => s + m.gmvCents, 0);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Relatórios"
        subtitle="Resumo do período e exportação em CSV."
        range={range}
        baseHref="/admin/relatorios"
      />

      <PendingArea className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Receita bruta" value={<AnimatedNumber value={o.grossCents} format="brl" display />} note={RANGE_LABELS[range]} />
        <MetricCard label="Vendas aprovadas" value={<AnimatedNumber value={o.approved} />} note={RANGE_LABELS[range]} />
        <MetricCard label="Taxa de aprovação" value={o.approvalRate === null ? "—" : <AnimatedNumber value={o.approvalRate} format="pct" fractionDigits={1} />} note="Pagos ÷ (pagos + recusados + Pix não pagos)" />
        <MetricCard label="Ticket médio" value={<AnimatedNumber value={o.avgTicketCents} format="brl" display />} note="Receita ÷ aprovadas" />
      </div>

      <Panel title="Exportar" padded>
        <div className="grid gap-3 lg:grid-cols-3">
          {REPORTS.map((r) => (
            <div key={r.type} className="flex flex-col rounded-xl border border-line p-4">
              <h3 className="text-[14px] font-bold text-hi">{r.title}</h3>
              <p className="mt-1 flex-1 text-xs leading-relaxed text-low">{r.detail}</p>
              {/* Link direto: o navegador baixa o CSV, sem passar por JS. */}
              <a
                href={`/api/admin/export?type=${r.type}&range=${range}`}
                className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white transition hover:bg-brand-hover"
              >
                <IconDownload />
                Baixar CSV
              </a>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-low">
          Período aplicado: <b className="text-mid">{RANGE_LABELS[range]}</b>. Arquivo separado por
          ponto e vírgula, com acentuação preservada — abre direto no Excel. Até 20 mil linhas por arquivo.
        </p>
      </Panel>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title="Receita por método" padded>
          {mix.length === 0 ? (
            <EmptyState>Sem vendas no período.</EmptyState>
          ) : (
            <ul className="space-y-3">
              {mix.map((m) => {
                const share = mixTotal > 0 ? (m.gmvCents / mixTotal) * 100 : 0;
                return (
                  <li key={m.method}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-mid">{METHOD_LABEL[m.method] ?? m.method}</span>
                      <span className="font-semibold tabular-nums text-hi"><AnimatedNumber value={m.gmvCents} format="brl" /></span>
                    </div>
                    {/* Mesmas cores da visão geral: Pix e cartão nunca trocam de cor entre telas. */}
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-soft">
                      <div className={`h-full w-full rounded-full ${BAR_MOTION} motion-reduce:transition-none ${m.method === "PIX" ? "bg-[var(--viz-pix)]" : m.method === "CREDIT_CARD" ? "bg-[var(--viz-card)]" : "bg-[var(--viz-mid)]"}`} style={{ clipPath: `inset(0 ${100 - Math.max(0, Math.min(100, share))}% 0 0 round 999px)` }} />
                    </div>
                    <div className="mt-1 text-[11px] tabular-nums text-low">
                      <AnimatedNumber value={share} format="pct" fractionDigits={1} /> · <AnimatedNumber value={m.orders} /> {m.orders === 1 ? "venda" : "vendas"}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Receita por loja">
          {active.length === 0 ? (
            <EmptyState>Nenhuma loja com movimento no período.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                    <th className="px-5 py-2.5">Loja</th>
                    <th className="px-3 py-2.5 text-right">Receita</th>
                    <th className="px-3 py-2.5 text-right">Vendas</th>
                    <th className="px-5 py-2.5 text-right">Aprovação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {active.map((s) => (
                    <tr key={s.id} className="transition-colors hover:bg-hover">
                      <td className="max-w-[200px] truncate px-5 py-2.5 font-medium text-hi">
                        <Link href={`/admin/loja/${s.id}`} className="hover:text-brand dark:hover:text-brand-bright">{s.name}</Link>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-hi">{brl(s.gmvCents)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-mid">{s.orders}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums text-mid">{pct(s.approvalRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      </PendingArea>
    </div>
  );
}

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 11l5 5 5-5M4 20h16" />
    </svg>
  );
}
