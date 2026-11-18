import { query, execute } from "@/lib/db";
import { json } from "@/lib/http";
import { getMangofyPayment, pedidoDoExternalCode } from "@/lib/mangofy";
import { aplicarStatusDoGateway, NEXT_STATUS } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/mangofy
//
// Corpo: o próprio pagamento (`payment_code`, `external_code`,
// `payment_status`, …), enviado a cada mudança relevante de status.
//
// A MangoFy NÃO assina o postback. O corpo serve só para ACHAR o pedido: o
// status vem do GET /api/v1/payment/{code} com a chave da loja, e a API
// confirma de que pedido é aquele pagamento (pelo external_code que ELA
// guardou) — um POST forjado aqui não liquida nada. Sempre 2xx; eles reenviam
// o que falhar (4, 16, 64 e 256 min).
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as any;
    const code = String(body?.payment_code ?? "").trim();
    // external_code = `<orderId>.<sufixo>` (ver lib/mangofy.ts).
    const orderId = pedidoDoExternalCode(String(body?.external_code ?? "").trim());
    if (!code && !orderId) return json({ ok: true });

    // `paymentGateway IS NULL` cobre o cartão: o gateway é gravado logo depois
    // da cobrança síncrona, e o aviso pode chegar antes.
    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE (paymentGateway = 'mangofy' OR paymentGateway IS NULL) AND (providerTxnId = ? OR id = ?)
        LIMIT 1`,
      [code || "-", orderId || "-"],
    );
    const order = rows[0];
    // Pedido já pago só interessa em estorno ou chargeback.
    const status = String(body?.payment_status ?? "").toLowerCase();
    if (!order || (order.status === "PAID" && !/refund|charge_back/.test(status))) return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "mangofy"))) return json({ ok: true });

    // Com renovação de Pix, o pago pode ser uma cobrança anterior à gravada.
    const id = code || order.providerTxnId;
    if (!id) return json({ ok: true });
    const pg = await getMangofyPayment(order.storeId, id);
    if (!pg || pg.orderId !== order.id) return json({ ok: true });
    // Pedido pago: só a cobrança que tem o dinheiro desfaz a venda. Estornar um Pix
    // antigo pago em duplicidade não cancela o pedido.
    if (order.status === "PAID" && id !== order.providerTxnId) return json({ ok: true });
    const next = NEXT_STATUS[pg.status];
    if (next === "PAID" && id !== order.providerTxnId) {
      // Religa o pedido à cobrança que tem o dinheiro (rastreio e estorno vão
      // para ela). `updatedAt = updatedAt` não reinicia o relógio do carrinho.
      await execute(`UPDATE orders SET providerTxnId = ?, updatedAt = updatedAt WHERE id = ?`, [id, order.id]);
    }
    if (next && next !== order.status) await aplicarStatusDoGateway(order.storeId, order, pg.status);

    return json({ ok: true });
  } catch (e) {
    console.error("[mangofy webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
