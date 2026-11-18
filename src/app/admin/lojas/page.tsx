import Link from "next/link";
import { getStoresWithStats } from "@/lib/admin";
import AdminStoreActions from "@/components/admin/AdminStoreActions";
import { PageHeader, StoreStatus, brl } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null) {
  return d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}

export default async function AdminStoresPage() {
  const stores = await getStoresWithStats("all");

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Lojas" subtitle={`${stores.length} lojas · ordenadas por faturamento total`} />

      <section className="overflow-hidden rounded-2xl bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                <th className="px-5 pb-2.5 pt-4">Loja</th>
                <th className="px-3 pb-2.5 pt-4">Dono</th>
                <th className="px-3 pb-2.5 pt-4 text-right">Vendas</th>
                <th className="px-3 pb-2.5 pt-4 text-right">Faturamento</th>
                <th className="px-3 pb-2.5 pt-4 text-right">Hoje</th>
                <th className="px-3 pb-2.5 pt-4">Última</th>
                <th className="px-3 pb-2.5 pt-4">Status</th>
                <th className="px-5 pb-2.5 pt-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stores.map((s) => (
                <tr key={s.id} className={`transition-colors hover:bg-hover ${!s.suspended && !s.lastOrderAt ? "opacity-60 hover:opacity-100" : ""}`}>
                  <td className="max-w-[260px] px-5 py-3">
                    <Link href={`/admin/loja/${s.id}`} className="block truncate font-semibold text-hi hover:text-brand dark:hover:text-brand-bright">{s.name}</Link>
                    <div className="truncate text-xs text-low">{s.shopifyDomain || "sem Shopify"}</div>
                  </td>
                  <td className="max-w-[240px] px-3 py-3">
                    <div className="truncate text-mid">{s.ownerName || "—"}</div>
                    <div className="truncate text-xs text-low">{s.ownerEmail || "—"}</div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-mid">{s.paidCount}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(s.gmvCents)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{s.gmvTodayCents > 0 ? brl(s.gmvTodayCents) : <span className="text-dim">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums text-low">{fmtDate(s.lastOrderAt)}</td>
                  <td className="px-3 py-3"><StoreStatus suspended={s.suspended} /></td>
                  <td className="px-5 py-3"><AdminStoreActions storeId={s.id} suspended={s.suspended === 1} canDelete={!s.lastOrderAt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
