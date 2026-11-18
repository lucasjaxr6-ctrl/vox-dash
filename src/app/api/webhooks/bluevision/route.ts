import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { verifyBluevisionSignature } from "@/lib/bluevision";
import { aplicarStatusDoGateway, ehEstorno, getOrderGatewayStatus, reconcileOrder } from "@/lib/payments";
import { isGatewayActive, getBluevisionCredentials } from "@/lib/settings";

// POST /api/webhooks/bluevision
//
// Chega pelo `postbackUrl` de cada transação e/ou pelo cadastro no painel deles
// (Configurações → Webhooks). Corpo: { id: "evt_…", type: "transaction.paid",
// createdAt, data: { id: "txn_…", status, amount, paymentMethod } }.
//
// O pedido vem de `data.id` (= providerTxnId) e, se vier, de `data.externalRef`
// (= nosso orderId). Duas camadas antes de liquidar:
//  1. assinatura HMAC-SHA256 do corpo CRU (X-Wishpag-Signature: sha256=<hex>),
//     quando a loja salvou o webhook secret;
//  2. re-consulta na API (`reconcileOrder`), que é a fonte da verdade e olha
//     todas as cobranças do pedido.
// Com as duas, um postback forjado não marca pedido como pago.
//
// Sempre 2xx: resposta de erro só faria o gateway re-tentar sem ganho.
const EVENTOS = new Set([
  "transaction.paid",
  "transaction.failed",
  "transaction.refunded",
  "transaction.chargeback",
]);

export async function POST(req: Request) {
  try {
    // CRU primeiro: o HMAC é sobre os bytes exatos que eles enviaram.
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {} as any;
      }
    })();

    const evento = String(body?.type ?? "");
    // Sem `type` (formato que a doc não mostra) segue para a re-consulta, que
    // decide sozinha; com `type`, só os que mudam o pedido.
    if (evento && !EVENTOS.has(evento)) return json({ ok: true });

    const d = body?.data ?? body ?? {};
    const txnId = String(d?.id ?? "").trim();
    const externalRef = String(d?.externalRef ?? "").trim();
    if (!txnId && !externalRef) return json({ ok: true });

    const rows = await query<{
      id: string;
      storeId: string;
      status: string;
      paymentMethod: string | null;
      providerTxnId: string | null;
      paymentGateway: string | null;
      shopifyOrderId: string | null;
      shopifyDraftId: string | null;
    }>(
      `SELECT id, storeId, status, paymentMethod, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE paymentGateway = 'bluevision' AND (providerTxnId = ? OR id = ?)
        LIMIT 1`,
      [txnId || "-", externalRef || "-"],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "bluevision"))) return json({ ok: true });

    const creds = await getBluevisionCredentials(order.storeId);
    if (creds?.webhookSecret && !verifyBluevisionSignature(raw, req.headers.get("x-wishpag-signature"), creds.webhookSecret)) {
      // Segredo errado no painel faz TODA entrega cair aqui. O pedido ainda se
      // resolve pela conciliação, mas o log tem de mostrar a causa.
      console.error("[bluevision webhook] assinatura inválida", evento, order.id);
      return json({ ok: true });
    }

    // Pedido pago só muda por estorno da cobrança que tem o dinheiro. Olhar as outras
    // cobranças aqui religaria o pedido a um Pix antigo sem motivo.
    if (order.status === "PAID" || order.status === "SHIPPED") {
      const status = await getOrderGatewayStatus(order.storeId, order);
      if (ehEstorno(status)) await aplicarStatusDoGateway(order.storeId, order, status);
      return json({ ok: true });
    }

    await reconcileOrder(order.storeId, order);
    return json({ ok: true });
  } catch (e) {
    console.error("[bluevision webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
