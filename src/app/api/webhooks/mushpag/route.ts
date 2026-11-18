import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { verifyMushpagSignature } from "@/lib/mushpag";
import { aplicarStatusDoGateway, ehEstorno, getOrderGatewayStatus, reconcileOrder } from "@/lib/payments";
import { isGatewayActive, getMushpagCredentials } from "@/lib/settings";

// POST /api/webhooks/mushpag
//
// Corpo: { id, event: "charge.paid" | ..., created_at, schema_version, data: <cobrança> }
// O endpoint é cadastrado pela API da MushPag no teste da chave (ver
// garantirWebhookMushpag), uma vez por conta.
//
// O evento NÃO traz a nossa referência, só o id da cobrança. Ele casa com
// `orders.providerTxnId` ou, se o Pix foi renovado e o cliente pagou um código
// anterior, com o histórico em `order_charges`.
//
// Duas camadas antes de liquidar: a assinatura (quando temos o segredo) e a
// RE-CONSULTA do status na API, com a credencial da loja. Respondemos 200
// sempre, inclusive quando ignoramos: qualquer outro código faz a MushPag
// reenviar por até 7 vezes algo que nunca vamos processar.
export async function POST(req: Request) {
  try {
    // CRU primeiro: a assinatura é sobre os bytes exatos que eles enviaram.
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {} as any;
      }
    })();

    const evento = String(body?.event ?? "");
    // Transferência (saque) não mexe em pedido, e o id dela é de outro domínio.
    if (!evento.startsWith("charge.")) return json({ ok: true });
    const chargeId = String(body?.data?.id ?? "").trim();
    if (!chargeId) return json({ ok: true });

    type Pedido = {
      id: string;
      storeId: string;
      status: string;
      paymentMethod: string | null;
      providerTxnId: string | null;
      paymentGateway: string | null;
      shopifyOrderId: string | null;
      shopifyDraftId: string | null;
    };
    const campos = `o.id, o.storeId, o.status, o.paymentMethod, o.providerTxnId, o.paymentGateway, o.shopifyOrderId, o.shopifyDraftId`;
    let [order] = await query<Pedido>(
      `SELECT ${campos} FROM orders o WHERE o.paymentGateway = 'mushpag' AND o.providerTxnId = ? LIMIT 1`,
      [chargeId],
    );
    if (!order) {
      [order] = await query<Pedido>(
        `SELECT ${campos}
           FROM order_charges c JOIN orders o ON o.id = c.orderId AND o.storeId = c.storeId
          WHERE c.gateway = 'mushpag' AND c.providerTxnId = ?
          LIMIT 1`,
        [chargeId],
      );
    }
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "mushpag"))) return json({ ok: true });

    const creds = await getMushpagCredentials(order.storeId);
    if (creds?.webhookSecret) {
      const ok = verifyMushpagSignature(raw, req.headers.get("x-signature"), creds.webhookSecret);
      if (!ok) {
        console.error("[mushpag webhook] assinatura inválida", evento, order.id);
        return json({ ok: true });
      }
    }

    // Pedido pago só muda por estorno da cobrança que tem o dinheiro. Olhar as outras
    // cobranças aqui religaria o pedido a um Pix antigo sem motivo.
    if (order.status === "PAID" || order.status === "SHIPPED") {
      const status = await getOrderGatewayStatus(order.storeId, order);
      if (ehEstorno(status)) await aplicarStatusDoGateway(order.storeId, order, status);
      return json({ ok: true });
    }

    // Consulta TODAS as cobranças do pedido (a atual e as da renovação) e
    // liquida pela que respondeu, religando o pedido a ela se for outra.
    await reconcileOrder(order.storeId, order);
    return json({ ok: true });
  } catch (e) {
    console.error("[mushpag webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
