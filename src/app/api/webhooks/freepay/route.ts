import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getFreepayTransactionStatus } from "@/lib/freepay";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/freepay
// Notificação da Freepay. NÃO confiamos no corpo: usamos só o id da transação
// para RE-CONSULTAR o status em GET /payment-transaction/info/{id} (autenticado
// com as chaves da loja), que é a fonte da verdade — assim um webhook forjado não
// marca como pago. Sempre respondemos 2xx (a Freepay re-tenta em caso de falha).
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({} as any));

    // A Freepay varia o formato do postback (Id, id, data.id, transaction.id...).
    // Em vez de adivinhar o campo, coletamos TODO id de 32 hex do corpo e casamos
    // com o providerTxnId dos pedidos — o que bater é o pedido certo.
    const candidates = collectHexIds(body);
    const qp = (url.searchParams.get("id") || "").trim();
    if (qp) candidates.push(qp);
    if (candidates.length === 0) {
      console.error("[freepay webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ ok: true });
    }

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE providerTxnId IN (${inPlaceholders(candidates.length)}) LIMIT 1`,
      candidates,
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem Freepay ativo.
    // Postback de gateway inativo/errado é ignorado (defesa contra abuso do endpoint).
    if (order.paymentGateway && order.paymentGateway !== "freepay") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "freepay"))) return json({ ok: true });

    // Fonte da verdade: re-consulta o status na Freepay pelo id do próprio pedido.
    const raw = await getFreepayTransactionStatus(order.storeId, order.providerTxnId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}

// Extrai todos os ids de 32 caracteres hex (formato de transação da Freepay) de
// qualquer estrutura de payload, sem depender do nome do campo.
function collectHexIds(body: unknown): string[] {
  const ids = new Set<string>();
  const HEX32 = /\b[0-9a-fA-F]{32}\b/g;
  const stack: unknown[] = [body];
  let guard = 0;
  while (stack.length && guard++ < 1000) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const v of Object.values(cur as Record<string, unknown>)) {
      if (typeof v === "string") {
        const matches = v.match(HEX32);
        if (matches) for (const m of matches) ids.add(m);
      } else if (v && typeof v === "object") {
        stack.push(v);
      }
    }
  }
  return [...ids];
}
