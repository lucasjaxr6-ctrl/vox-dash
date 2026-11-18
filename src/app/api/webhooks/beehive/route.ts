import { query, inPlaceholders } from "@/lib/db";
import { json } from "@/lib/http";
import { getBeehiveTransactionStatus } from "@/lib/beehive";
import { aplicarStatusDoGateway } from "@/lib/payments";
import { isGatewayActive } from "@/lib/settings";

// POST /api/webhooks/beehive
//
// Postback da Beehive. NÃO confiamos no corpo: dele tiramos apenas o id da
// transação e RE-CONSULTAMOS o status em GET /v1/transactions/{id}, autenticado
// com a chave da loja — assim um postback forjado não marca pedido como pago.
// Sempre respondemos 2xx (eles re-tentam em caso de falha).
//
// Formato (doc): { id, type, objectId, url, data: { id, status, ... } }
// `type` é "transaction" | "checkout" | "transfer".
export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as any;

    // SÓ eventos de transação. Isto não é zelo: os ids da Beehive são inteiros
    // pequenos e sequenciais (o exemplo da doc traz transação 282 e
    // transferência 237), então um postback de TRANSFERÊNCIA casaria com o
    // providerTxnId de outro pedido e liquidaria a venda errada.
    const tipo = String(body?.type ?? "").toLowerCase();
    if (tipo && tipo !== "transaction") return json({ ok: true });

    const candidates: string[] = [];
    const push = (v: unknown) => {
      const s = String(v ?? "").trim();
      if (s && /^[A-Za-z0-9_-]{1,64}$/.test(s)) candidates.push(s);
    };
    push(body?.data?.id);
    push(body?.objectId);
    push(url.searchParams.get("id"));
    if (candidates.length === 0) {
      console.error("[beehive webhook] sem id no corpo:", JSON.stringify(body).slice(0, 400));
      return json({ ok: true });
    }

    const rows = await query<{ id: string; storeId: string; status: string; providerTxnId: string; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null }>(
      `SELECT id, storeId, status, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
         FROM orders
        WHERE providerTxnId IN (${inPlaceholders(candidates.length)})
          AND paymentGateway = 'beehive'
        LIMIT 1`,
      candidates,
    );
    const order = rows[0];
    if (!order || order.status === "CANCELLED") return json({ ok: true });

    // BLOQUEIO: a loja precisa ter a Beehive ativa (defesa contra abuso do
    // endpoint mesmo com credencial salva).
    if (!(await isGatewayActive(order.storeId, "beehive"))) return json({ ok: true });

    const raw = await getBeehiveTransactionStatus(order.storeId, order.providerTxnId);
    await aplicarStatusDoGateway(order.storeId, order, raw);

    return json({ ok: true });
  } catch {
    return json({ ok: true });
  }
}
