import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getShopifyCredentials } from "@/lib/settings";
import { createShopifyDraftOrder, completeShopifyDraftOrder } from "@/lib/shopify";

// POST /api/painel/shopify/test-order
// Cria um pedido de TESTE na Shopify para diagnosticar o repasse. Retorna o id
// criado ou a mensagem de erro exata da Shopify (ex.: falta de escopo write_orders,
// payload recusado). O lojista pode excluir esse pedido depois.
export async function POST() {
  try {
    const { store } = await requireStore();

    const creds = await getShopifyCredentials(store.id);
    if (!creds) {
      return json({ error: "Shopify não conectada nesta loja (sem token). Conecte na aba Shopify." }, 400);
    }

    try {
      // 1) Cria o rascunho (equivale ao pedido pendente).
      const draftId = await createShopifyDraftOrder(store.id, {
        lineItems: [{ title: "Pedido de teste VoxPay", priceCents: 100, quantity: 1 }],
        shippingCents: 0,
        discountCents: 0,
        customer: { name: "Teste VoxPay", email: "teste@voxpay.com.br", phone: "11999999999" },
        note: "Teste VoxPay — pode excluir.",
      });
      if (!draftId) return json({ error: "A Shopify não retornou o id do rascunho." }, 502);

      // 2) Completa como pago (equivale ao pagamento aprovado).
      const orderId = await completeShopifyDraftOrder(store.id, draftId);
      return json({
        ok: true,
        draftId,
        orderId,
        message: orderId
          ? `OK! Rascunho ${draftId} criado e completado como pedido PAGO ${orderId}. Confira em Pedidos (pode excluir).`
          : `Rascunho ${draftId} criado, mas não retornou o pedido ao completar.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha no teste.";
      return json({ error: message }, 502);
    }
  } catch (err) {
    return handleError(err);
  }
}
