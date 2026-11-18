import Link from "next/link";
import { notFound } from "next/navigation";
import { getStoreDetail, getStoreRecentOrders } from "@/lib/admin";
import AdminStoreActions from "@/components/admin/AdminStoreActions";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";
import { MetricCard, Panel, EmptyState, StatusBadge, StoreStatus, brl, METHOD_LABEL } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

function fmtDateTime(d: Date) {
  return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function AdminStorePage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const store = await getStoreDetail(storeId);
  if (!store) notFound();
  const orders = await getStoreRecentOrders(storeId, 25);

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <Link href="/admin/lojas" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-low transition-colors hover:text-hi">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          Lojas
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2.5 text-[22px] font-semibold tracking-tight text-hi">
              <span className="min-w-0 break-words">{store.name}</span>
              <StoreStatus suspended={store.suspended} />
            </h1>
            <p className="mt-1 text-[13px] text-low">{store.ownerName || "—"} · {store.ownerEmail || "—"}</p>
          </div>
          <AdminStoreActions storeId={store.id} suspended={store.suspended === 1} canDelete={store.paidCount === 0 && store.pendingCount === 0} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard label="Faturamento" value={<AnimatedNumber value={Number(store.gmvCents)} format="brl" display />} />
        <MetricCard label="Vendas pagas" value={<AnimatedNumber value={Number(store.paidCount)} />} />
        <MetricCard label="Pendentes" value={<AnimatedNumber value={Number(store.pendingCount)} />} />
        <MetricCard label="Produtos" value={<AnimatedNumber value={Number(store.productCount)} />} />
      </div>

      <Panel title="Domínios e integração" padded>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="min-w-0"><dt className="text-xs text-low">Shopify</dt><dd className="mt-0.5 break-words text-hi">{store.shopifyDomain || "—"}</dd></div>
          <div className="min-w-0">
            <dt className="text-xs text-low">Domínio do checkout</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 break-words text-hi">
              {store.customDomain || "—"}
              {store.customDomain ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${store.domainVerified ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}`}>
                  {store.domainVerified ? "Verificado" : "Não verificado"}
                </span>
              ) : null}
            </dd>
          </div>
          <div><dt className="text-xs text-low">Criada em</dt><dd className="mt-0.5 tabular-nums text-hi">{new Date(store.createdAt).toLocaleDateString("pt-BR")}</dd></div>
        </dl>
      </Panel>

      <Panel title="Pedidos recentes">
        {orders.length === 0 ? (
          <EmptyState>Nenhum pedido ainda.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-2.5">Cliente</th>
                  <th className="px-3 py-2.5">Método</th>
                  <th className="px-3 py-2.5">Gateway</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Total</th>
                  <th className="px-5 py-2.5 text-right">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => (
                  <tr key={o.id} className="transition-colors hover:bg-hover">
                    <td className="max-w-[260px] truncate px-5 py-3">
                      <Link href={`/admin/transacoes/${o.id}`} className="text-mid hover:text-brand dark:hover:text-brand-bright">{o.customerEmail || "—"}</Link>
                    </td>
                    <td className="px-3 py-3 text-mid">{o.paymentMethod ? METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod : "—"}</td>
                    <td className="px-3 py-3 text-xs text-low">{o.paymentGateway || "—"}</td>
                    <td className="px-3 py-3"><StatusBadge status={o.status} /></td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(o.totalCents)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">{fmtDateTime(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
