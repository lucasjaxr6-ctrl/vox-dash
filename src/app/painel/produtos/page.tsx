import { query } from "@/lib/db";
import { getSettingsForAdmin } from "@/lib/settings";
import { getActiveStore } from "@/lib/stores";
import SyncProductsButton from "@/components/painel/SyncProductsButton";
import { thumb } from "@/lib/image";

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default async function Produtos() {
  const store = await getActiveStore();
  const [products, settings] = store
    ? await Promise.all([
        query<any>(
          `SELECT id, name, priceCents, active, imageUrl, shopifyId
           FROM products WHERE storeId = ? ORDER BY updatedAt DESC`,
          [store.id],
        ),
        getSettingsForAdmin(store.id),
      ])
    : [[] as any[], null];
  const connected = Boolean(settings?.adminTokenConfigured && settings?.shopifyStoreDomain);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-hi">Produtos</h1>
          <p className="mt-1 text-sm text-low">
            Os produtos são sincronizados da sua loja Shopify — não há cadastro manual.
          </p>
        </div>
        <SyncProductsButton connected={connected} />
      </div>

      {!connected && (
        <div className="mt-5 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          Conecte sua Shopify primeiro em <b>Checkout → Shopify</b> para sincronizar os produtos.
        </div>
      )}

      <div className="mt-6 overflow-hidden rounded-xl bg-card">
        <table className="w-full text-sm">
          <thead className="bg-soft text-left text-low">
            <tr>
              <th className="px-4 py-3 font-medium">Produto</th>
              <th className="px-4 py-3 font-medium">Preço</th>
              <th className="px-4 py-3 font-medium">Origem</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-center text-dim" colSpan={4}>
                  Nenhum produto sincronizado ainda.
                </td>
              </tr>
            ) : (
              products.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb(p.imageUrl, 40)} alt="" className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-soft" />
                      )}
                      <span className="font-medium text-hi">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-mid">{brl(p.priceCents)}</td>
                  <td className="px-4 py-3">
                    {p.shopifyId ? (
                      <span className="rounded bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">Shopify</span>
                    ) : (
                      <span className="text-xs text-dim">Manual</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${p.active ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-soft text-low"}`}>
                      {p.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
