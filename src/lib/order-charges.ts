import "server-only";
import { query, execute, newId } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Histórico de COBRANÇAS por pedido.
//
// `orders.providerTxnId` guarda só a ÚLTIMA. A renovação de Pix sobrescreve
// esse campo, e o id da cobrança anterior some. Se o cliente pagar uma antiga,
// a reconciliação pergunta ao gateway sobre a nova (vencida), ouve "expirado" e
// deixa o pedido pendente — com o dinheiro na conta do lojista.
//
// Aconteceu de verdade: 4 cobranças para a mesma compra, paga a 3ª, pedido
// apontando para a 4ª. Aqui ficam todas.
// ─────────────────────────────────────────────────────────────────────────────

export type OrderCharge = {
  providerTxnId: string;
  gateway: string;
  amountCents: number | null;
  createdAt: Date;
};

/**
 * Registra uma cobrança criada para o pedido. Idempotente pelo índice único
 * (orderId, gateway, providerTxnId).
 *
 * Best-effort de propósito: NUNCA lança. Isto é rastreabilidade — derrubar a
 * geração do Pix porque o histórico falhou seria trocar um problema raro por
 * uma venda perdida na hora.
 */
export async function recordCharge(input: {
  storeId: string;
  orderId: string;
  gateway: string | null;
  providerTxnId: string | null;
  amountCents?: number | null;
}): Promise<void> {
  if (!input.gateway || !input.providerTxnId) return;
  try {
    await execute(
      `INSERT IGNORE INTO order_charges (id, storeId, orderId, gateway, providerTxnId, amountCents)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), input.storeId, input.orderId, input.gateway, input.providerTxnId, input.amountCents ?? null],
    );
  } catch (e) {
    console.error("[recordCharge]", input.orderId, e instanceof Error ? e.message : e);
  }
}

/**
 * Todas as cobranças do pedido, da mais NOVA para a mais antiga.
 *
 * A ordem importa: a mais recente é a que o cliente provavelmente pagou, então
 * ela é consultada primeiro e o caminho comum continua com uma chamada só.
 */
export async function listCharges(storeId: string, orderId: string): Promise<OrderCharge[]> {
  try {
    return await query<OrderCharge>(
      `SELECT providerTxnId, gateway, amountCents, createdAt
         FROM order_charges
        WHERE storeId = ? AND orderId = ?
        ORDER BY createdAt DESC`,
      [storeId, orderId],
    );
  } catch (e) {
    console.error("[listCharges]", orderId, e instanceof Error ? e.message : e);
    return [];
  }
}
