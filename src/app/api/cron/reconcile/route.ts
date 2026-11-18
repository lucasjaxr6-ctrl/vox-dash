import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { reconcileOrder } from "@/lib/payments";

// GET/POST /api/cron/reconcile
// Rede de segurança para webhooks perdidos: pega os pedidos PENDENTES recentes
// (com id de transação no gateway) e RE-CONSULTA o status na fonte da verdade —
// quem estiver pago/cancelado é liquidado. Cobre todos os gateways.
//
// Protegido por CRON_SECRET (a Vercel manda "Authorization: Bearer <CRON_SECRET>"
// nos cron jobs; um pinger externo pode usar o mesmo segredo).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const url = new URL(req.url);
    const qs = url.searchParams.get("secret") || "";
    if (auth !== `Bearer ${secret}` && qs !== secret) {
      return json({ error: "unauthorized" }, 401);
    }
  }

  // Pendentes recentes com transação no gateway. Janela de 3h: um pago normal
  // já liquidou por webhook em segundos; aqui pegamos os que escaparam.
  const rows = await query<{
    id: string; storeId: string; status: string; paymentMethod: string | null;
    providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null;
  }>(
    `SELECT id, storeId, status, paymentMethod, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
     FROM orders
     WHERE status = 'PENDING' AND providerTxnId IS NOT NULL
       AND createdAt >= DATE_SUB(NOW(), INTERVAL 3 HOUR)
     ORDER BY createdAt DESC
     LIMIT 100`,
  );

  let checked = 0;
  let settled = 0;
  for (const o of rows) {
    checked++;
    try {
      // Olha TODAS as cobranças do pedido: a renovação de Pix troca o
      // `providerTxnId`, e um pagamento feito numa cobrança anterior ficaria
      // invisível se consultássemos só a atual.
      const { aplicado } = await reconcileOrder(o.storeId, o);
      if (aplicado) settled++;
    } catch {
      /* um pedido não pode derrubar a reconciliação inteira */
    }
  }

  return json({ ok: true, checked, settled });
}

export const GET = handle;
export const POST = handle;
