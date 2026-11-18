import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { aplicarStatusDoGateway, ehEstorno, getOrderGatewayStatus, reconcileOrder } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/wappi
//
// A URL vai em `postback_url` em cada cobrança. O postback da Wappi (mesmo
// motor da Freepay) vem como { Id, Status, Amount, ... }, SEM assinatura. Por
// isso o corpo só serve para achar o pedido: o status é RE-CONSULTADO na API com
// as chaves da loja, e um postback forjado não marca nada como pago.
//
// Casa pelo id da transação em `orders.providerTxnId` ou, se o Pix foi renovado
// e o cliente pagou um código anterior, no histórico em `order_charges`.
// Responde 200 sempre, inclusive quando ignora: outro código faz a Wappi reenviar.
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    const candidatos = idsDoCorpo(body);
    const qp = (url.searchParams.get("id") || "").trim();
    if (qp && qp.length <= 64) candidatos.push(qp);
    if (candidatos.length === 0) {
      console.error("[wappi webhook] sem id no corpo:", Object.keys(body ?? {}).join(","));
      return json({ ok: true });
    }

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
      `SELECT ${campos} FROM orders o
        WHERE o.paymentGateway = 'wappi' AND o.providerTxnId IN (${inPlaceholders(candidatos.length)}) LIMIT 1`,
      candidatos,
    );
    if (!order) {
      [order] = await query<Pedido>(
        `SELECT ${campos}
           FROM order_charges c JOIN orders o ON o.id = c.orderId AND o.storeId = c.storeId
          WHERE c.gateway = 'wappi' AND c.providerTxnId IN (${inPlaceholders(candidatos.length)})
          LIMIT 1`,
        candidatos,
      );
    }
    if (!order || order.status === "CANCELLED") return json({ ok: true });
    // Postback de loja sem a Wappi ativa é ignorado (defesa contra abuso do endpoint).
    if (!(await isGatewayActive(order.storeId, "wappi"))) return json({ ok: true });

    // Pedido pago só muda por estorno da cobrança que tem o dinheiro.
    if (order.status === "PAID" || order.status === "SHIPPED") {
      const status = await getOrderGatewayStatus(order.storeId, order);
      if (ehEstorno(status)) await aplicarStatusDoGateway(order.storeId, order, status);
      return json({ ok: true });
    }

    // Consulta a cobrança atual e as da renovação, e liquida pela que respondeu.
    await reconcileOrder(order.storeId, order);
    return json({ ok: true });
  } catch (e) {
    console.error("[wappi webhook]", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}

// Ids possíveis da transação, sem depender do nome do campo: todo trecho de 32
// hex (formato do `Id` no postback) e os campos chamados id, em qualquer nível.
function idsDoCorpo(body: unknown): string[] {
  const ids = new Set<string>();
  const HEX32 = /\b[0-9a-fA-F]{32}\b/g;
  const stack: unknown[] = [body];
  let guard = 0;
  while (stack.length && guard++ < 1000) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (typeof v === "string") {
        for (const m of v.match(HEX32) ?? []) ids.add(m);
        const t = v.trim();
        if (/^(id|transaction_?id)$/i.test(k) && t && t.length <= 64) ids.add(t);
      } else if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return [...ids].slice(0, 50);
}
