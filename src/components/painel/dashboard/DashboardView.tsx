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

// Dashboard do lojista em SEÇÕES, na ordem das perguntas de quem abre o painel:
//
//   Agora         Visitantes ao vivo (faixa; não segue o filtro de período)
//   ── filtro de período: vale daqui para baixo ──
//   Resultado     Vendas pagas (destaque) · Pedidos · Ticket médio
//   Conversão     Taxa de conversão ao lado do funil que a explica
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

  return (
    <PeriodTransition>
      <div className="animate-fade-up">
        <ReconcileOnMount />

        <header className="pb-5">
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dashboard</h1>
          <p className="mt-1 truncate text-[13px] text-low">
            <span className="font-medium text-mid">{data.storeName}</span>
            <span aria-hidden className="mx-1.5 text-dim">·</span>
            {data.period.label}
          </p>
        </header>

        {/* ── Agora ── */}
        <LiveVisitors variant="strip" />

        {/* ── Filtro de período: governa todas as seções abaixo ── */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-6">
          <p className="text-[12.5px] text-low">
            Período das seções abaixo: <span className="font-medium text-mid">{data.period.label}</span>
          </p>
          <PeriodControl active={data.period.key} from={data.period.from} to={data.period.to} />
        </div>

        {/* ── Resultado ── */}
        <Section title="Resultado" question="Quanto vendi">
          <PendingArea>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <Kpi
                big
                className="col-span-2 md:col-span-1"
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
            </div>
          </PendingArea>
        </Section>

        {/* ── Conversão: a taxa ao lado do funil que a explica ── */}
        <Section title="Conversão" question="Onde perco clientes">
          <PendingArea>
            <section className="grid min-w-0 gap-6 rounded-2xl bg-card p-5 lg:grid-cols-[200px_minmax(0,1fr)]">
              <div className="min-w-0 lg:border-r lg:border-line lg:pr-6">
                <span className="text-[13px] font-medium text-low" title="Quem comprou ÷ quem chegou ao checkout no período">
                  Taxa de conversão
                </span>
                <div className="mt-3 whitespace-nowrap text-[30px] font-semibold leading-none tracking-[-0.025em] text-hi">
                  {conversion === null ? "—" : <AnimatedNumber value={conversion} format="pct" />}
                </div>
                <p className="mt-2.5 text-[12.5px] text-low">{base > 0 ? `de ${base} no checkout` : "Nenhum checkout"}</p>
                <p className="mt-3 text-[11.5px] leading-snug text-dim">Quem comprou ÷ quem chegou ao checkout no período</p>
              </div>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold text-hi">Funil do checkout</h2>
                <p className="mt-0.5 text-[12.5px] text-low">Até onde foi quem chegou ao checkout</p>
                <div className="mt-5">
                  <Funnel stages={data.funnel} />
                  {base === 0 && <p className="mt-4 text-[12.5px] text-low">Nenhum checkout iniciado no período.</p>}
                </div>
              </div>
            </section>
          </PendingArea>
        </Section>

        {/* ── Recuperação: dinheiro parado e o que voltou ── */}
        <Section title="Recuperação" question="O que ainda dá para salvar">
          <PendingArea>
            <section className="rounded-2xl bg-card p-5">
              <h2 className="sr-only">Recuperação de vendas</h2>
              <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
                <Recovery
                  title="Pendentes"
                  cents={pending.cents}
                  note={`${pending.count} ${plural(pending.count, "pedido aguardando", "pedidos aguardando")}`}
                  detail={pending.count > 0 ? `Pix ${brl(pending.pixCents)} · Cartão ${brl(pending.cardCents)}` : undefined}
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
                  detail={recovered.count > 0 ? `De carrinho ${brl(recovered.cartCents)} · De Pix ${brl(recovered.pixCents)}` : undefined}
                />
              </div>
            </section>
          </PendingArea>
        </Section>

        {/* ── Como compram: meio de pagamento e aparelho ── */}
        <Section title="Como compram" question="Meio de pagamento e aparelho">
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
        </Section>

        {/* ── Últimos pedidos ── */}
        <Section title="Pedidos recentes" question="Os últimos do período">
          <PendingArea>
            <RecentOrders orders={data.recent} />
          </PendingArea>
        </Section>
      </div>
    </PeriodTransition>
  );
}

const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brl = (cents: number) => brlFmt.format(cents / 100);

/** Cabeçalho de seção: nome + a pergunta que ela responde. */
function Section({ title, question, children }: { title: string; question: string; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-mid">{title}</h2>
        <span className="text-[12px] text-dim">· {question}</span>
      </div>
      {children}
    </div>
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
  const cls = `group block min-w-0 rounded-2xl bg-card p-5 ${className}`;
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
  detail,
  link,
}: {
  title: string;
  cents: number;
  note: string;
  detail?: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <h3 className="text-[13px] font-medium text-low">{title}</h3>
      <p className="mt-2 whitespace-nowrap text-[24px] font-semibold leading-none tracking-[-0.025em] text-hi">
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