import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { pedidoDaReferencia, verifyNuvraSignature } from "@/lib/nuvra";
import { aplicarStatusDoGateway, ehEstorno, getOrderGatewayStatus, reconcileOrder } from "@/lib/payments";
import { isGatewayActive, getNuvraCredentials } from "@/lib/settings";

// POST /api/webhooks/nuvra
//
// Cadastrado UMA vez no painel da Nuvra (Desenvolvedor → Webhooks), não por
// cobrança. Corpo: { event, data, sentAt }. Headers: X-Nuvra-Event,
// X-Nuvra-Event-Id (igual nas re-tentativas) e X-Nuvra-Signature.
//
// O pedido vem de `data.externalReference`, que começa pelo nosso orderId (a
// cobrança leva um sufixo, ver lib/nuvra.ts). Por isso um Pix ANTIGO do mesmo
// pedido, pago depois de uma renovação, ainda acha o pedido.
//
// Duas camadas antes de liquidar:
//  1. assinatura HMAC-SHA256 do corpo CRU, quando a loja salvou o segredo, e
//     `sentAt` dentro de 5 minutos (a doc pede, contra reenvio de entrega
//     antiga; o sentAt está dentro do corpo assinado);
//  2. re-consulta na API, que é a fonte da verdade. `reconcileOrder` olha
//     todas as cobranças do pedido e religa à que tiver o dinheiro.
// Com as duas, um postback forjado não marca pedido como pago.
//
// Sempre 2xx: a Nuvra re-tenta quando não recebe 2xx em 8 s.

// Só estes mexem em pedido. `order.*` são apelidos legados de `charge.*`
// (mesmos dados); contas antigas podem ainda recebê-los.
const EVENTOS = new Set([
  "charge.paid",
  "charge.failed",
  "charge.refunded",
  "order.approved",
  "order.refused",
  "order.refunded",
]);

const JANELA_MS = 5 * 60_000;

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

    const evento = String(body?.event ?? req.headers.get("x-nuvra-event") ?? "");
    if (!EVENTOS.has(evento)) return json({ ok: true });

    const orderId = pedidoDaReferencia(body?.data?.externalReference);
    const chargeId = String(body?.data?.id ?? "").trim();
    if (!orderId && !chargeId) return json({ ok: true });

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
        WHERE paymentGateway = 'nuvra' AND (id = ? OR providerTxnId = ?)
        LIMIT 1`,
      [orderId || "-", chargeId || "-"],
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "nuvra"))) return json({ ok: true });

    // Assinatura: exigida quando a loja salvou o segredo. Sem ele, a
    // re-consulta abaixo continua sendo a defesa.
    const creds = await getNuvraCredentials(order.storeId);
    if (creds?.webhookSecret) {
      if (!verifyNuvraSignature(raw, req.headers.get("x-nuvra-signature"), creds.webhookSecret)) {
        // Segredo errado no painel faz TODA entrega cair aqui. O pedido ainda
        // se resolve pela conciliação, mas o log tem de mostrar a causa.
        console.error("[nuvra webhook] assinatura inválida", evento, order.id);
        return json({ ok: true });
      }
      const enviadoEm = Date.parse(String(body?.sentAt ?? ""));
      if (Number.isFinite(enviadoEm) && Math.abs(Date.now() - enviadoEm) > JANELA_MS) {
        console.error("[nuvra webhook] entrega fora da janela de 5 min", evento, order.id, body?.sentAt);
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

    await reconcileOrder(order.storeId, order);
    return json({ ok: true });
  } catch (e) {
    console.error("[nuvra webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
