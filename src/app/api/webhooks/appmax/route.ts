import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getAppmaxOrderStatus } from "@/lib/appmax";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/appmax
// Notificação da Appmax. NÃO confiamos no corpo: usamos só o id do pedido para
// RE-CONSULTAR o status em GET /v1/orders/{id} (autenticado), que é a fonte da
// verdade. Sempre respondemos 2xx (a Appmax re-tenta em caso de falha).
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}) as any);

    // A Appmax varia o campo do id do pedido no payload. Em vez de adivinhar,
    // coletamos TODO id numérico (6+ dígitos) do corpo e casamos com o
    // providerTxnId — o que bater é o pedido certo. (customer_id etc. também são
    // numéricos, mas não batem com nenhum providerTxnId, então são inofensivos.)
    const candidates = collectNumericIds(body);
    const qp = (url.searchParams.get("id") || "").trim();
    if (/^\d+$/.test(qp)) candidates.push(qp);
    if (candidates.length === 0) {
      console.error("[appmax webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ ok: true });
    }

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE providerTxnId IN (${inPlaceholders(candidates.length)}) LIMIT 1`,
      candidates,
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem Appmax ativo.
    if (order.paymentGateway && order.paymentGateway !== "appmax") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "appmax"))) return json({ ok: true });

    const raw = await getAppmaxOrderStatus(order.storeId, order.providerTxnId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}

// Extrai todo id numérico (>= 6 dígitos) de qualquer estrutura do payload.
function collectNumericIds(body: unknown): string[] {
  const ids = new Set<string>();
  const stack: unknown[] = [body];
  let guard = 0;
  while (stack.length && guard++ < 1000) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const v of Object.values(cur as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 100000) ids.add(String(v));
      else if (typeof v === "string" && /^\d{6,}$/.test(v)) ids.add(v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return [...ids];
}
