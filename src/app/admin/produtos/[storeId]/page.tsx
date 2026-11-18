import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoreDetail, getStoreProducts } from "@/lib/admin";
import { thumb } from "@/lib/image";
import { brl } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminStoreProductsPage({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ q?: string }> }) {
  const { storeId } = await params;
  const q = ((await searchParams).q || "").slice(0, 60);
  const store = await getStoreDetail(storeId);
  if (!store) notFound();
  const products = await getStoreProducts(storeId, q);

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <Link href="/admin/produtos" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-low transition-colors hover:text-hi">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Produtos
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-[22px] font-semibold tracking-tight text-hi">{store.name}</h1>
            <p className="mt-1 text-[13px] text-low">{products.length} produtos {q ? `para "${q}"` : ""}</p>
          </div>
          <form className="flex w-full items-center gap-2 sm:w-auto">
            <input name="q" type="search" defaultValue={q} placeholder="Buscar produto..." aria-label="Buscar produto" className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[13px] outline-none placeholder:text-low focus:border-brand focus:ring-2 focus:ring-brand/20 sm:w-64 sm:flex-none" />
            <button className="rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-brand-hover">Buscar</button>
          </form>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                <th className="px-5 pb-2.5 pt-4">Produto</th>
                <th className="px-3 pb-2.5 pt-4">Nome no gateway (máscara)</th>
                <th className="px-3 pb-2.5 pt-4 text-right">Preço</th>
                <th className="px-5 pb-2.5 pt-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.length === 0 ? (
                <tr><td colSpan={4} className="px-5 py-14 text-center text-low">Nenhum produto encontrado.</td></tr>
              ) : products.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-hover">
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb(p.imageUrl, 36)} alt="" loading="lazy" className="h-9 w-9 flex-shrink-0 rounded-md object-cover ring-1 ring-line" />
                      ) : (
                        <span className="h-9 w-9 flex-shrink-0 rounded-md bg-soft" />
                      )}
                      <span className="font-medium text-hi">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-low">{p.maskedName?.trim() ? p.maskedName : <span className="text-dim">—</span>}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-hi">{brl(p.priceCents)}</td>
                  <td className="px-5 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${p.active ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400" : "bg-soft text-low ring-line"}`}>
                      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
