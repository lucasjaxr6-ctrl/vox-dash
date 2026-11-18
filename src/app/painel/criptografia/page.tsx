import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import ProductMaskManager from "@/components/painel/ProductMaskManager";

// Aba "Criptografia": mascara o nome do produto ENVIADO AO GATEWAY. O nome real
// continua no painel, e-mails e Shopify — só o que trafega para o gateway muda.
export default async function Criptografia() {
  const store = await getActiveStore();
  const products = store
    ? await query<{ id: string; name: string; maskedName: string | null; imageUrl: string | null }>(
        `SELECT id, name, maskedName, imageUrl FROM products
         WHERE storeId = ? AND active = 1 ORDER BY updatedAt DESC`,
        [store.id],
      )
    : [];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">Criptografia</h1>
      <p className="mt-1 text-sm text-low">
        Mascare o nome do produto que é enviado ao gateway de pagamento. Deixe em branco para enviar o
        nome original. O nome real continua no seu painel, nos e-mails e na Shopify — só muda o que vai ao gateway.
      </p>
      <ProductMaskManager products={products} />
    </div>
  );
}
