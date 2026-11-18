import "server-only";
import { createHash } from "node:crypto";
import { query } from "./db";
import { getGa4ComChave } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// Compra no Google Analytics enviada pelo SERVIDOR (Measurement Protocol).
//
// Pelo navegador, a compra só conta se o cliente chegar à página de obrigado. No
// Pix ele costuma pagar no app do banco e nunca voltar, e essa venda sumia do
// relatório. Daqui ela sai no momento em que o pagamento é confirmado.
//
// Loja com a chave configurada: SÓ o servidor envia o `purchase` (o navegador
// pula, ver `compraNoServidor` em firePurchase). Dois envios da mesma compra
// contariam em dobro, e aqui não dá para saber se o navegador conseguiu enviar.
//
// O Google responde 204 para quase tudo, inclusive chave errada: resposta boa não
// prova que a compra entrou. Quem confere é o relatório Tempo real do GA.
// Doc: https://developers.google.com/analytics/devguides/collection/protocol/ga4
// ─────────────────────────────────────────────────────────────────────────────

const MP = "https://www.google-analytics.com/mp/collect";

/**
 * Sem o client_id (bloqueador de anúncio, pedido anterior à chave), a venda entra
 * mesmo assim, como um visitante próprio e sem origem de campanha: é melhor que
 * sumir do faturamento. Derivado do pedido para ser sempre o mesmo.
 */
function clientIdDoPedido(orderId: string, criadoEm: Date): string {
  const numero = parseInt(createHash("sha256").update(orderId).digest("hex").slice(0, 8), 16);
  return `${numero}.${Math.floor(new Date(criadoEm).getTime() / 1000)}`;
}

async function postar(url: string, corpo: string): Promise<void> {
  // Duas tentativas: uma falha de rede aqui é uma venda a menos no relatório.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: corpo,
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return;
      // Sem a URL no log: ela leva a chave secreta.
      console.error("[ga4-compra] Google respondeu", res.status);
      if (res.status < 500) return;
    } catch (e) {
      console.error("[ga4-compra]", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Envia o `purchase` do pedido para cada Google Analytics da loja com chave. Só
 * deve ser chamada uma vez por pedido (ver settlePixOrder). Best-effort: nunca
 * derruba a confirmação do pagamento.
 */
export async function enviarCompraGa4(storeId: string, orderId: string): Promise<void> {
  try {
    const destinos = await getGa4ComChave(storeId);
    if (destinos.length === 0) return;

    const [o] = await query<{ totalCents: number; shippingCents: number; createdAt: Date; trackingParams: string | null }>(
      `SELECT totalCents, shippingCents, createdAt, trackingParams FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    if (!o) return;
    const itens = await query<{ id: string; name: string; quantity: number; unitPriceCents: number }>(
      `SELECT p.id AS id, p.name AS name, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents
         FROM order_items oi JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`,
      [orderId],
    );

    let visita: Record<string, string> = {};
    try {
      visita = o.trackingParams ? JSON.parse(o.trackingParams) : {};
    } catch {
      /* json inválido: entra sem a visita */
    }

    for (const { idMetrica, chave } of destinos) {
      const sessao = visita[`ga_sid_${idMetrica}`];
      const corpo = JSON.stringify({
        client_id: visita.ga_cid || clientIdDoPedido(orderId, o.createdAt),
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: orderId,
              value: Number(o.totalCents) / 100,
              currency: "BRL",
              shipping: Number(o.shippingCents ?? 0) / 100,
              // Sem o session_id, a compra não herda a origem da campanha da visita.
              ...(sessao ? { session_id: sessao } : {}),
              // Sem isto, o GA pode não contar a atividade do visitante nos relatórios.
              engagement_time_msec: 1,
              // O limite do GA é de 100 caracteres por valor.
              items: itens.map((i) => ({
                item_id: i.id,
                item_name: i.name.slice(0, 100),
                price: i.unitPriceCents / 100,
                quantity: i.quantity,
              })),
            },
          },
        ],
      });
      await postar(`${MP}?measurement_id=${encodeURIComponent(idMetrica)}&api_secret=${encodeURIComponent(chave)}`, corpo);
    }
  } catch (e) {
    console.error("[enviarCompraGa4]", e instanceof Error ? e.message : e);
  }
}
