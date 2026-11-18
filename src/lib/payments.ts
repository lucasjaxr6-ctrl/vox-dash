import "server-only";
import { execute } from "./db";
import { getPaymentRouting, getStoreName } from "./settings";
import { notifySale } from "./notifications";
import { dispararEmail } from "./email-agenda";
import { registrarTaxa, cancelarTaxa } from "./platform-fees";
import { sendUtmifyOrder } from "./utmify";
import { enviarCompraGa4 } from "./ga4-compra";
import { enviarCompraMeta } from "./meta-compra";
import { completeShopifyDraftOrder, markShopifyOrderPaid } from "./shopify";
import * as mercadopago from "./mercadopago";
import * as pinpay from "./pinpay";
import * as appmax from "./appmax";
import * as freepay from "./freepay";
import * as hypercash from "./hypercash";
import * as fintpag from "./fintpag";
import * as hylexpay from "./hylexpay";
import * as beehive from "./beehive";
import * as pagniv from "./pagniv";
import * as vext from "./vext";
import * as mushpag from "./mushpag";
import * as blackcat from "./blackcat";
import * as pagarme from "./pagarme";
import * as veopag from "./veopag";
import * as mangofy from "./mangofy";
import * as nuvra from "./nuvra";
import * as bluevision from "./bluevision";
import * as pixgo from "./pixgo";
import * as pagou from "./pagou";
import * as pushinpay from "./pushinpay";
import * as wappi from "./wappi";
import type { PixCharge, PixCustomer } from "./pix-types";
import { listCharges } from "./order-charges";
import { empilharRecusa } from "./card-tentativas";

// ─────────────────────────────────────────────────────────────────────────────
// Camada de provedor de pagamento (Pix). Cada loja escolhe o gateway no
// painel. Todo o resto do app fala com estas funções, sem
// saber qual gateway está por trás. O status é normalizado para o MESMO
// vocabulário (APPROVED / DECLINED / REFUNDED / CHARGEBACK / PENDING).
// ─────────────────────────────────────────────────────────────────────────────

export async function createProviderPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    checkoutUrl?: string;
    statementDescriptor?: string;
    payerIp?: string;
    notificationUrl?: string;
    postbackUrl?: string;
    additionalInfo?: mercadopago.CardAdditionalInfo;
    shippingCents?: number;
    // UTMs da sessão (a PushinPay aceita atribuição na própria cobrança).
    tracking?: Record<string, string | null | undefined>;
    // Força o gateway (usado pelo split, que decide 1 gateway por pedido).
    forceProvider?: string | null;
    address?: { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
  },
): Promise<PixCharge> {
  const pixProvider = input.forceProvider ?? (await getPaymentRouting(storeId)).pixProvider;
  if (pixProvider === "mercadopago") return mercadopago.createPixCharge(storeId, input);
  if (pixProvider === "appmax") {
    return appmax.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      // Itens reais (nome mascarado, qtd, preço) + frete p/ aparecer no painel Appmax.
      // `productId` define o SKU lá (1 SKU por produto, nunca por nome).
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents, productId: it.id })),
      shippingCents: input.shippingCents,
    });
  }
  if (pixProvider === "freepay") {
    return freepay.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      postbackUrl: input.postbackUrl,
    });
  }
  if (pixProvider === "wappi") {
    // A rota manda o postback de outro gateway: deriva o host e troca o caminho.
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return wappi.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      postbackUrl: host ? `${host}/api/webhooks/wappi` : undefined,
    });
  }
  if (pixProvider === "hypercash") {
    // O postback tem que apontar para o webhook da HyperCash (a rota manda a URL
    // genérica de outro gateway); derivamos o host e trocamos o caminho.
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return hypercash.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      shippingCents: input.shippingCents,
      // Identificação da origem: a HyperCash exige o pedido, o site e o checkout
      // na transação (bloquearam a conta por transações sem isso).
      externalReference: input.externalReference,
      checkoutUrl: input.checkoutUrl,
      postbackUrl: host ? `${host}/api/webhooks/hypercash` : undefined,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "vext") {
    // Sem postbackUrl: na Vext o endpoint de webhook é cadastrado uma vez na
    // conta, não por cobrança. O que casa o evento com o pedido é `reference`.
    return vext.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      externalReference: input.externalReference,
      checkoutUrl: input.checkoutUrl,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "blackcat") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return blackcat.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      // externalRef = nosso orderId: volta no webhook e casa o evento com o pedido.
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/blackcat` : undefined,
      address: input.address,
      shippingCents: input.shippingCents,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
      tracking: input.tracking,
    });
  }
  if (pixProvider === "pagarme") {
    // Sem postbackUrl: na Pagar.me o webhook é cadastrado uma vez no painel da
    // conta. O que casa o evento com o pedido é o `code` (= nosso orderId).
    return pagarme.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
      address: input.address,
      shippingCents: input.shippingCents,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents, code: it.id })),
    });
  }
  if (pixProvider === "veopag") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return veopag.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      // Vira `<orderId>.<sufixo>` lá dentro: o external_id é idempotente na
      // VeoPag, e a renovação de Pix precisa de uma cobrança nova.
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/veopag` : undefined,
      tracking: input.tracking,
    });
  }
  if (pixProvider === "mangofy") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return mangofy.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/mangofy` : undefined,
      // Obrigatório na MangoFy (customer.ip).
      payerIp: input.payerIp,
      address: input.address,
      shippingCents: input.shippingCents,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents, code: it.id })),
      tracking: input.tracking,
    });
  }
  if (pixProvider === "bluevision") {
    // postbackUrl por cobrança (a doc aceita), derivado do host como nos demais.
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return bluevision.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/bluevision` : undefined,
      address: input.address,
      shippingCents: input.shippingCents,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "nuvra") {
    // Sem postbackUrl: na Nuvra o webhook é cadastrado uma vez, no painel
    // deles. O evento traz o `externalReference`, que começa pelo id do pedido.
    return nuvra.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
    });
  }
  if (pixProvider === "pagniv") {
    // Sem postbackUrl na criação: na PagNiv o webhook é cadastrado UMA VEZ por
    // conta (POST /v1/webhook-config), não por cobrança. O que casa o evento com
    // o pedido é o `externalId`, que vai aqui.
    return pagniv.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
    });
  }
  if (pixProvider === "beehive") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return beehive.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      shippingCents: input.shippingCents,
      // `metadata` é OBRIGATÓRIO na Beehive e leva o pedido, o checkout e a
      // vitrine — sem ele a transação é recusada na validação.
      externalReference: input.externalReference,
      checkoutUrl: input.checkoutUrl,
      postbackUrl: host ? `${host}/api/webhooks/beehive` : undefined,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "fintpag") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return fintpag.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/fintpag` : undefined,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "hylexpay") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return hylexpay.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/hylexpay` : undefined,
      items: input.additionalInfo?.items?.map((it) => ({ name: it.title, quantity: it.quantity, unitPriceCents: it.unitPriceCents })),
    });
  }
  if (pixProvider === "pixgo") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return pixgo.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      externalReference: input.externalReference,
      postbackUrl: host ? `${host}/api/webhooks/pixgo` : undefined,
    });
  }
  if (pixProvider === "mushpag") {
    // Sem postbackUrl: na MushPag o webhook é cadastrado uma vez na conta, pela
    // API (o teste da chave faz isso). O evento traz só o id da cobrança, que
    // casa com providerTxnId ou com o histórico em order_charges.
    return mushpag.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference,
      address: input.address,
    });
  }
  if (pixProvider === "pagou") {
    // O postbackUrl que chega aqui aponta para o webhook de outro gateway;
    // derivamos o host e trocamos o caminho (mesmo padrão dos demais).
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return pagou.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      payerIp: input.payerIp,
      address: input.address,
      // external_ref = id do pedido: é a chave de idempotência da Pagou e o
      // go-live deles exige persistir isso em toda criação.
      externalReference: input.externalReference,
      checkoutUrl: input.checkoutUrl,
      storeName: await getStoreName(storeId).catch(() => undefined),
      shippingCents: input.shippingCents,
      postbackUrl: host ? `${host}/api/webhooks/pagou` : undefined,
      items: input.additionalInfo?.items?.map((it) => ({
        name: it.title,
        quantity: it.quantity,
        unitPriceCents: it.unitPriceCents,
        sku: it.id, // id do produto no nosso catálogo
      })),
    });
  }
  if (pixProvider === "pushinpay") {
    const host = (input.postbackUrl || input.notificationUrl || "").replace(/\/api\/webhooks\/.*/, "");
    return pushinpay.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      externalReference: input.externalReference,
      // Sem nome de loja: a `description` (único lugar onde ele caberia) não é
      // enviada — ela é a mensagem que o comprador lê no app do banco.
      tracking: input.tracking,
      postbackUrl: host ? `${host}/api/webhooks/pushinpay` : undefined,
    });
  }
  if (pixProvider === "pinpay") {
    return pinpay.createPixCharge(storeId, {
      amountCents: input.amountCents,
      customer: input.customer,
      description: input.description,
      externalReference: input.externalReference ?? "",
      checkoutUrl: input.checkoutUrl ?? "",
    });
  }
  throw new Error("Pix indisponível para esta loja.");
}

export async function getProviderTransactionStatus(storeId: string, txnId: string): Promise<string | null> {
  const { pixProvider } = await getPaymentRouting(storeId);
  if (pixProvider === "mercadopago") return mercadopago.getMercadoPagoPaymentStatus(storeId, txnId);
  if (pixProvider === "pinpay") return pinpay.getPinPayPaymentStatus(storeId, txnId);
  if (pixProvider === "appmax") return appmax.getAppmaxOrderStatus(storeId, txnId);
  if (pixProvider === "freepay") return freepay.getFreepayTransactionStatus(storeId, txnId);
  if (pixProvider === "hypercash") return hypercash.getHypercashTransactionStatus(storeId, txnId);
  if (pixProvider === "fintpag") return fintpag.getFintpagTransactionStatus(storeId, txnId);
  if (pixProvider === "hylexpay") return hylexpay.getHylexpayTransactionStatus(storeId, txnId);
  if (pixProvider === "beehive") return beehive.getBeehiveTransactionStatus(storeId, txnId);
  if (pixProvider === "pagniv") return pagniv.getPagnivTransactionStatus(storeId, txnId);
  if (pixProvider === "vext") return vext.getVextTransactionStatus(storeId, txnId);
  if (pixProvider === "blackcat") return blackcat.getBlackcatTransactionStatus(storeId, txnId);
  if (pixProvider === "pagarme") return pagarme.getPagarmeTransactionStatus(storeId, txnId);
  if (pixProvider === "veopag") return veopag.getVeopagTransactionStatus(storeId, txnId);
  if (pixProvider === "mangofy") return mangofy.getMangofyTransactionStatus(storeId, txnId);
  if (pixProvider === "nuvra") return nuvra.getNuvraTransactionStatus(storeId, txnId);
  if (pixProvider === "bluevision") return bluevision.getBluevisionTransactionStatus(storeId, txnId);
  if (pixProvider === "pixgo") return pixgo.getPixgoTransactionStatus(storeId, txnId);
  if (pixProvider === "mushpag") return mushpag.getMushpagTransactionStatus(storeId, txnId);
  if (pixProvider === "pagou") return pagou.getPagouTransactionStatus(storeId, txnId);
  if (pixProvider === "pushinpay") return pushinpay.getPushinpayTransactionStatus(storeId, txnId);
  if (pixProvider === "wappi") return wappi.getWappiTransactionStatus(storeId, txnId);
  return null;
}

/**
 * Status normalizado de um pedido consultando o gateway CERTO conforme o método:
 * Pix usa o pixProvider; cartão usa o cardProvider. Usado pela reconciliação
 * (rede de segurança para webhooks que não chegaram). Retorna null se não der
 * para consultar (gateway removido ou sem consulta de status).
 */
export async function getOrderGatewayStatus(
  storeId: string,
  order: { paymentMethod: string | null; providerTxnId: string | null; paymentGateway?: string | null },
): Promise<string | null> {
  if (!order.providerTxnId) return null;
  // Fonte da verdade: o gateway que PROCESSOU este pedido (essencial com split,
  // em que cada pedido pode ter caído num gateway diferente). Só cai no
  // roteamento atual para pedidos legados sem gateway gravado.
  let provider: string | null = order.paymentGateway ?? null;
  if (!provider) {
    const routing = await getPaymentRouting(storeId);
    provider = order.paymentMethod === "CREDIT_CARD" ? routing.cardProvider : routing.pixProvider;
  }
  const txn = order.providerTxnId;
  switch (provider) {
    case "freepay": return freepay.getFreepayTransactionStatus(storeId, txn);
    case "wappi": return wappi.getWappiTransactionStatus(storeId, txn);
    case "hypercash": return hypercash.getHypercashTransactionStatus(storeId, txn);
    case "fintpag": return fintpag.getFintpagTransactionStatus(storeId, txn);
    case "hylexpay": return hylexpay.getHylexpayTransactionStatus(storeId, txn);
    case "beehive": return beehive.getBeehiveTransactionStatus(storeId, txn);
    case "pagniv": return pagniv.getPagnivTransactionStatus(storeId, txn);
    case "vext": return vext.getVextTransactionStatus(storeId, txn);
    case "blackcat": return blackcat.getBlackcatTransactionStatus(storeId, txn);
    case "pagarme": return pagarme.getPagarmeTransactionStatus(storeId, txn);
    case "veopag": return veopag.getVeopagTransactionStatus(storeId, txn);
    case "mangofy": return mangofy.getMangofyTransactionStatus(storeId, txn);
    case "nuvra": return nuvra.getNuvraTransactionStatus(storeId, txn);
    case "bluevision": return bluevision.getBluevisionTransactionStatus(storeId, txn);
    case "pixgo": return pixgo.getPixgoTransactionStatus(storeId, txn);
    case "mushpag": return mushpag.getMushpagTransactionStatus(storeId, txn);
    case "pagou": return pagou.getPagouTransactionStatus(storeId, txn);
    case "pushinpay": return pushinpay.getPushinpayTransactionStatus(storeId, txn);
    case "appmax": return appmax.getAppmaxOrderStatus(storeId, txn);
    case "mercadopago": return mercadopago.getMercadoPagoPaymentStatus(storeId, txn);
    case "pinpay": return pinpay.getPinPayPaymentStatus(storeId, txn);
    // Pedidos antigos de gateways removidos (transfyre, infinitepay) caem aqui:
    // a reconciliação não tem mais como consultá-los.
    default: return null;
  }
}

/**
 * Status do pedido consultando TODAS as cobranças dele, não só a última.
 *
 * A renovação de Pix cria uma cobrança nova e sobrescreve `providerTxnId`. Se o
 * cliente pagar uma anterior, perguntar só pela atual responde "expirado" com o
 * dinheiro já na conta — foi o que aconteceu num caso real de 4 cobranças para
 * a mesma compra, paga a 3ª.
 *
 * Barato no caso comum: tenta primeiro a cobrança que está no pedido e só varre
 * o histórico se ela NÃO resolver. Pedido com uma cobrança só segue com uma
 * chamada ao gateway, como antes.
 *
 * Devolve também o txn que respondeu, para o chamador religar o pedido à
 * cobrança certa — senão o rastreio e o estorno iriam para a errada.
 */
export async function getOrderStatusFromAnyCharge(
  storeId: string,
  order: { id: string; paymentMethod: string | null; providerTxnId: string | null; paymentGateway?: string | null },
): Promise<{ raw: string | null; txnId: string | null }> {
  const atual = await getOrderGatewayStatus(storeId, order);
  // Só um desfecho encerra a busca. "PENDING" pode ser uma cobrança vencida
  // enquanto outra do mesmo pedido foi paga.
  if (atual && NEXT_STATUS[atual]) return { raw: atual, txnId: order.providerTxnId };

  const cobrancas = await listCharges(storeId, order.id);
  for (const c of cobrancas) {
    if (c.providerTxnId === order.providerTxnId) continue; // já consultada
    const raw = await getOrderGatewayStatus(storeId, {
      paymentMethod: order.paymentMethod,
      providerTxnId: c.providerTxnId,
      paymentGateway: c.gateway,
    });
    if (raw && NEXT_STATUS[raw] === "PAID") {
      console.log(`[cobranças] pedido ${order.id}: paga na cobrança ${c.providerTxnId}, não na ${order.providerTxnId}`);
      return { raw, txnId: c.providerTxnId };
    }
  }
  return { raw: atual, txnId: order.providerTxnId };
}

/**
 * Consulta o pedido em todas as cobranças e liquida se houver desfecho.
 *
 * Quando quem responde é uma cobrança diferente da gravada, RELIGA o pedido a
 * ela antes de liquidar: o rastreio, o estorno e qualquer webhook posterior
 * precisam apontar para a cobrança que tem o dinheiro. `updatedAt = updatedAt`
 * evita reiniciar o relógio de silêncio que decide carrinho abandonado.
 */
export async function reconcileOrder(
  storeId: string,
  order: SettleOrder & {
    paymentMethod: string | null;
    providerTxnId: string | null;
    paymentGateway?: string | null;
  },
): Promise<{ raw: string | null; aplicado: "PAID" | "CANCELLED" | null; religadoDe?: string | null }> {
  const { raw, txnId } = await getOrderStatusFromAnyCharge(storeId, order);
  let religadoDe: string | null = null;
  if (txnId && txnId !== order.providerTxnId) {
    religadoDe = order.providerTxnId;
    await execute(`UPDATE orders SET providerTxnId = ?, updatedAt = updatedAt WHERE id = ? AND storeId = ?`, [
      txnId,
      order.id,
      storeId,
    ]);
    order.providerTxnId = txnId;
  }
  const next = raw ? NEXT_STATUS[raw] : undefined;
  const aplicado = next ? await settlePixOrder(storeId, order, next, { estorno: ehEstorno(raw) }) : null;
  return { raw, aplicado, ...(religadoDe ? { religadoDe } : {}) };
}

/**
 * Envia o código de rastreio para o gateway que PROCESSOU o pedido. Usa o
 * `paymentGateway` gravado no pedido (fonte da verdade) — assim, mesmo após
 * migrar de gateway, o rastreio dos pedidos antigos vai pro lugar certo. Pedidos
 * legados (sem gateway gravado) caem no fallback: tenta os gateways que aceitam
 * rastreio (cada um se auto-protege e ignora id que não é dele). Best-effort.
 */
export async function pushGatewayTracking(
  storeId: string,
  order: { providerTxnId: string | null; paymentGateway: string | null },
  trackingCode: string,
): Promise<void> {
  const txn = order.providerTxnId;
  if (!txn || !trackingCode) return;
  switch (order.paymentGateway) {
    case "appmax":
      await appmax.setAppmaxTrackingCode(storeId, txn, trackingCode);
      return;
    case "hypercash":
      await hypercash.setHypercashTracking(storeId, txn, trackingCode);
      return;
    case "hylexpay":
      await hylexpay.setHylexpayTracking(storeId, txn, trackingCode);
      return;
    case "fintpag":
      await fintpag.setFintpagTracking(storeId, txn, trackingCode);
      return;
    case "bluevision":
      await bluevision.setBluevisionTracking(storeId, txn, trackingCode);
      return;
    case "beehive":
    case "pagniv":
    case "vext":
    case "blackcat":
    case "pagarme":
    case "veopag":
    case "mangofy":
    case "nuvra":
    case "freepay":
    case "wappi":
    case "mercadopago":
    case "pinpay":
    case "pixgo":
    case "mushpag":
    case "pagou":
    case "pushinpay":
      // Esses gateways não têm push de rastreio documentado — nada a fazer.
      // (Beehive: a doc pública não expõe endpoint de rastreio/entrega.)
      return;
    default:
      // Legado (sem gateway gravado): tenta os que aceitam rastreio.
      await Promise.all([
        appmax.setAppmaxTrackingCode(storeId, txn, trackingCode),
        hypercash.setHypercashTracking(storeId, txn, trackingCode),
      ]);
  }
}

// Status normalizado -> transição interna do pedido.
export const NEXT_STATUS: Record<string, "PAID" | "CANCELLED"> = {
  APPROVED: "PAID",
  DECLINED: "CANCELLED",
  REFUNDED: "CANCELLED",
  CHARGEBACK: "CANCELLED",
};

type SettleOrder = { id: string; shopifyOrderId: string | null; shopifyDraftId: string | null };

/**
 * Aplica a transição de status do pedido de forma IDEMPOTENTE (só age na
 * mudança real) e propaga para a Shopify + notificações. Usado tanto pelo
 * polling do checkout quanto pelos webhooks dos gateways.
 * Retorna o status aplicado ("PAID" | "CANCELLED") ou null se nada mudou.
 */
export async function settlePixOrder(
  storeId: string,
  order: SettleOrder,
  next: "PAID" | "CANCELLED",
  opts: { estorno?: boolean } = {},
): Promise<"PAID" | "CANCELLED" | null> {
  // Pix expirado/cancelado NÃO cancela o pedido — fica PENDING (recuperável em
  // Carrinhos abandonados). Só cartão recusado vira CANCELLED. Estorno confirmado é
  // outra coisa: o dinheiro de um Pix pago voltou, então vale para ele também.
  // Pedido já ENVIADO continua enviado: um aviso de pagamento repetido pelo gateway
  // não pode voltá-lo para PAID, o que reenviava ao cliente os e-mails de pagamento
  // e de preparação. Estorno e chargeback (CANCELLED) seguem valendo depois de enviado.
  const guarda = next === "CANCELLED" ? (opts.estorno ? "" : " AND paymentMethod <> 'PIX'") : " AND status <> 'SHIPPED'";
  const upd = await execute(`UPDATE orders SET status = ? WHERE id = ? AND status <> ?${guarda}`, [next, order.id, next]);
  const changed = upd.affectedRows > 0;

  // Marca QUANDO foi pago (uma vez) — usado pelo cron do e-mail "em separação".
  if (next === "PAID" && changed) {
    const pago = await execute(`UPDATE orders SET paidAt = NOW(3) WHERE id = ? AND paidAt IS NULL`, [order.id]);
    // Google Analytics e Meta: só na PRIMEIRA vez que o pedido é pago na vida dele.
    // `changed` sozinho não garante isso: um pedido estornado e pago de novo, por
    // exemplo, contaria em dobro.
    if (pago.affectedRows > 0) await Promise.all([enviarCompraGa4(storeId, order.id), enviarCompraMeta(storeId, order.id)]);
  }

  // Utmify: espelha a transição no funil de vendas (best-effort).
  if (changed) {
    await sendUtmifyOrder(storeId, order.id, next === "PAID" ? "paid" : "refused");
  }

  // Recusa: avisa os webhooks inscritos (só na transição real).
  if (next === "CANCELLED" && changed) {
    // Recusa que chegou depois (cartão em análise, webhook): empilha com a
    // tentativa anterior do mesmo cartão, como na recusa na hora. Pedido sem
    // cartão gravado (Pix) é ignorado lá dentro.
    await empilharRecusa(storeId, order.id);
    await notifySale(storeId, order.id, "order_refused");
    // Estorno/chargeback desfaz a taxa ainda não paga: cobrar comissão de
    // venda que voltou seria cobrar o lojista por dinheiro que ele não tem.
    await cancelarTaxa(order.id);
  }

  if (next === "PAID") {
    if (changed) {
      await notifySale(storeId, order.id, "order_paid");
      // E-mails ao cliente (best-effort), no tempo que a loja configurou.
      await dispararEmail(storeId, order.id, "paid");
      await dispararEmail(storeId, order.id, "separation");
    }
    // Taxa da plataforma. FORA do `changed` de propósito: é idempotente por
    // UNIQUE(orderId), e assim um pedido que virou pago por outro caminho
    // (conciliação, recheck manual) também entra na conta.
    await registrarTaxa(storeId, order.id);

    // Marca o pedido da Shopify como pago (ou completa o rascunho legado).
    try {
      if (order.shopifyOrderId) {
        await markShopifyOrderPaid(storeId, order.shopifyOrderId);
      } else if (order.shopifyDraftId) {
        const realId = await completeShopifyDraftOrder(storeId, order.shopifyDraftId, false);
        if (realId) await execute(`UPDATE orders SET shopifyOrderId = ? WHERE id = ?`, [realId, order.id]);
      }
    } catch (e) {
      console.error("[settlePixOrder -> shopify]", e);
    }
  }
  return changed ? next : null;
}

export const ehEstorno = (status: string | null | undefined): boolean => status === "REFUNDED" || status === "CHARGEBACK";

/**
 * Aplica o status que o gateway confirmou na re-consulta. É o caminho dos webhooks.
 *
 * Pedido PAGO só muda por estorno ou chargeback. Antes as rotas ignoravam qualquer
 * aviso de pedido pago, e um estorno só era reconhecido depois de o pedido ser
 * enviado. "Recusado" e "expirado" continuam sem efeito aqui: com Pix renovado, a
 * cobrança antiga expira normalmente mesmo com o pedido pago. Um aviso de pago
 * repetido também para aqui, sem refazer Shopify e taxa.
 */
export async function aplicarStatusDoGateway(
  storeId: string,
  order: SettleOrder & { status: string },
  statusGateway: string | null | undefined,
): Promise<"PAID" | "CANCELLED" | null> {
  const estorno = ehEstorno(statusGateway);
  if (order.status === "PAID" && !estorno) return null;
  const next = statusGateway ? NEXT_STATUS[statusGateway] : undefined;
  return next ? settlePixOrder(storeId, order, next, { estorno }) : null;
}
