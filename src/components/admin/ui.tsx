import type { Range } from "@/lib/admin";
import RangePicker from "./RangePicker";

// Peças compartilhadas das telas do admin da plataforma. Valores animados
// podem ser passados como filhos sem transformar os cards em client components.

export function brl(cents: number) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function brlShort(cents: number) {
  const v = Number(cents) / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return `R$ ${Math.round(v)}`;
}
export function pct(v: number | null, digits = 1) {
  return v === null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
export function fmtDateTime(d: Date | string) {
  return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export const RANGE_LABELS: Record<Range, string> = {
  today: "Hoje",
  "7": "Últimos 7 dias",
  "30": "Últimos 30 dias",
  all: "Todo o período",
};

/** Cabeçalho de página: título, subtítulo e seletor de período. */
export function PageHeader({
  title,
  subtitle,
  range,
  baseHref,
  params = {},
  right,
}: {
  title: string;
  subtitle?: string;
  range?: Range;
  baseHref?: string;
  params?: Record<string, string>;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-hi">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-low">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {range && baseHref && <RangePicker range={range} baseHref={baseHref} params={params} />}
        {right}
      </div>
    </div>
  );
}

/** Card de métrica com variação vs. período anterior. */
export function MetricCard({
  label,
  value,
  delta,
  deltaSuffix = "%",
  note,
  action,
}: {
  label: string;
  value: React.ReactNode;
  /** Variação vs. período anterior. null = sem base de comparação. */
  delta?: number | null;
  deltaSuffix?: string;
  /** Linha de apoio. Aparece também junto da variação, quando há as duas. */
  note?: string;
  /** Link curto no canto do título (ex.: "Cobrar"). */
  action?: React.ReactNode;
}) {
  const up = typeof delta === "number" && delta > 0;
  const down = typeof delta === "number" && delta < 0;
  const currency = typeof value === "string" ? /^(R\$)\s*(.+?)(,\d{2})$/.exec(value) : null;
  return (
    <div className="flex min-w-0 flex-col rounded-2xl bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-low">{label}</span>
        {action}
      </div>
      <div className="mt-3 break-words text-[26px] font-semibold tracking-tight text-hi tabular-nums">
        {currency ? <><span className="mr-1.5 text-base font-medium text-low">{currency[1]}</span>{currency[2]}<span className="text-lg text-low">{currency[3]}</span></> : value}
      </div>
      {typeof delta === "number" ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span className={`font-medium tabular-nums ${up ? "text-emerald-700 dark:text-emerald-400" : down ? "text-red-600 dark:text-red-400" : "text-low"}`}>
            {up ? "+" : down ? "−" : ""}{Math.abs(delta).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}{deltaSuffix}
          </span>
          <span className="text-low">vs. período anterior</span>
        </div>
      ) : null}
      {note && <p className={`${typeof delta === "number" ? "mt-1" : "mt-2"} text-xs leading-relaxed text-low`}>{note}</p>}
    </div>
  );
}

/** Cartão que embrulha uma tabela/lista, com título e ação opcional. */
export function Panel({
  title,
  action,
  children,
  padded = false,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-card">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
        <h2 className="text-sm font-semibold text-hi">{title}</h2>
        {action}
      </div>
      <div className={padded ? "px-5 pb-5 pt-3" : ""}>{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-14 text-center text-sm text-low">{children}</div>;
}

/** Etiqueta de status de pedido, no vocabulário do admin. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PAID: { label: "Aprovada", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" },
    SHIPPED: { label: "Enviada", cls: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20" },
    PENDING: { label: "Pendente", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20" },
    CANCELLED: { label: "Recusada", cls: "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20" },
  };
  const s = map[status] ?? { label: status, cls: "bg-soft text-mid ring-line" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${s.cls}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

/** Situação da loja, no mesmo formato de pílula do status de pedido. */
export function StoreStatus({ suspended }: { suspended: boolean | number | null }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${suspended ? "bg-red-500/10 text-red-600 dark:text-red-400 ring-red-500/20" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20"}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {suspended ? "Suspensa" : "Ativa"}
    </span>
  );
}

export const METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão",
  BOLETO: "Boleto",
};

/** Iniciais para o avatar da loja/cliente. */
export function initials(s: string) {
  const p = (s || "").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
