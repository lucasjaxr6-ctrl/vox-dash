import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getFintpagTransactionStatus } from "@/lib/fintpag";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/fintpag
// Postback da FintPag. NÃO confiamos no corpo: usamos só o id da transação para
// RE-CONSULTAR o status em GET /v1/transactions/{id} (fonte da verdade). Sempre 2xx.
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}) as any);

    const candidates = collectIds(body);
    const qp = (url.searchParams.get("id") || "").trim();
    if (qp) candidates.push(qp);
    if (candidates.length === 0) {
      console.error("[fintpag webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ ok: true });
    }

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE providerTxnId IN (${inPlaceholders(candidates.length)}) LIMIT 1`,
      candidates,
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem FintPag ativo.
    if (order.paymentGateway && order.paymentGateway !== "fintpag") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "fintpag"))) return json({ ok: true });

    const raw = await getFintpagTransactionStatus(order.storeId, order.providerTxnId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}

// Coleta ids candidatos (inteiros >= 6 dígitos / strings numéricas) do payload.
function collectIds(body: unknown): string[] {
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
