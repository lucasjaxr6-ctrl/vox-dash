import Link from "next/link";
import { getStoresWithProductCount } from "@/lib/admin";
import { PageHeader, EmptyState } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const stores = await getStoresWithProductCount();

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Produtos" subtitle="Escolha uma loja para ver os produtos sincronizados" />

      {stores.length === 0 ? (
        <div className="rounded-2xl bg-card"><EmptyState>Nenhuma loja com produtos ainda.</EmptyState></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => (
            <Link key={s.id} href={`/admin/produtos/${s.id}`} className="group rounded-2xl bg-card p-5 transition-[background-color,box-shadow] duration-150 hover:bg-hover hover:shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold text-hi transition-colors group-hover:text-brand dark:group-hover:text-brand-bright">{s.name}</div>
                  <div className="truncate text-xs text-low">{s.ownerEmail || "—"}</div>
                  <div className="mt-0.5 truncate text-xs text-low">{s.shopifyDomain || "sem Shopify"}</div>
                </div>
                <span className="flex-shrink-0 rounded-lg bg-brand/10 px-2.5 py-1 text-sm font-semibold tabular-nums text-brand dark:text-brand-bright">{s.productCount}</span>
              </div>
              <div className="mt-3 text-xs text-low">{s.activeCount} ativos · {s.productCount - s.activeCount} inativos</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
