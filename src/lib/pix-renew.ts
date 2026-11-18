import "server-only";
import { query, execute } from "./db";
import { resolveOrderGateway } from "./settings";
import { recordCharge } from "./order-charges";
import { createProviderPixCharge, getOrderGatewayStatus, settlePixOrder, NEXT_STATUS } from "./payments";

// ─────────────────────────────────────────────────────────────────────────────
// Renovação do Pix expirado.
//
// O e-mail de recuperação chega 15 minutos depois de o cliente sair, e ele pode
// abrir o link horas depois. O Pix, esse, vale 30 minutos. Sem renovar, o
// cliente que decidiu comprar encontra um código morto — a recuperação faz todo
// o trabalho de trazer a pessoa de volta e entrega uma tela que não funciona.
//
// Aqui o código é regerado NA ABERTURA da página, no mesmo pedido.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validade do Pix quando o gateway não informa `pixExpiresAt`.
 * É o mesmo tempo da contagem regressiva que o cliente vê na tela.
 */
export const PIX_VALIDADE_MINUTOS = 30;

type PedidoPix = {
  id: string;
  status: string;
  totalCents: number;
  pixQrCode: string | null;
  pixQrCodeUrl: string | null;
  pixExpiresAt: Date | null;
  createdAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  customerDocument: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  shippingCents: number | null;
  providerTxnId: string | null;
  paymentGateway: string | null;
  expirou: number;
};

export type PixRenovado = { qrCode: string; qrCodeUrl: string | null; expiresAt: Date | null; renovado: boolean };

/**
 * Regenera o Pix se ele tiver expirado. Devolve `null` quando não há nada a
 * fazer — pedido pago, cancelado, ou código ainda válido.
 *
 * Nunca lança: esta função roda no caminho de renderização da página de
 * pagamento, e uma falha na renovação não pode virar tela de erro. No pior caso
 * o cliente vê o código velho, que é o que veria hoje.
 */
export async function renovarPixSeExpirado(storeId: string, orderId: string, host: string): Promise<PixRenovado | null> {
  try {
    const rows = await query<PedidoPix>(
      `SELECT id, status, totalCents, pixQrCode, pixQrCodeUrl, pixExpiresAt, createdAt,
              customerName, customerEmail, customerDocument, customerPhone,
              customerAddress, shippingCents,
              providerTxnId, paymentGateway,
              (COALESCE(pixExpiresAt, DATE_ADD(createdAt, INTERVAL ${PIX_VALIDADE_MINUTOS} MINUTE)) <= NOW(3)) AS expirou
         FROM orders
        WHERE id = ? AND storeId = ? AND paymentMethod = 'PIX'
        LIMIT 1`,
      [orderId, storeId],
    );
    const pedido = rows[0];
    if (!pedido || pedido.status !== "PENDING" || !pedido.expirou) return null;

    // ── ANTES DE GERAR OUTRO: o antigo foi pago? ──
    // O webhook pode ter falhado ou estar atrasado. Gerar um Pix novo para um
    // pedido JÁ PAGO faria o cliente pagar duas vezes — é o pior desfecho
    // possível desta função, e o único que não dá para desfazer sozinho.
    if (pedido.providerTxnId) {
      const bruto = await getOrderGatewayStatus(storeId, {
        paymentMethod: "PIX",
        providerTxnId: pedido.providerTxnId,
        paymentGateway: pedido.paymentGateway,
      }).catch(() => null);
      const proximo = bruto ? NEXT_STATUS[bruto] : undefined;
      if (proximo === "PAID") {
        await settlePixOrder(storeId, { id: pedido.id, shopifyOrderId: null, shopifyDraftId: null }, "PAID").catch(() => {});
        return null;
      }
    }

    // ── RESERVA ──
    // Empurra a expiração 1 minuto para a frente ANTES de chamar o gateway. Duas
    // abas abertas ao mesmo tempo (ou um duplo clique) entrariam aqui juntas e
    // criariam duas cobranças; o UPDATE condicional deixa passar só uma. Se a
    // criação falhar, o minuto expira sozinho e a próxima visita tenta de novo.
    const reserva = await execute(
      `UPDATE orders
          SET pixExpiresAt = DATE_ADD(NOW(3), INTERVAL 1 MINUTE)
        WHERE id = ? AND storeId = ? AND status = 'PENDING'
          AND COALESCE(pixExpiresAt, DATE_ADD(createdAt, INTERVAL ${PIX_VALIDADE_MINUTOS} MINUTE)) <= NOW(3)`,
      [orderId, storeId],
    );
    if (reserva.affectedRows !== 1) return null;

    // Nome que vai ao GATEWAY: o MASCARADO (aba Criptografia) quando houver,
    // igual à primeira cobrança em api/checkout/pix. Até 27/10/2026 a renovação
    // mandava `p.name`, e todo Pix renovado de produto com máscara chegava à
    // Appmax e à Beehive com o nome real.
    const itens = await query<{ id: string; name: string | null; quantity: number; unitPriceCents: number }>(
      `SELECT oi.productId AS id, COALESCE(NULLIF(TRIM(p.maskedName), ''), p.name) AS name,
              oi.quantity, oi.unitPriceCents
         FROM order_items oi LEFT JOIN products p ON p.id = oi.productId
        WHERE oi.orderId = ?`,
      [orderId],
    );

    // Endereço e frete do pedido: a primeira cobrança foi com eles, e o
    // antifraude do gateway compara as duas.
    let endereco: Parameters<typeof createProviderPixCharge>[1]["address"];
    try {
      endereco = pedido.customerAddress ? JSON.parse(pedido.customerAddress) : undefined;
    } catch {
      endereco = undefined;
    }

    // MESMO gateway do pedido original: `resolveOrderGateway` é determinístico
    // pelo orderId, então com split ligado a renovação não muda de casa no meio
    // da venda — o webhook e a conciliação continuam apontando para o mesmo lugar.
    const gateway =
      pedido.paymentGateway ?? (await resolveOrderGateway(storeId, "pix", orderId, Number(pedido.totalCents)));
    const base = host ? `https://${host}` : undefined;

    const charge = await createProviderPixCharge(storeId, {
      amountCents: Number(pedido.totalCents),
      customer: {
        name: pedido.customerName ?? "",
        email: pedido.customerEmail ?? "",
        document: (pedido.customerDocument ?? "").replace(/\D/g, ""),
        phone: pedido.customerPhone ?? "",
      },
      // Mesma descrição da primeira cobrança: o nome (mascarado) do produto.
      description: itens.length
        ? `${itens[0].name || "Compra"}${itens.length > 1 ? ` +${itens.length - 1}` : ""}`
        : `Pedido ${orderId.slice(0, 8).toUpperCase()}`,
      externalReference: orderId,
      checkoutUrl: base ? `${base}/checkout` : undefined,
      postbackUrl: base ? `${base}/api/webhooks/${gateway}` : undefined,
      forceProvider: gateway,
      address: endereco,
      shippingCents: Number(pedido.shippingCents ?? 0),
      additionalInfo: {
        items: itens.map((i) => ({
          id: i.id,
          title: i.name ?? "Item",
          quantity: Number(i.quantity),
          unitPriceCents: Number(i.unitPriceCents),
        })),
      },
    });

    if (!charge?.qrCode) return null;

    // Mesmas defesas do fluxo original: a imagem é opcional (a coluna tem 512
    // chars e alguns gateways devolvem base64), e uma data inválida não pode
    // derrubar o UPDATE que grava o vínculo com a transação.
    const qrCodeUrl = charge.qrCodeUrl && charge.qrCodeUrl.length <= 512 ? charge.qrCodeUrl : null;
    let expiresAt: Date | null = null;
    if (charge.expiresAt) {
      const d = new Date(charge.expiresAt);
      if (Number.isFinite(d.getTime())) expiresAt = d;
    }

    await execute(
      `UPDATE orders
          SET providerTxnId = ?, paymentGateway = ?, pixQrCode = ?, pixQrCodeUrl = ?,
              pixExpiresAt = ${expiresAt ? "?" : `DATE_ADD(NOW(3), INTERVAL ${PIX_VALIDADE_MINUTOS} MINUTE)`}
        WHERE id = ? AND storeId = ?`,
      expiresAt
        ? [charge.id, gateway, charge.qrCode, qrCodeUrl, expiresAt, orderId, storeId]
        : [charge.id, gateway, charge.qrCode, qrCodeUrl, orderId, storeId],
    );

    // Marca a recuperação para o painel mostrar e trazer o pedido para o topo de Vendas.
    // Separado do UPDATE de cima: se a coluna faltar, o Pix novo não pode se perder.
    await execute(`UPDATE orders SET pixRenovadoEm = NOW(3) WHERE id = ? AND storeId = ?`, [orderId, storeId]).catch((e) =>
      console.error("[pix renovado] marcar no pedido:", e instanceof Error ? e.message : e),
    );

    // Guarda a cobrança ANTES de o próximo `providerTxnId` sobrescrever este.
    // Sem isto o id da cobrança anterior some, e um pagamento feito nela fica
    // invisível para a reconciliação.
    await recordCharge({ storeId, orderId, gateway, providerTxnId: charge.id, amountCents: Number(pedido.totalCents) });

    console.log("[pix renovado]", orderId, "gateway:", gateway, "txn:", charge.id);
    return { qrCode: charge.qrCode, qrCodeUrl, expiresAt, renovado: true };
  } catch (e) {
    console.error("[renovarPixSeExpirado]", orderId, e instanceof Error ? e.message : e);
    return null;
  }
}
