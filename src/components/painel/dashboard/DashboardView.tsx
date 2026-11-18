import React from "react";
import Link from "next/link";
import AnimatedNumber from "./AnimatedNumber";
import { PeriodTransition, PendingArea } from "./PeriodTransition";
import PeriodControl from "./PeriodControl";
import { Funnel, SplitHeader, SplitTile, TextLink, type SplitRow, type FunnelStage } from "./Viz";
import MetricPanel from "./MetricPanel";
import type { TrendSeries } from "./TrendChart";
import type { SeriesBlock } from "@/lib/dashboard-series";
import RecentOrders, { type RecentOrder } from "./RecentOrders";
import LiveVisitors from "@/components/painel/LiveVisitors";
import ReconcileOnMount from "@/components/painel/ReconcileOnMount";
import { IconeCartao, IconePix } from "@/components/painel/MetodoIcon";

export type DashboardData = {
  storeName: string;
  series: SeriesBlock;
  period: { key: string; label: string; from: string; to: string };
  paid: { cents: number; count: number; pixCents: number; pixCount: number; cardCents: number; cardCount: number };
  orders: { total: number; pending: number };
  ticketCents: number;
  /** Pix: pagos ÷ gerados. Cartão: aprovados ÷ decididos (aprovados + recusados). */
  approval: { pixPaid: number; pixTotal: number; cardApproved: number; cardDecided: number };
  devices: { mobileCents: number; mobileCount: number; desktopCents: number; desktopCount: number };
  pending: { cents: number; count: number; pixCents: number; pixCount: number; cardCents: number; cardCount: number };
  abandoned: { cents: number; count: number };
  recovered: { cents: number; count: number; cartCents: number; cartCount: number; pixCents: number; pixCount: number };
  funnel: FunnelStage[];
  recent: RecentOrder[];
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// Dashboard do lojista em SEÇÕES, na ordem das perguntas de quem abre o painel:
//
//   Agora         Visitantes ao vivo (faixa; não segue o filtro de período)
//   ── filtro de período: vale daqui para baixo ──
//   Conversão     Taxa de conversão ao lado do funil que a explica
//   Resultado     Vendas pagas (destaque) · Pedidos · Ticket médio (+ gráfico)
//   Recuperação   Pendentes · Carrinhos abandonados · Recuperadas (logo após a
//                 "maior perda" do funil: é a resposta a ela)
//   Como compram  Formas de pagamento | Dispositivos
//   Pedidos recentes
//
// Nenhuma informação da grade anterior saiu: só mudou de lugar. As quebras de
// Pendentes (Pix/cartão) e Recuperadas (carrinho/Pix) já vinham calculadas e
// agora aparecem como uma linha de apoio.
export default function DashboardView({ data }: { data: DashboardData }) {
  const { paid, approval: ap, devices: dev, pending, abandoned, recovered } = data;
  const base = data.funnel[0]?.value ?? 0;
  const bought = data.funnel[data.funnel.length - 1]?.value ?? 0;
  const conversion = base > 0 ? (bought / base) * 100 : null;
  const pixRate = ap.pixTotal > 0 ? ap.pixPaid / ap.pixTotal : null;
  const cardRate = ap.cardDecided > 0 ? ap.cardApproved / ap.cardDecided : null;
  // Ticket por dispositivo: sai dos mesmos totais da divisão, sem consulta nova.
  const ticketMobile = dev.mobileCount > 0 ? Math.round(dev.mobileCents / dev.mobileCount) : null;
  const ticketDesktop = dev.desktopCount > 0 ? Math.round(dev.desktopCents / dev.desktopCount) : null;

  const pix = { label: "Pix", cents: paid.pixCents, count: paid.pixCount, color: "var(--viz-pix)", icon: <IconePix size={15} style={{ color: "var(--viz-pix)" }} /> };
  const card = { label: "Cartão", cents: paid.cardCents, count: paid.cardCount, color: "var(--viz-card)", icon: <IconeCartao size={15} style={{ color: "var(--viz-card)" }} /> };
  const mobile = { label: "Mobile", cents: dev.mobileCents, count: dev.mobileCount, color: "var(--viz-device)" };
  const desktop = { label: "Desktop", cents: dev.desktopCents, count: dev.desktopCount, color: "color-mix(in oklab, var(--viz-device) 40%, transparent)" };

  // Gráficos: mesmos baldes de tempo para todas as seções.
  const sb = data.series;
  const chart = { labels: sb.labels, nowIndex: sb.nowIndex, currentLabel: sb.currentLabel };
  const serie = (key: string, label: string, color: string, unit: "brl" | "int"): TrendSeries => ({
    key,
    label,
    color,
    unit,
    values: sb.cur[key] ?? [],
  });

  const payRows: SplitRow[] = [
    {
      ...pix,
      metric: pixRate === null ? "—" : <AnimatedNumber value={pixRate * 100} format="pct" />,
      metricRate: pixRate,
      metricNote: ap.pixTotal > 0 ? `${ap.pixPaid} de ${ap.pixTotal} pagos` : "sem Pix",
      metricHint: "Pix pagos ÷ Pix gerados no período",
    },
    {
      ...card,
      metric: cardRate === null ? "—" : <AnimatedNumber value={cardRate * 100} format="pct" />,
      metricRate: cardRate,
      metricNote: ap.cardDecided > 0 ? `${ap.cardApproved} de ${ap.cardDecided} aprovados` : "sem cartão",
      metricHint: "Aprovados ÷ decididos (aprovados + recusados). Cartão em análise não entra.",
    },
  ];
  const devRows: SplitRow[] = [
    { ...mobile, metric: ticketMobile === null ? "—" : <AnimatedNumber value={ticketMobile} format="brl" /> },
    { ...desktop, color: "#5b7c99", metric: ticketDesktop === null ? "—" : <AnimatedNumber value={ticketDesktop} format="brl" /> },
  ];

  return (
    <PeriodTransition>
      <div className="animate-fade-up space-y-6">
        <ReconcileOnMount />

        <header className="pb-1">
          <h1 className="text-[26px] font-semibold tracking-tight text-hi">Dashboard</h1>
          <p className="mt-1 truncate text-[13px] text-low">
            <span className="font-medium text-mid">{data.storeName}</span>
            <span aria-hidden className="mx-1.5 text-dim">·</span>
            {data.period.label}
          </p>
        </header>

        {/* ── Agora ── */}
        <LiveVisitors variant="strip" />

        {/* ── Filtro de período: governa todas as caixas abaixo ── */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[22px] bg-card px-5 py-3.5 ring-1 ring-line">
          <p className="flex items-center gap-2 text-[13px] text-low">
            <Icon name="calendar" />
            Período
            <span className="rounded-full bg-soft px-2.5 py-0.5 text-[12px] font-medium text-hi ring-1 ring-line">{data.period.label}</span>
          </p>
          <PeriodControl active={data.period.key} from={data.period.from} to={data.period.to} />
        </div>

        {/* ── Conversão: a taxa ao lado do funil que a explica ── */}
        <Box icon="funnel" title="Conversão">
          <PendingArea>
            <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500/20 via-emerald-500/[0.07] to-transparent p-5 ring-1 ring-emerald-500/35 sm:p-6">
                <span className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300" title="Quem comprou ÷ quem chegou ao checkout no período">
                  Taxa de conversão
                </span>
                <div className="flex flex-1 flex-col justify-center py-5">
                  <div className="whitespace-nowrap text-[64px] font-semibold leading-none tracking-[-0.04em] text-hi">
                    {conversion === null ? "—" : <AnimatedNumber value={conversion} format="pct" />}
                  </div>
                  <p className="mt-3 text-[13.5px] text-mid">{base > 0 ? `${bought} de ${base} no checkout` : "Nenhum checkout"}</p>
                  {conversion !== null && (
                    <span aria-hidden className="relative mt-4 block h-1.5 overflow-hidden rounded-full bg-emerald-900/10 dark:bg-white/10">
                      <span className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${Math.min(100, conversion)}%` }} />
                    </span>
                  )}
                </div>
                <p className="border-t border-emerald-500/20 pt-4 text-[11.5px] leading-snug text-low">
                  Quem comprou ÷ quem chegou ao checkout no período
                </p>
              </div>
              <div className="min-w-0 rounded-2xl bg-soft p-4 ring-1 ring-line sm:p-5">
                <h3 className="text-[14px] font-semibold text-hi">Funil do checkout</h3>
                <p className="mt-0.5 text-[12.5px] text-low">Até onde foi quem chegou ao checkout</p>
                <div className="mt-6">
                  <Funnel stages={data.funnel} />
                  {base === 0 && <p className="mt-4 text-[12.5px] text-low">Nenhum checkout iniciado no período.</p>}
                </div>
              </div>
            </div>
          </PendingArea>
        </Box>

        {/* ── Resultado ── */}
        <Box icon="cash" title="Resultado" link={{ href: "/painel/vendas", label: "Ver vendas" }}>
          <PendingArea>
            <MetricPanel
              {...chart}
              chartTitle="Vendas × Pedidos × Ticket médio"
              gridClassName="grid grid-cols-2 gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]"
              series={[
                serie("paid", "Vendas pagas", "var(--viz-accent)", "brl"),
                { ...serie("orders", "Pedidos", "var(--viz-device)", "int"), bars: true },
                { ...serie("ticket", "Ticket médio", "var(--viz-card)", "brl"), dashed: true },
              ]}
              items={[
                {
                  key: "paid",
                  label: "Vendas pagas",
                  className: "col-span-2 md:col-span-1",
                  node: (
                    <Kpi
                      big
                      label="Vendas pagas"
                      value={<AnimatedNumber value={paid.cents} format="brl" display />}
                      note={`${paid.count} ${plural(paid.count, "pedido pago", "pedidos pagos")}`}
                    />
                  ),
                },
                {
                  key: "orders",
                  label: "Pedidos",
                  node: (
                    <Kpi
                      label="Pedidos"
                      value={<AnimatedNumber value={data.orders.total} />}
                      note={`${data.orders.pending} ${plural(data.orders.pending, "pendente", "pendentes")}`}
                    />
                  ),
                },
                {
                  key: "ticket",
                  label: "Ticket médio",
                  node: (
                    <Kpi
                      label="Ticket médio"
                      value={<AnimatedNumber value={data.ticketCents} format="brl" display />}
                      note="por venda paga"
                    />
                  ),
                },
              ]}
            />
          </PendingArea>
        </Box>

        {/* ── Recuperação: dinheiro parado e o que voltou ── */}
        <Box icon="refresh" title="Recuperação" link={{ href: "/painel/carrinhos", label: "Ver carrinhos" }}>
          <PendingArea>
            <h3 className="sr-only">Recuperação de vendas</h3>
            <MetricPanel
              {...chart}
              chartTitle="Pendentes × Carrinhos abandonados × Recuperadas"
              gridClassName="grid gap-4 md:grid-cols-3"
              series={[
                serie("pending", "Pendentes", "#f5b031", "brl"),
                serie("abandoned", "Carrinhos abandonados", "#f47185", "brl"),
                serie("recovered", "Recuperadas", "#10b981", "brl"),
              ]}
              items={[
                {
                  key: "pending",
                  label: "Pendentes",
                  marker: false,
                  node: (
                    <Recovery
                      title="Pendentes"
                      tone="warn"
                      cents={pending.cents}
                      note={`${pending.count} ${plural(pending.count, "pedido aguardando", "pedidos aguardando")}`}
                      detail={pending.count > 0 ? `Pix ${brl(pending.pixCents)} · Cartão ${brl(pending.cardCents)}` : undefined}
                    />
                  ),
                },
                {
                  key: "abandoned",
                  label: "Carrinhos abandonados",
                  marker: false,
                  node: (
                    <Recovery
                      title="Carrinhos abandonados"
                      tone="lost"
                      cents={abandoned.cents}
                      note={`${abandoned.count} ${plural(abandoned.count, "carrinho", "carrinhos")}`}
                    />
                  ),
                },
                {
                  key: "recovered",
                  label: "Recuperadas",
                  marker: false,
                  node: (
                    <Recovery
                      title="Recuperadas"
                      tone="ok"
                      cents={recovered.cents}
                      note={`${recovered.count} ${plural(recovered.count, "venda voltou", "vendas voltaram")}`}
                      detail={recovered.count > 0 ? `De carrinho ${brl(recovered.cartCents)} · De Pix ${brl(recovered.pixCents)}` : undefined}
                    />
                  ),
                },
              ]}
            />
          </PendingArea>
        </Box>

        {/* ── Como compram: meio de pagamento e aparelho ── */}
        <Box icon="device" title="Como compram">
          <PendingArea>
            <div className="grid gap-4 xl:grid-cols-2">
              <Card title="Formas de pagamento">
                <SplitHeader rows={payRows} empty="Nenhuma venda paga no período." />
                <div className="mt-5">
                  <MetricPanel
                    {...chart}
                    chartTitle="Pix × Cartão"
                    compact
                    gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    series={[serie("pix", "Pix", "var(--viz-pix)", "brl"), serie("card", "Cartão", "var(--viz-card)", "brl")]}
                    items={payRows.map((r, i) => ({
                      key: i === 0 ? "pix" : "card",
                      label: r.label,
                      marker: false,
                      node: <SplitTile row={r} total={paid.pixCents + paid.cardCents} metricLabel="Aprovação" />,
                    }))}
                  />
                </div>
              </Card>

              {/* Tablet entra em Mobile, e pedidos anteriores ao registro de
                  dispositivo ficam de fora — mesma regra da tela cheia. */}
              <Card title="Dispositivos" link={{ href: "/painel/dispositivos", label: "Detalhes" }}>
                <SplitHeader rows={devRows} empty="Nenhuma venda paga no período." />
                <div className="mt-5">
                  <MetricPanel
                    {...chart}
                    chartTitle="Mobile × Desktop"
                    compact
                    gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    series={[serie("mobile", "Mobile", "var(--viz-device)", "brl"), serie("desktop", "Desktop", "#5b7c99", "brl")]}
                    items={devRows.map((r, i) => ({
                      key: i === 0 ? "mobile" : "desktop",
                      label: r.label,
                      marker: false,
                      node: <SplitTile row={r} total={dev.mobileCents + dev.desktopCents} metricLabel="Ticket médio" />,
                    }))}
                  />
                </div>
              </Card>
            </div>
          </PendingArea>
        </Box>

        {/* ── Últimos pedidos ── */}
        <Box icon="list" title="Pedidos recentes" link={{ href: "/painel/vendas", label: "Ver todas" }}>
          <PendingArea>
            <div className="rounded-2xl bg-soft px-1.5 py-1 ring-1 ring-line sm:px-3">
              <RecentOrders orders={data.recent} bare />
            </div>
          </PendingArea>
        </Box>
      </div>
    </PeriodTransition>
  );
}

const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (cents: number) => brlFmt.format(cents / 100);

const ICONS: Record<string, React.ReactNode> = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  cash: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>,
  funnel: <path d="M4 4h16l-6 8v6l-4 2v-8z" />,
  refresh: <><path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.5" /><path d="M4 4v4.5h4.5" /><path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.5" /><path d="M20 20v-4.5h-4.5" /></>,
  device: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

/** Caixa de seção: um bloco por assunto, com cabeçalho próprio e os cartões dentro. */
function Box({
  icon,
  title,
  question,
  link,
  children,
}: {
  icon: string;
  title: string;
  question?: string;
  link?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[28px] bg-card p-3.5 ring-1 ring-line sm:p-6 lg:p-7">
      <div className="mb-5 flex items-center justify-between gap-4 px-1.5 pt-1.5 sm:mb-6 sm:px-0 sm:pt-0">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-soft text-mid ring-1 ring-line">
            <Icon name={icon} size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight text-hi">{title}</h2>
            {question && <p className="mt-0.5 text-[12.5px] leading-snug text-low">{question}</p>}
          </div>
        </div>
        {link && (
          <Link
            href={link.href}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-soft px-3.5 py-2 text-[12.5px] font-medium text-mid ring-1 ring-line transition-colors hover:text-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {link.label}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Cartão padrão da grade: mesmo respiro, mesmo cabeçalho em todos. */
function Card({
  title,
  subtitle,
  link,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl bg-soft p-4 ring-1 ring-line sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-hi">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[12.5px] text-low">{subtitle}</p>}
        </div>
        {link && <TextLink href={link.href}>{link.label}</TextLink>}
      </div>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/** Indicador da fileira do topo. Com `href`, o cartão inteiro leva à lista. */
function Kpi({
  label,
  value,
  note,
  href,
  hint,
  big = false,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  href?: string;
  hint?: string;
  big?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-low" title={hint}>
          {label}
        </span>
        {href && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-dim transition duration-150 ease-fluid group-hover:translate-x-0.5 group-hover:text-mid">
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </div>
      <div className={`mt-3 whitespace-nowrap font-semibold leading-none tracking-[-0.025em] text-hi ${big ? "text-[28px] xl:text-[32px]" : "text-[22px] xl:text-[26px]"}`}>
        {value}
      </div>
      <div className="mt-2.5 truncate text-[12.5px] text-low">{note}</div>
    </>
  );
  const cls = `group block h-full min-w-0 rounded-2xl bg-soft p-4 ring-1 ring-line sm:p-5 ${className}`;
  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} transition-colors duration-150 hover:ring-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
      >
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

/** Coluna da recuperação: rótulo, valor, uma linha de contexto e o link. Só isso. */
function Recovery({
  title,
  cents,
  note,
  detail,
  tone = "ok",
  link,
}: {
  tone?: "warn" | "lost" | "ok";
  title: string;
  cents: number;
  note: string;
  detail?: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-2xl bg-soft p-4 ring-1 ring-line sm:p-5">
      <h3 className="flex items-center gap-2 text-[13px] font-medium text-low">
        <span aria-hidden className={`h-2 w-2 rounded-full ${tone === "warn" ? "bg-amber-400" : tone === "lost" ? "bg-rose-400" : "bg-emerald-500"}`} />
        {title}
      </h3>
      <p className="mt-3 whitespace-nowrap text-[26px] font-semibold leading-none tracking-[-0.025em] text-hi">
        <AnimatedNumber value={cents} format="brl" display />
      </p>
      <p className="mt-2 text-[12.5px] text-low">{note}</p>
      {detail && <p className="mt-1 text-[12px] tabular-nums text-dim">{detail}</p>}
      {link && (
        <div className="mt-auto pt-4">
          <TextLink href={link.href}>{link.label}</TextLink>
        </div>
      )}
    </div>
  );
}