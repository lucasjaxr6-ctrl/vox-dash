import Link from "next/link";
import { getTransactions, getStoresWithStats, getUsedGateways, parseRange } from "@/lib/admin";
import Pagination from "@/components/painel/Pagination";
import FilterLink from "@/components/admin/FilterLink";
import { PendingArea } from "@/components/painel/dashboard/PeriodTransition";
import {
  PageHeader,
  Panel,
  EmptyState,
  StatusBadge,
  brl,
  fmtDateTime,
  METHOD_LABEL,
} from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const STATUS_TABS = [
  { key: "", label: "Todas" },
  { key: "PAID", label: "Aprovadas" },
  { key: "PENDING", label: "Pendentes" },
  { key: "CANCELLED", label: "Recusadas" },
  { key: "SHIPPED", label: "Enviadas" },
];

type SP = {
  range?: string;
  status?: string;
  storeId?: string;
  method?: string;
  gateway?: string;
  email?: string;
  page?: string;
};

export default async function Transacoes({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const status = STATUS_TABS.some((t) => t.key === sp.status) ? (sp.status ?? "") : "";
  const email = (sp.email ?? "").trim().slice(0, 120);
  const storeId = (sp.storeId ?? "").trim();
  const method = (sp.method ?? "").trim();
  const gateway = (sp.gateway ?? "").trim();
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const [stores, gateways] = await Promise.all([getStoresWithStats("all"), getUsedGateways()]);
  const { rows, total } = await getTransactions({
    range,
    status,
    storeId,
    method,
    gateway,
    email,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Parâmetros preservados nos links (abas, paginação e período).
  const keep: Record<string, string> = {};
  if (range !== "all") keep.range = range;
  if (storeId) keep.storeId = storeId;
  if (method) keep.method = method;
  if (gateway) keep.gateway = gateway;
  if (email) keep.email = email;

  const tabHref = (key: string) => {
    const q = new URLSearchParams(keep);
    if (key) q.set("status", key);
    const s = q.toString();
    return s ? `/admin/transacoes?${s}` : "/admin/transacoes";
  };

  const sum = rows.reduce((s, r) => s + (r.status === "PAID" || r.status === "SHIPPED" ? r.totalCents : 0), 0);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Transações"
        subtitle="Todos os pedidos da plataforma, de todas as lojas."
        range={range}
        baseHref="/admin/transacoes"
        params={{ ...(status ? { status } : {}), ...keep }}
      />

      {/* Abas de status */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_TABS.map((t) => (
          <FilterLink
            key={t.key || "all"}
            href={tabHref(t.key)}
            aria-current={status === t.key ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
              status === t.key ? "bg-brand text-white" : "bg-card text-mid ring-1 ring-line hover:bg-hover hover:text-hi"
            }`}
          >
            {t.label}
          </FilterLink>
        ))}
      </div>

      <PendingArea className="space-y-4">

      {/* Filtros: form GET puro, tudo na URL (recarregar e compartilhar funciona) */}
      <form method="get" action="/admin/transacoes" className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3">
        {range !== "all" && <input type="hidden" name="range" value={range} />}
        {status && <input type="hidden" name="status" value={status} />}
        <input
          type="search"
          name="email"
          defaultValue={email}
          placeholder="E-mail do cliente"
          maxLength={120}
          autoComplete="off"
          className="min-w-[190px] flex-1 rounded-lg border border-line px-3 py-2 text-[13px] outline-none placeholder:text-low focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <select name="storeId" defaultValue={storeId} className="rounded-lg border border-line px-3 py-2 text-[13px] text-mid outline-none focus:border-brand">
          <option value="">Todas as lojas</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select name="method" defaultValue={method} className="rounded-lg border border-line px-3 py-2 text-[13px] text-mid outline-none focus:border-brand">
          <option value="">Todo método</option>
          {Object.entries(METHOD_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select name="gateway" defaultValue={gateway} className="rounded-lg border border-line px-3 py-2 text-[13px] text-mid outline-none focus:border-brand">
          <option value="">Todo gateway</option>
          {gateways.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white transition hover:bg-brand-hover">
          Filtrar
        </button>
        {(email || storeId || method || gateway) && (
          <FilterLink href={status ? `/admin/transacoes?status=${status}` : "/admin/transacoes"} className="px-2 text-[13px] font-semibold text-low transition-colors hover:text-hi">
            Limpar
          </FilterLink>
        )}
      </form>

      <Panel
        title={`${total.toLocaleString("pt-BR")} ${total === 1 ? "transação" : "transações"}`}
        action={<span className="text-xs text-low">Aprovado nesta página: <b className="text-mid">{brl(sum)}</b></span>}
      >
        {rows.length === 0 ? (
          <EmptyState>Nenhuma transação com esses filtros.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Loja</th>
                  <th className="px-3 py-2.5">Método</th>
                  <th className="px-3 py-2.5">Gateway</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Valor</th>
                  <th className="px-3 py-2.5 text-right">Data</th>
                  <th className="w-12 px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id} className="transition hover:bg-hover">
                    <td className="max-w-[240px] px-5 py-3">
                      <div className="truncate font-medium text-hi">{r.customerName || "Visitante"}</div>
                      <div className="truncate text-xs text-low">{r.customerEmail || "—"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/loja/${r.storeId}`} className="text-mid hover:text-brand hover:underline">
                        {r.storeName || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-mid">{r.paymentMethod ? METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod : "—"}</td>
                    <td className="px-3 py-3 text-xs text-low">{r.paymentGateway || "—"}</td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(r.totalCents)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-low">{fmtDateTime(r.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/admin/transacoes/${r.id}`}
                        title="Ver transação"
                        aria-label="Ver transação"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-low transition hover:bg-hover hover:text-mid"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Pagination
        page={Math.min(page, totalPages)}
        totalPages={totalPages}
        baseHref="/admin/transacoes"
        params={{ ...(status ? { status } : {}), ...keep }}
      />
      </PendingArea>
    </div>
  );
}
