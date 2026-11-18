import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getPagnivTransactionStatus, verifyPagnivSignature } from "@/lib/pagniv";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive, getPagnivCredentials } from "@/lib/settings";

// POST /api/webhooks/pagniv
//
// Envelope: { event, data, timestamp } — eventos charge.paid, charge.refunded,
// charge.expired, dispute.*, withdrawal.*.
//
// Aqui o casamento é DIRETO: `data.externalId` é o nosso orderId, porque a
// PagNiv exige externalId na criação. Nada de varrer o payload atrás de um id
// que pareça certo, como nos gateways que não devolvem referência.
//
// Duas camadas antes de liquidar:
//  1. assinatura HMAC-SHA256 (X-Webhook-Signature), quando a loja salvou o
//     secret — o corpo CRU é lido antes de qualquer parse, senão o HMAC não bate;
//  2. re-consulta do status na API, que é a fonte da verdade.
// Com as duas, um postback forjado não marca pedido como pago.
//
// Sempre 2xx: eles re-tentam quando não recebem 2xx em 10s.
export async function POST(req: Request) {
  try {
    // CRU primeiro: JSON.stringify(await req.json()) muda espaços e ordem, e a
    // assinatura é sobre os bytes exatos que eles enviaram.
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {} as any;
      }
    })();

    const evento = String(body?.event ?? "");
    // Só eventos de cobrança mexem em pedido. Saque e disputa têm ids de outro
    // domínio e não podem entrar no caminho de liquidação.
    if (!evento.startsWith("charge.")) return json({ ok: true });

    const externalId = String(body?.data?.externalId ?? "").trim();
    const chargeId = String(body?.data?.id ?? "").trim();
    if (!externalId && !chargeId) return json({ ok: true });

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE paymentGateway = 'pagniv' AND (id = ? OR providerTxnId = ?)
        LIMIT 1`,
      [externalId || "-", chargeId || "-"],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "pagniv"))) return json({ ok: true });

    // Assinatura: só é exigida quando a loja salvou o secret. Sem ele, a
    // re-consulta abaixo continua sendo a defesa — mas o painel avisa para
    // cadastrar.
    const creds = await getPagnivCredentials(order.storeId);
    if (creds?.webhookSecret) {
      const assinada = verifyPagnivSignature(raw, req.headers.get("x-webhook-signature"), creds.webhookSecret);
      if (!assinada) {
        console.error("[pagniv webhook] assinatura inválida", evento, order.id);
        return json({ ok: true });
      }
    }

    const id = order.providerTxnId || chargeId;
    if (!id) return json({ ok: true });
    const raw2 = await getPagnivTransactionStatus(order.storeId, id);
    await aplicarStatusDoGateway(order.storeId, order, raw2);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
