import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getShopifyCredentials } from "@/lib/settings";
import { registerShopifyWebhooks } from "@/lib/shopify";

// Tópicos que o nosso webhook (/api/webhooks/shopify) sabe tratar.
const TOPICS = [
  "products/create",
  "products/update",
  "products/delete",
  "orders/paid",
  // Rastreio automático: quando o código é adicionado na Shopify, o pedido é
  // atualizado (orders/updated) trazendo o tracking_number — aí mandamos o e-mail.
  // Usa read_orders (já temos), sem precisar do scope de fulfillment.
  "orders/updated",
];

// POST /api/painel/shopify/register-webhooks
// Registra (idempotente) os webhooks na Shopify apontando para esta aplicação.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();

    const creds = await getShopifyCredentials(store.id);
    if (!creds) {
      return json({ error: "Shopify não configurada. Conecte a integração primeiro." }, 400);
    }

    // Descobre o domínio público desta app a partir da requisição.
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host) {
      return json({ error: "Não foi possível determinar o domínio público." }, 400);
    }
    if (host.includes("localhost") || host.startsWith("127.") || host.startsWith("0.0.0.0")) {
      return json(
        {
          error:
            "A Shopify exige uma URL pública HTTPS para webhooks. Publique a aplicação (ou use um túnel como ngrok) e tente novamente.",
        },
        400,
      );
    }

    const address = `${proto}://${host}/api/webhooks/shopify`;
    const result = await registerShopifyWebhooks(store.id, address, TOPICS);

    return json({ ok: true, address, ...result });
  } catch (err) {
    return handleError(err);
  }
}
