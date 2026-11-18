import { requireStore } from "@/lib/stores";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { reconcileOrder } from "@/lib/payments";

// POST /api/painel/reconcile
// Reconciliação da LOJA ATIVA (sem cron): re-consulta os pedidos pendentes
// recentes no gateway e liquida os que já foram pagos/cancelados. Chamado quando
// o lojista abre a aba Vendas — assim ele sempre vê o status correto.
export async function POST() {
  try {
    const { store } = await requireStore();

    const rows = await query<{
      id: string; storeId: string; status: string; paymentMethod: string | null;
      providerTxnId: string | null; paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null;
    }>(
      `SELECT id, storeId, status, paymentMethod, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
       FROM orders
       WHERE storeId = ? AND status = 'PENDING' AND providerTxnId IS NOT NULL
         AND createdAt >= DATE_SUB(NOW(), INTERVAL 6 HOUR)
       ORDER BY createdAt DESC LIMIT 40`,
      [store.id],
    );

    let settled = 0;
    for (const o of rows) {
      try {
        // Consulta todas as cobranças do pedido — ver `reconcileOrder`.
        const { aplicado } = await reconcileOrder(o.storeId, o);
        if (aplicado) settled++;
      } catch {
        /* um pedido não derruba a reconciliação */
      }
    }
    return json({ ok: true, checked: rows.length, settled });
  } catch (err) {
    return handleError(err);
  }
}
