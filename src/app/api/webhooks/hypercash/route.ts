import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getHypercashTransactionStatus } from "@/lib/hypercash";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/hypercash
// Postback da HyperCash. NÃO confiamos no corpo: usamos só o id da transação para
// RE-CONSULTAR o status em GET /api/user/transactions/{id} (autenticado com a
// chave da loja), que é a fonte da verdade — assim um webhook forjado não marca
// como pago. Sempre respondemos 2xx (a HyperCash re-tenta em caso de falha).
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}) as any);

    // O id da transação pode vir em vários campos (id, transactionId, hash, data.id...).
    // Coletamos os candidatos e casamos com o providerTxnId dos pedidos.
    const candidates = collectIds(body);
    const qp = (url.searchParams.get("id") || "").trim();
    if (qp) candidates.push(qp);
    if (candidates.length === 0) {
      console.error("[hypercash webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ ok: true });
    }

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders WHERE providerTxnId IN (${inPlaceholders(candidates.length)}) LIMIT 1`,
      candidates,
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: só processa se o pedido é DESTE gateway e a loja tem HyperCash ativo.
    if (order.paymentGateway && order.paymentGateway !== "hypercash") return json({ ok: true });
    if (!(await isGatewayActive(order.storeId, "hypercash"))) return json({ ok: true });

    const raw = await getHypercashTransactionStatus(order.storeId, order.providerTxnId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}

// Coleta ids candidatos (números inteiros e strings alfanuméricas de 6-64 chars)
// de qualquer estrutura do payload, sem depender do nome do campo.
function collectIds(body: unknown): string[] {
  const ids = new Set<string>();
  const stack: unknown[] = [body];
  let guard = 0;
  while (stack.length && guard++ < 1000) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const v of Object.values(cur as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isInteger(v) && v >= 100000) ids.add(String(v));
      else if (typeof v === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(v)) ids.add(v);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return [...ids];
}
