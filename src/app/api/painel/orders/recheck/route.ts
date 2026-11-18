import { z } from "zod";
import { query, execute } from "@/lib/db";
import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { reconcileOrder, NEXT_STATUS } from "@/lib/payments";
import { getAppmaxOrderRaw } from "@/lib/appmax";

export const dynamic = "force-dynamic";

// POST /api/painel/orders/recheck  { orderId }  ou  { providerTxnId }
//
// Pergunta ao GATEWAY o status de UM pedido e liquida se já estiver pago.
//
// A conciliação automática só olha pedidos recentes — 3h no cron, 6h ao abrir a
// aba Vendas. Um Pix pago depois disso, com o webhook perdido, fica PENDENTE
// para sempre: nada volta a consultá-lo. Este endpoint não tem janela, então
// serve para tirar a dúvida de qualquer venda antiga.
//
// Só responde por pedido DA LOJA ATIVA, e devolve o status cru do gateway mesmo
// quando não há mudança — a pergunta "afinal, pagou?" merece resposta explícita.
const schema = z
  .object({
    orderId: z.string().trim().min(1).max(64).optional(),
    providerTxnId: z.string().trim().min(1).max(64).optional(),
    /**
     * Religa o pedido a OUTRA cobrança do mesmo gateway antes de consultar.
     *
     * Existe porque a renovação de Pix sobrescreve o `providerTxnId` e perde o
     * ponteiro da cobrança anterior. Quando o cliente paga uma das antigas, o
     * pedido fica apontando para uma que venceu e a reconsulta responde
     * "expirado" — mesmo com o dinheiro na conta. Aqui o lojista informa o id
     * que aparece como pago no painel do gateway.
     */
    usarTxnId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => v.orderId || v.providerTxnId, { message: "Informe orderId ou providerTxnId." });

type Pedido = {
  id: string;
  storeId: string;
  status: string;
  paymentMethod: string | null;
  providerTxnId: string | null;
  paymentGateway: string | null;
  shopifyOrderId: string | null;
  shopifyDraftId: string | null;
  customerEmail: string | null;
  totalCents: number;
};

export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const { orderId, providerTxnId, usarTxnId } = schema.parse(await req.json());

    const rows = await query<Pedido>(
      `SELECT id, storeId, status, paymentMethod, providerTxnId, paymentGateway,
              shopifyOrderId, shopifyDraftId, customerEmail, totalCents
         FROM orders
        WHERE storeId = ? AND ${orderId ? "id = ?" : "providerTxnId = ?"}
        LIMIT 1`,
      [store.id, orderId ?? providerTxnId],
    );
    const pedido = rows[0];
    if (!pedido) return json({ error: "Pedido não encontrado nesta loja." }, 404);
    if (!pedido.providerTxnId) {
      return json({ error: "Este pedido não chegou a gerar cobrança no gateway." }, 409);
    }

    // Religa o pedido à cobrança indicada, ANTES de consultar. Só em pedido
    // ainda pendente: repontar um pedido já liquidado reescreveria o histórico
    // de uma venda fechada. O id antigo vai para o log — é a única cópia que
    // sobra dele, já que a renovação o apagou da linha.
    const txnAnterior = pedido.providerTxnId;
    let repontado = false;
    if (usarTxnId && usarTxnId !== txnAnterior) {
      if (pedido.status !== "PENDING") {
        return json({ error: "Só dá para religar a cobrança de um pedido pendente." }, 409);
      }
      await execute(`UPDATE orders SET providerTxnId = ?, updatedAt = updatedAt WHERE id = ? AND storeId = ?`, [
        usarTxnId,
        pedido.id,
        pedido.storeId,
      ]);
      console.log(`[recheck] pedido ${pedido.id}: txn ${txnAnterior} -> ${usarTxnId}`);
      pedido.providerTxnId = usarTxnId;
      repontado = true;
    }

    // Varre TODAS as cobranças do pedido e religa sozinho se quem responde for
    // outra. O `usarTxnId` acima continua servindo para o caso em que a
    // cobrança paga nem chegou ao histórico — os pedidos anteriores a ele.
    const { raw: statusGateway, aplicado, religadoDe: religadoAuto } = await reconcileOrder(pedido.storeId, pedido);
    const proximo = statusGateway ? NEXT_STATUS[statusGateway] : undefined;

    // Status CRU do gateway. O traduzido junta `cancelado` e
    // `recusado_por_risco` num "DECLINED" só, e é justamente essa diferença
    // que decide se a conversa é com o cliente ou com o suporte do gateway.
    let cru: unknown = null;
    if (pedido.paymentGateway === "appmax") {
      cru = await getAppmaxOrderRaw(pedido.storeId, pedido.providerTxnId).catch((e) => ({
        erro: e instanceof Error ? e.message : String(e),
      }));
    }

    return json({
      orderId: pedido.id,
      cliente: pedido.customerEmail,
      gateway: pedido.paymentGateway,
      idNoGateway: pedido.providerTxnId,
      ...(repontado || religadoAuto ? { religadoDe: repontado ? txnAnterior : religadoAuto } : {}),
      statusAntes: pedido.status,
      statusNoGateway: statusGateway ?? "(o gateway não respondeu)",
      statusAgora: aplicado ?? pedido.status,
      liquidado: aplicado === "PAID",
      // Por que nada mudou, quando não mudou.
      motivo:
        aplicado
          ? null
          : !proximo
            ? "o gateway não indica desfecho — segue pendente"
            : proximo === "CANCELLED"
              ? "gateway indica recusa/cancelamento, mas pedido Pix não é cancelado (fica recuperável)"
              : "o pedido já estava nesse status",
      gatewayCru: cru,
    });
  } catch (err) {
    return handleError(err);
  }
}
