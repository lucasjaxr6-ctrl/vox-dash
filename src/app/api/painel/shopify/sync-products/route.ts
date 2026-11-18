import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getShopifyCredentials } from "@/lib/settings";
import { syncShopifyProductsToDb } from "@/lib/shopify";

// POST /api/painel/shopify/sync-products
// Importa (upsert por shopifyId) todos os produtos da loja Shopify conectada.
export async function POST() {
  try {
    const { store } = await requireStore();

    const creds = await getShopifyCredentials(store.id);
    if (!creds) {
      return json({ error: "Shopify não configurada. Conecte a integração primeiro." }, 400);
    }

    const synced = await syncShopifyProductsToDb(store.id);
    return json({ ok: true, synced });
  } catch (err) {
    return handleError(err);
  }
}
