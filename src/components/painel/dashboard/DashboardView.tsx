import React from "react";
import Link from "next/link";
import AnimatedNumber from "./AnimatedNumber";
import { PeriodTransition, PendingArea } from "./PeriodTransition";
import PeriodControl from "./PeriodControl";
import { Breakdown, Funnel, TextLink, type FunnelStage } from "./Viz";
import RecentOrders, { type RecentOrder } from "./RecentOrders";
import LiveVisitors from "@/components/painel/LiveVisitors";
import ReconcileOnMount from "@/components/painel/ReconcileOnMount";
import { IconeCartao, IconePix } from "@/components/painel/MetodoIcon";

export type DashboardData = {
  storeName: string;
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

// Dashboard do lojista em GRADE, no padrão das plataformas grandes (Shopify,
// Yampi, CartPanda): os indicadores principais numa fileira no topo e, abaixo,
// cartões do mesmo desenho, alinhados em fileiras de altura igual.
//
//   1. Vendas pagas · Pedidos · Ticket médio · Taxa de conversão
//   2. Visitantes ao vivo  |  Funil do checkout
//   3. Formas de pagamento |  Dispositivos      (mesmo desenho, lado a lado)
//   4. Recuperação de vendas (pendentes, abandonados, recuperadas)
//   5. Pedidos recentes
//
// A grade foi medida na largura real do painel: notebook com a barra lateral
// aberta (~1050px de tela, ~730px de conteúdo) — é a largura que o lojista usa.
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

  return (
    <PeriodTransition>
      <div className="animate-fade-up space-y-4">
        <ReconcileOnMount />

        <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-2">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dashboard</h1>
            <p className="mt-1 truncate text-[13px] text-low">
              <span className="font-medium text-mid">{data.storeName}</span>
              <span aria-hidden className="mx-1.5 text-dim">·</span>
              {data.period.label}
            </p>
          </div>
          <PeriodControl active={data.period.key} from={data.period.from} to={data.period.to} />
        </header>

        {/* ── 1. Indicadores ── */}
        <PendingArea>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi
              label="Vendas pagas"
              value={<AnimatedNumber value={paid.cents} format="brl" display />}
              note={`${paid.count} ${plural(paid.count, "pedido pago", "pedidos pagos")}`}
            />
            <Kpi
              label="Pedidos"
              href="/painel/vendas"
              value={<AnimatedNumber value={data.orders.total} />}
              note={`${data.orders.pending} ${plural(data.orders.pending, "pendente", "pendentes")}`}
            />
            <Kpi
              label="Ticket médio"
              value={<AnimatedNumber value={data.ticketCents} format="brl" display />}
              note="por venda paga"
            />
            <Kpi
              label="Taxa de conversão"
              hint="Quem comprou ÷ quem chegou ao checkout no período"
              value={conversion === null ? "—" : <AnimatedNumber value={conversion} format="pct" />}
              note={base > 0 ? `de ${base} no checkout` : "Nenhum checkout"}
            />
          </div>
        </PendingArea>

        {/* ── 2. Agora e o funil do período ── */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <LiveVisitors />
          <PendingArea className="min-w-0">
            <Card title="Funil do checkout" subtitle="Até onde foi quem chegou ao checkout" className="h-full">
              <Funnel stages={data.funnel} />
              {base === 0 && <p className="mt-4 text-[12.5px] text-low">Nenhum checkout iniciado no período.</p>}
            </Card>
          </PendingArea>
        </div>

        {/* Tabela em linhas: cada método/dispositivo numa linha, colunas
            alinhadas. Até 1280px os dois cartões ocupam a largura toda. */}
        <PendingArea>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Formas de pagamento">
              <Breakdown
                firstLabel="Método"
                lastLabel="Aprovação"
                rows={[
                  {
                    ...pix,
                    last: pixRate === null ? "—" : <AnimatedNumber value={pixRate * 100} format="pct" />,
                    lastNote: ap.pixTotal > 0 ? `${ap.pixPaid} de ${ap.pixTotal} pagos` : "sem Pix",
                    lastHint: "Pix pagos ÷ Pix gerados no período",
                  },
                  {
                    ...card,
                    last: cardRate === null ? "—" : <AnimatedNumber value={cardRate * 100} format="pct" />,
                    lastNote: ap.cardDecided > 0 ? `${ap.cardApproved} de ${ap.cardDecided} aprovados` : "sem cartão",
                    lastHint: "Aprovados ÷ decididos (aprovados + recusados). Cartão em análise não entra.",
                  },
                ]}
              />
            </Card>

            {/* Tablet entra em Mobile, e pedidos anteriores ao registro de
                dispositivo ficam de fora — mesma regra da tela cheia. */}
            <Card title="Dispositivos" link={{ href: "/painel/dispositivos", label: "Detalhes" }}>
              <Breakdown
                firstLabel="Dispositivo"
                lastLabel="Ticket médio"
                rows={[
                  { ...mobile, last: ticketMobile === null ? "—" : <AnimatedNumber value={ticketMobile} format="brl" /> },
                  { ...desktop, last: ticketDesktop === null ? "—" : <AnimatedNumber value={ticketDesktop} format="brl" /> },
                ]}
              />
            </Card>
          </div>
        </PendingArea>

        {/* ── 4. Dinheiro parado e o que voltou ── */}
        <PendingArea>
          <Card title="Recuperação de vendas">
            <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
              <Recovery
                title="Pendentes"
                cents={pending.cents}
                note={`${pending.count} ${plural(pending.count, "pedido aguardando", "pedidos aguardando")}`}
              />
              <Recovery
                title="Carrinhos abandonados"
                cents={abandoned.cents}
                note={`${abandoned.count} ${plural(abandoned.count, "carrinho", "carrinhos")}`}
              />
              <Recovery
                title="Recuperadas"
                cents={recovered.cents}
                note={`${recovered.count} ${plural(recovered.count, "venda voltou", "vendas voltaram")}`}
              />
            </div>
          </Card>
        </PendingArea>

        {/* ── 5. Últimos pedidos ── */}
        <PendingArea>
          <RecentOrders orders={data.recent} />
        </PendingArea>
      </div>
    </PeriodTransition>
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
    <section className={`flex min-w-0 flex-col rounded-2xl bg-card p-5 ${className}`}>
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
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  href?: string;
  hint?: string;
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
      <div className="mt-3 whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.025em] text-hi xl:text-[26px]">
        {value}
      </div>
      <div className="mt-2.5 truncate text-[12.5px] text-low">{note}</div>
    </>
  );
  const cls = "group block min-w-0 rounded-2xl bg-card p-5";
  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} transition-colors duration-150 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40`}
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
  link,
}: {
  title: string;
  cents: number;
  note: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <h3 className="text-[13px] font-medium text-low">{title}</h3>
      <p className="mt-2 whitespace-nowrap text-[24px] font-semibold leading-none tracking-[-0.025em] text-hi">
        <AnimatedNumber value={cents} format="brl" display />
      </p>
      <p className="mt-2 text-[12.5px] text-low">{note}</p>
      {link && (
        <div className="mt-auto pt-4">
          <TextLink href={link.href}>{link.label}</TextLink>
        </div>
      )}
    </div>
  );
}