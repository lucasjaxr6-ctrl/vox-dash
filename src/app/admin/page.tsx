import Link from "next/link";
import {
  getOverview,
  getPaymentMix,
  getStoresOverview,
  getDailyRevenue,
  getDbHealth,
  getUsuarios,
  parseRange,
} from "@/lib/admin";
import { listarAssinaturas } from "@/lib/plans";
import { PLANOS } from "@/lib/planos";
import RevenueChart from "@/components/admin/RevenueChart";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";
import { BAR_MOTION } from "@/components/painel/dashboard/Viz";
import { resumoTaxas } from "@/lib/platform-fees";
import {
  PageHeader,
  MetricCard,
  Panel,
  EmptyState,
  brl,
  pct,
  initials,
  METHOD_LABEL,
  StoreStatus,
} from "@/components/admin/ui";
import { PendingArea } from "@/components/painel/dashboard/PeriodTransition";

export const dynamic = "force-dynamic";

/** Variação percentual entre dois valores. null quando não há base. */
function delta(cur: number, prev: number | undefined | null): number | null {
  if (prev === undefined || prev === null || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}
/** Variação em pontos percentuais (para taxas). */
function deltaPP(cur: number | null, prev: number | null | undefined): number | null {
  if (cur === null || prev === undefined || prev === null) return null;
  return cur - prev;
}

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const range = parseRange((await searchParams).range, "today");
  const [o, mix, stores, daily, db, feeResumo, usuarios, assinaturas] = await Promise.all([
    getOverview(range),
    getPaymentMix(range),
    getStoresOverview(range),
    getDailyRevenue(30),
    // Se o banco cair, a página inteira não pode cair junto.
    getDbHealth().catch(() => null),
    resumoTaxas(),
    getUsuarios(range),
    // A mesma lista da página de Assinaturas: o número do card bate com o de lá.
    listarAssinaturas(),
  ]);

  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
  // Lojas que venderam no período, das que existem (sai da lista que já veio).
  const lojasAtivas = stores.filter((s) => s.orders > 0).length;
  // Plano pago e em dia: mesma regra da página de Assinaturas.
  const pagas = assinaturas.filter((a) => PLANOS[a.plano].precoCents > 0);
  const premium = pagas.filter((a) => a.plano === "premium").length;
  const enterprise = pagas.filter((a) => a.plano === "enterprise").length;
  const mixTotal = mix.reduce((s, m) => s + m.gmvCents, 0);
  // Métodos fixos continuam no mesmo lugar mesmo quando o período não tem vendas.
  const paymentRows = ["PIX", "CREDIT_CARD", "BOLETO"].map((method) =>
    mix.find((m) => m.method === method) ?? { method, gmvCents: 0, orders: 0 },
  );
  paymentRows.push(...mix.filter((m) => !(m.method in METHOD_LABEL)));
  const top = stores.filter((s) => s.gmvCents > 0 || s.orders > 0).slice(0, 5);
  const hasRevenue = daily.some((d) => d.gmvCents > 0);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Visão geral"
        subtitle="Acompanhe o desempenho da sua plataforma."
        range={range}
        baseHref="/admin"
        right={
          <Link
            href={`/admin/relatorios?range=${range}`}
            className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[13px] font-bold text-white transition hover:bg-brand-hover"
          >
            <IconExport />
            Exportar
          </Link>
        }
      />

      <PendingArea className="space-y-4">
      {/* Métricas do período.
          Grade de 4, igual à das taxas logo abaixo: são 4 cartões, e um grid de
          5 deixava a linha com um vão no fim e cartões de largura diferente da
          linha seguinte — a tela parecia desalinhada de propósito. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Receita bruta"
          value={<AnimatedNumber value={o.grossCents} format="brl" display />}
          delta={delta(o.grossCents, o.prev?.grossCents)}
          note={o.prev ? undefined : "Sem período anterior para comparar"}
        />
        <MetricCard
          label="Vendas aprovadas"
          value={<AnimatedNumber value={o.approved} />}
          delta={delta(o.approved, o.prev?.approved)}
          note={o.prev ? undefined : "Sem período anterior para comparar"}
        />
        <MetricCard
          label="Taxa de aprovação"
          value={o.approvalRate === null ? "—" : <AnimatedNumber value={o.approvalRate} format="pct" fractionDigits={1} />}
          delta={deltaPP(o.approvalRate, o.prev?.approvalRate)}
          deltaSuffix=" p.p."
          note={o.approvalRate === null ? "Nenhum Pix ou cartão no período" : undefined}
        />
        <MetricCard
          label="Ticket médio"
          value={<AnimatedNumber value={o.avgTicketCents} format="brl" display />}
          delta={delta(o.avgTicketCents, o.prev?.avgTicketCents)}
          note={o.prev ? undefined : "Sem período anterior para comparar"}
        />
      </div>

      {/* Taxas da plataforma + Pedidos, logo abaixo das métricas do período.
          As três de taxa são o saldo ACUMULADO (não seguem o filtro de
          período); Pedidos segue o período, como a linha de cima. O "Saldo
          por loja" saiu: quem deve, e quanto, está em Taxas (link "Cobrar"). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Taxa da plataforma"
          value={<AnimatedNumber value={feeResumo.totalCents} format="brl" display />}
          note={`${feeResumo.pedidos} venda(s) sobre ${brl(feeResumo.baseCents)}, desde o início`}
        />
        <MetricCard
          label="Taxas não pagas"
          value={<AnimatedNumber value={feeResumo.pendentesCents} format="brl" display />}
          note={
            feeResumo.pendentesCents > 0
              ? `${feeResumo.lojasDevendo} loja(s) com saldo em aberto`
              : "Nenhuma taxa em aberto"
          }
          action={
            <Link href="/admin/taxas" className="text-[11px] font-bold text-brand dark:text-brand-bright hover:underline">
              {feeResumo.pendentesCents > 0 ? "Cobrar" : "Gerenciar"}
            </Link>
          }
        />
        <MetricCard
          label="Taxas pagas"
          value={<AnimatedNumber value={feeResumo.pagasCents} format="brl" display />}
          note={feeResumo.pagasCents > 0 ? "Já recebido via Pix, desde o início" : "Nada recebido ainda"}
        />
        <MetricCard
          label="Pedidos"
          value={<AnimatedNumber value={o.orders} />}
          delta={delta(o.orders, o.prev?.orders)}
          note={`${plural(o.approved, "pago", "pagos")} · ${plural(o.pending, "pendente", "pendentes")} · ${plural(o.refused, "recusado", "recusados")}`}
        />
      </div>

      {/* Base da plataforma: quem usa e quem paga plano. Usuários e Planos pagos
          são o retrato de hoje; Novos usuários e Lojas ativas seguem o período. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Usuários"
          value={<AnimatedNumber value={usuarios.total} />}
          note={usuarios.bloqueados > 0 ? `${plural(usuarios.bloqueados, "conta suspensa ou banida", "contas suspensas ou banidas")}` : "Nenhuma conta bloqueada"}
          action={
            <Link href="/admin/usuarios" className="text-[11px] font-bold text-brand dark:text-brand-bright hover:underline">
              Ver todos
            </Link>
          }
        />
        <MetricCard
          label="Novos usuários"
          value={<AnimatedNumber value={usuarios.novos} />}
          delta={delta(usuarios.novos, usuarios.novosAntes)}
          note={usuarios.novosAntes === null ? "Cadastros desde o início" : usuarios.novosAntes === 0 ? "Nenhum cadastro no período anterior" : undefined}
        />
        <MetricCard
          label="Lojas ativas"
          value={<AnimatedNumber value={lojasAtivas} />}
          note={`de ${plural(stores.length, "loja", "lojas")}, com venda aprovada no período`}
        />
        <MetricCard
          label="Planos pagos"
          value={<AnimatedNumber value={pagas.length} />}
          note={`${premium} Premium · ${enterprise} Enterprise`}
          action={
            <Link href="/admin/assinaturas" className="text-[11px] font-bold text-brand dark:text-brand-bright hover:underline">
              Ver
            </Link>
          }
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Panel title="Desempenho nos últimos 30 dias" padded>
            {!hasRevenue ? (
              <EmptyState>Sem vendas no período.</EmptyState>
            ) : (
              <RevenueChart data={daily} />
            )}
          </Panel>
        </div>

      {/* Formas de pagamento */}
      <Panel
        title="Formas de pagamento"
        action={
          <Link href="/admin/transacoes" className="text-xs font-semibold text-brand dark:text-brand-bright hover:underline">
            Ver detalhes →
          </Link>
        }
        padded
      >
          <div className="space-y-5">
            {paymentRows.map((m) => {
              const share = mixTotal > 0 ? (m.gmvCents / mixTotal) * 100 : 0;
              return (
                <div key={m.method}>
                  <div className="text-[13px] font-medium text-low">{METHOD_LABEL[m.method] ?? m.method}</div>
                  <div className="mt-0.5 text-[20px] font-bold tracking-tight text-hi tabular-nums"><AnimatedNumber value={m.gmvCents} format="brl" /></div>
                  <div className="mt-0.5 text-xs text-low">
                    <AnimatedNumber value={share} format="pct" fractionDigits={1} /> do total · <AnimatedNumber value={m.orders} /> {m.orders === 1 ? "venda" : "vendas"}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-soft">
                    <div className={`h-full w-full rounded-full ${BAR_MOTION} motion-reduce:transition-none ${m.method === "PIX" ? "bg-[var(--viz-pix)]" : m.method === "CREDIT_CARD" ? "bg-[var(--viz-card)]" : "bg-[var(--viz-mid)]"}`} style={{ clipPath: `inset(0 ${100 - Math.max(0, Math.min(100, share))}% 0 0 round 999px)` }} />
                  </div>
                </div>
              );
            })}
          </div>
      </Panel>

      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0">
      {/* Principais lojas */}
      <Panel
        title="Principais lojas"
        action={
          <Link href="/admin/lojas" className="text-xs font-semibold text-brand dark:text-brand-bright hover:underline">
            Ver todas →
          </Link>
        }
      >
        {top.length === 0 ? (
          <EmptyState>Nenhuma loja com movimento no período.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-2.5">Loja</th>
                  <th className="px-3 py-2.5 text-right">Receita</th>
                  <th className="px-3 py-2.5 text-right">Vendas</th>
                  <th className="px-3 py-2.5 text-right">Aprovação</th>
                  <th className="px-3 py-2.5 text-right">Conversão</th>
                  <th className="px-3 py-2.5 text-right">Ticket médio</th>
                  <th className="px-5 py-2.5 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {top.map((s) => (
                  <tr key={s.id} className="transition hover:bg-hover">
                    <td className="px-5 py-3">
                      <Link href={`/admin/loja/${s.id}`} className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-bold text-low">
                          {initials(s.name)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-hi">{s.name}</span>
                          {s.ownerEmail && <span className="block truncate text-xs text-low">{s.ownerEmail}</span>}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(s.gmvCents)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{s.orders}</td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${s.approvalRate === null ? "text-low" : s.approvalRate > 60 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {pct(s.approvalRate)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{pct(s.conversion)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{brl(s.avgTicketCents)}</td>
                    <td className="px-5 py-3 text-right">
                      <StoreStatus suspended={s.suspended} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel></div>
        <DbPanel db={db} />
      </div>
      </PendingArea>
    </div>
  );
}

/**
 * Saúde do banco. É a única infraestrutura que conseguimos medir de verdade —
 * conexões abertas contra o teto do servidor. Passar do teto derruba TODA a
 * plataforma (checkout incluído), então o alerta é por faixa: verde até 60%,
 * âmbar até 80%, vermelho acima disso.
 */
function DbPanel({ db }: { db: { connected: number; maxConnections: number; uptimeSeconds: number } | null }) {
  if (!db) {
    return (
      <Panel title="Banco de dados" padded>
        <p className="text-sm text-low">Não foi possível ler o estado do banco agora.</p>
      </Panel>
    );
  }
  const pctUse = db.maxConnections ? (db.connected / db.maxConnections) * 100 : 0;
  const level = pctUse > 80 ? "crit" : pctUse > 60 ? "warn" : "ok";
  const bar = level === "crit" ? "bg-red-500" : level === "warn" ? "bg-amber-500" : "bg-emerald-500";
  const dot = level === "crit" ? "bg-red-500" : level === "warn" ? "bg-amber-500" : "bg-emerald-500";
  const label = level === "crit" ? "No limite" : level === "warn" ? "Atenção" : "Normal";
  const labelCls =
    level === "crit"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : level === "warn"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";

  const d = Math.floor(db.uptimeSeconds / 86400);
  const h = Math.floor((db.uptimeSeconds % 86400) / 3600);
  const m = Math.floor((db.uptimeSeconds % 3600) / 60);
  const up = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;

  return (
    <Panel
      title="Banco de dados"
      action={
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${labelCls}`}>
          <i className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
      }
      padded
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-low">Conexões abertas</span>
        <span className="text-[15px] font-bold tabular-nums text-hi">
          <AnimatedNumber value={db.connected} />
          <span className="text-low"> / {db.maxConnections}</span>
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-soft">
        <div className={`h-full w-full rounded-full ${BAR_MOTION} motion-reduce:transition-none ${bar}`} style={{ clipPath: `inset(0 ${100 - Math.max(0, Math.min(100, pctUse))}% 0 0 round 999px)` }} />
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] text-low">
        <span>{pctUse.toFixed(0)}% do limite</span>
        <span>no ar há {up}</span>
      </div>
      {level !== "ok" && (
        <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-400">
          {level === "crit"
            ? "Perto do teto de conexões — novas conexões podem ser recusadas e derrubar o checkout."
            : "Uso de conexões acima do normal. Vale acompanhar."}
        </p>
      )}
    </Panel>
  );
}

function I({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function IconExport() { return <I><path d="M12 3v12M7 11l5 5 5-5M4 20h16" /></I>; }
