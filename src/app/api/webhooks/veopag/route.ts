import { query, execute } from "@/lib/db";
import { json } from "@/lib/http";
import { getVeopagDeposit, pedidoDoExternalId, verifyVeopagSignature } from "@/lib/veopag";
import { aplicarStatusDoGateway, NEXT_STATUS } from "@/lib/payments";
import { isGatewayActive, getVeopagCredentials } from "@/lib/settings";

// POST /api/webhooks/veopag
//
// Corpo de depósito: `{ type: "Deposit", external_id, transaction_id, status,
// payment_method, ... }`. Saques (`type: "Withdrawal"`) não mexem em pedido.
//
// Duas camadas antes de liquidar: o HMAC (`X-Webhook-Signature` sobre
// "<X-Webhook-Timestamp>.<corpo bruto>", quando a loja salvou a Webhook
// Signature) e a RE-CONSULTA do status na API. Sempre 2xx: a VeoPag reenvia
// o que falhar, e o que ignoramos não deve virar retentativa.
export async function POST(req: Request) {
  try {
    // CRU primeiro: o HMAC é sobre os bytes exatos que chegaram.
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {} as any;
      }
    })();
    if (String(body?.type ?? "").toLowerCase() !== "deposit") return json({ ok: true });

    const txnId = String(body?.transaction_id ?? "").trim();
    // external_id = `<orderId>.<sufixo>` (ver lib/veopag.ts).
    const orderId = pedidoDoExternalId(String(body?.external_id ?? "").trim());
    if (!txnId && !orderId) return json({ ok: true });

    // `paymentGateway IS NULL` cobre o cartão: o gateway é gravado logo depois
    // da cobrança síncrona, e o aviso pode chegar antes.
    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE (paymentGateway = 'veopag' OR paymentGateway IS NULL) AND (providerTxnId = ? OR id = ?)
        LIMIT 1`,
      [txnId || "-", orderId || "-"],
    );
    const order = rows[0];
    if (!order) return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "veopag"))) return json({ ok: true });

    const creds = await getVeopagCredentials(order.storeId);
    if (creds?.webhookSecret) {
      const ok = verifyVeopagSignature(
        raw,
        req.headers.get("x-webhook-signature"),
        req.headers.get("x-webhook-timestamp"),
        creds.webhookSecret,
      );
      if (!ok) {
        console.error("[veopag webhook] assinatura inválida", order.id);
        return json({ ok: true });
      }
    }

    // Com renovação de Pix, o evento pode ser de uma cobrança ANTERIOR à
    // gravada no pedido. A API confirma de quem é a cobrança (pelo external_id
    // que ELA guardou), então um transaction_id de outro pedido no corpo não
    // liquida este.
    const id = txnId || order.providerTxnId;
    if (!id) return json({ ok: true });
    const dep = await getVeopagDeposit(order.storeId, id);
    if (!dep || dep.orderId !== order.id) return json({ ok: true });
    // Pedido pago: só a cobrança que tem o dinheiro desfaz a venda. Estornar um Pix
    // antigo pago em duplicidade não cancela o pedido.
    if (order.status === "PAID" && id !== order.providerTxnId) return json({ ok: true });
    const next = NEXT_STATUS[dep.status];
    if (next === "PAID" && id !== order.providerTxnId) {
      // Religa o pedido à cobrança que tem o dinheiro (rastreio e estorno vão
      // para ela). `updatedAt = updatedAt` não reinicia o relógio do carrinho.
      await execute(`UPDATE orders SET providerTxnId = ?, updatedAt = updatedAt WHERE id = ?`, [id, order.id]);
    }
    if (next && next !== order.status) await aplicarStatusDoGateway(order.storeId, order, dep.status);

    return json({ ok: true });
  } catch (e) {
    console.error("[veopag webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
