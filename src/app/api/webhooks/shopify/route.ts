import { verifyShopifyWebhook, normalizeShopifyProduct } from "@/lib/shopify";
import { getShopifyWebhookSecret } from "@/lib/settings";
import { query, execute, newId } from "@/lib/db";
import { json } from "@/lib/http";
import { rastreioDaShopify, aplicarRastreioDaShopify, type PedidoParaRastreio } from "@/lib/rastreio-shopify";

// POST /api/webhooks/shopify
// Endpoint COMPARTILHADO entre lojas: resolvemos a loja pelo header
// x-shopify-shop-domain (== shopifyStoreDomain da loja) e validamos o HMAC com o
// secret DELA. Reage a pedidos pagos e a mudanças de produtos (sync em tempo real).
export async function POST(req: Request) {
  const rawBody = await req.text(); // corpo CRU é necessário p/ validar o HMAC
  const hmac = req.headers.get("x-shopify-hmac-sha256");
  const shopDomain = req.headers.get("x-shopify-shop-domain");

  if (!shopDomain) return json({ error: "Loja Shopify ausente" }, 400);
  const storeRows = await query<{ storeId: string }>(
    `SELECT storeId FROM store_settings WHERE shopifyStoreDomain = ? LIMIT 1`,
    [shopDomain],
  );
  const storeId = storeRows[0]?.storeId;
  if (!storeId) return json({ error: "Loja não encontrada" }, 404);

  const secret = await getShopifyWebhookSecret(storeId);
  if (!secret) {
    return json({ error: "Integração Shopify não configurada" }, 503);
  }
  if (!verifyShopifyWebhook(rawBody, hmac, secret)) {
    return json({ error: "Assinatura inválida" }, 401);
  }

  const topic = req.headers.get("x-shopify-topic");
  const payload = JSON.parse(rawBody);

  try {
    if (topic === "orders/paid") {
      // Pagamento aprovado na Shopify (ex.: cartão que saiu da análise antifraude
      // e o lojista marcou pago manualmente). Roteamos pela settlePixOrder — não
      // um UPDATE cru — pra disparar Utmify, paidAt, notificação e o e-mail "em
      // separação". Idempotente: se o gateway já liquidou (status PAID), é no-op.
      const orows = await query<{ id: string; status: string; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
        `SELECT id, status, shopifyOrderId, shopifyDraftId FROM orders WHERE storeId = ? AND shopifyOrderId = ? LIMIT 1`,
        [storeId, String(payload.id)],
      );
      const ord = orows[0];
      if (ord && ord.status !== "PAID" && ord.status !== "SHIPPED") {
        const { settlePixOrder } = await import("@/lib/payments");
        await settlePixOrder(storeId, ord, "PAID");
      }
    } else if (topic === "products/create" || topic === "products/update") {
      const p = normalizeShopifyProduct(payload);
      if (p.shopifyId) {
        await execute(
          `INSERT INTO products (id, storeId, shopifyId, name, description, priceCents, imageUrl, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             description = VALUES(description),
             priceCents = VALUES(priceCents),
             imageUrl = VALUES(imageUrl),
             active = VALUES(active),
             updatedAt = CURRENT_TIMESTAMP(3)`,
          [newId(), storeId, p.shopifyId, p.name, p.description, p.priceCents, p.imageUrl, p.active ? 1 : 0],
        );
      }
    } else if (topic === "products/delete") {
      // Soft-delete: marca como inativo (preserva histórico de pedidos).
      await execute(`UPDATE products SET active = 0 WHERE storeId = ? AND shopifyId = ?`, [
        storeId,
        String(payload.id),
      ]);
    } else if (topic === "orders/updated") {
      // Rastreio adicionado na Shopify (por app ou manualmente) chega aqui: o
      // pedido é atualizado ao criar a fulfillment, que traz o tracking_number.
      // Usamos orders/updated (scope read_orders, já temos) — não precisa do
      // scope de fulfillment. O código é GRAVADO antes do e-mail (ver
      // lib/rastreio-shopify.ts); o que escapar daqui, o cron
      // /api/cron/shopify-rastreio busca na Shopify.
      const shopifyOrderId = String(payload.id ?? "");
      const rastreio = rastreioDaShopify(payload);
      if (shopifyOrderId && rastreio) {
        const orows = await query<PedidoParaRastreio>(
          `SELECT id, status, trackingCode, providerTxnId, paymentGateway FROM orders WHERE storeId = ? AND shopifyOrderId = ? LIMIT 1`,
          [storeId, shopifyOrderId],
        );
        if (orows[0]) await aplicarRastreioDaShopify(storeId, orows[0], rastreio.codigo, { avisarCliente: true });
      }
    }
  } catch (e) {
    // Nunca derruba o webhook por erro de processamento (a Shopify re-tenta).
    console.error("[webhook]", topic, e);
  }

  return json({ ok: true });
}
