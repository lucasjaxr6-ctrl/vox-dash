import Link from "next/link";
import { getCustomers, parseRange } from "@/lib/admin";
import Pagination from "@/components/painel/Pagination";
import FilterLink from "@/components/admin/FilterLink";
import { PendingArea } from "@/components/painel/dashboard/PeriodTransition";
import { PageHeader, Panel, EmptyState, brl, fmtDate, initials } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function fmtPhone(p: string | null) {
  const d = (p || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p || "—";
}

export default async function Clientes({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; email?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.range);
  const email = (sp.email ?? "").trim().slice(0, 120);
  const page = Math.max(1, parseInt(sp.page || "1", 10) || 1);

  const { rows, total } = await getCustomers({ range, email, page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const keep: Record<string, string> = {};
  if (range !== "all") keep.range = range;
  if (email) keep.email = email;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Clientes"
        subtitle="Compradores da plataforma, agrupados por e-mail."
        range={range}
        baseHref="/admin/clientes"
        params={email ? { email } : {}}
      />

      <form method="get" action="/admin/clientes" className="flex flex-wrap items-center gap-2">
        {range !== "all" && <input type="hidden" name="range" value={range} />}
        <input
          type="search"
          name="email"
          defaultValue={email}
          placeholder="Buscar por e-mail"
          maxLength={120}
          autoComplete="off"
          className="w-full sm:w-72 rounded-lg border border-line bg-card px-3 py-2 text-[13px] outline-none placeholder:text-low focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white transition hover:bg-brand-hover">
          Buscar
        </button>
        {email && (
          <FilterLink href="/admin/clientes" className="px-2 text-[13px] font-semibold text-low transition-colors hover:text-hi">
            Limpar
          </FilterLink>
        )}
      </form>

      <PendingArea className="space-y-4">
      <Panel title={`${total.toLocaleString("pt-BR")} ${total === 1 ? "cliente" : "clientes"}`}>
        {rows.length === 0 ? (
          <EmptyState>{email ? "Nenhum cliente com esse e-mail." : "Nenhum cliente no período."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Telefone</th>
                  <th className="px-3 py-2.5 text-right">Gasto</th>
                  <th className="px-3 py-2.5 text-right">Pedidos</th>
                  <th className="px-3 py-2.5 text-right">Lojas</th>
                  <th className="px-3 py-2.5 text-right">1ª compra</th>
                  <th className="px-5 py-2.5 text-right">Última</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.email} className="transition hover:bg-hover">
                    <td className="max-w-[280px] px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-bold text-low">
                          {initials(c.name || c.email)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-hi">{c.name || "Visitante"}</span>
                          {/* O e-mail leva às transações dele — a busca já existe lá. */}
                          <Link
                            href={`/admin/transacoes?email=${encodeURIComponent(c.email)}`}
                            className="block truncate text-xs text-low hover:text-brand hover:underline"
                          >
                            {c.email}
                          </Link>
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-mid">{fmtPhone(c.phone)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(c.spentCents)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">
                      {c.paidOrders}
                      {c.orders > c.paidOrders && <span className="text-low"> / {c.orders}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{c.stores}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-xs tabular-nums text-low">
                      {c.firstOrderAt ? fmtDate(c.firstOrderAt) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">
                      {c.lastOrderAt ? fmtDate(c.lastOrderAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-low">
        A coluna <b>Pedidos</b> mostra pagos / total quando houve pedido não pago. O checkout é de
        visitante, então o e-mail é o que identifica o mesmo comprador entre lojas.
      </p>

      <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} baseHref="/admin/clientes" params={keep} />
      </PendingArea>
    </div>
  );
}
