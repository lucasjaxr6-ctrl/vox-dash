import "server-only";
import { query } from "./db";
import { motivoDoCartao } from "./customer-errors";

// Detalhe de um pedido para o PAINEL DO LOJISTA. Sempre escopado na loja: o
// lojista só enxerga o que é dele. (O admin da plataforma tem a sua própria
// leitura em lib/admin.ts, sem esse filtro, porque lá o escopo é a plataforma.)

export type StoreOrderDetail = {
  order: {
    id: string;
    status: string;
    paymentMethod: string | null;
    paymentGateway: string | null;
    totalCents: number;
    shippingCents: number;
    discountCents: number;
    createdAt: Date;
    paidAt: Date | null;
    customerName: string | null;
    customerEmail: string | null;
    customerDocument: string | null;
    customerPhone: string | null;
    providerTxnId: string | null;
    trackingCode: string | null;
    pixQrCode: string | null;
    pixExpiresAt: Date | null;
    /** Quando o cliente voltou com o Pix vencido e um código novo foi gerado neste pedido. */
    pixRenovadoEm: Date | null;
    separationEmailSentAt: Date | null;
    shopifyOrderId: string | null;
    shopifyStoreDomain: string | null;
    gclid: string | null;
    /** IP do comprador, gravado pelo checkout dentro de trackingParams. */
    ip: string | null;
    address: Record<string, string> | null;
    /**
     * Motivo da recusa, PARA O LOJISTA. O cliente nunca vê isto: no checkout ele
     * recebe a mensagem tratada por `safeCardMessage`, que não expõe gateway,
     * antifraude nem estado da conta.
     */
    declineReason: { resumo: string; detalhe: string | null } | null;
    /** Gateways em que o Pix falhou antes da retentativa. Também só para o lojista. */
    retentativas: { gateway: string; motivo: string }[];
    /** Cartão MASCARADO (6 + 4 dígitos, bandeira, validade, titular) — nunca o número inteiro. */
    card: { bin: string | null; last4: string | null; brand: string | null; exp: string | null; holder: string | null } | null;
    /** Recusas seguidas do mesmo cartão que este pedido representa. */
    cardAttempts: number;
    /** Tentativa agrupada numa recusa mais nova do mesmo cartão (o pedido que a substitui na lista). */
    cardHiddenBy: string | null;
  };
  items: { name: string | null; imageUrl: string | null; quantity: number; unitPriceCents: number }[];
  /** Outros pedidos do mesmo e-mail NESTA loja. */
  history: { id: string; status: string; totalCents: number; createdAt: Date }[];
};

/**
 * Traduz o motivo da recusa do gateway para algo que o lojista use.
 *
 * O `providerPayload` guarda a resposta crua: às vezes uma frase do adquirente
 * ("Transação não autorizada."), às vezes um erro de integração com corpo e
 * status HTTP. Aqui separamos as duas coisas — um RESUMO curto, que é o que o
 * lojista precisa para decidir o que falar com o cliente, e o DETALHE técnico,
 * que fica escondido até ele pedir.
 *
 * Nada disto chega ao comprador.
 */
function lerMotivo(raw: unknown, status: string): { resumo: string; detalhe: string | null } | null {
  if (status !== "CANCELLED") return null;
  const dados = parseJson<{ error?: string; status?: string; gateway?: string }>(raw);
  if (!dados) return null;

  const bruto = (dados.error ?? dados.status ?? "").trim();
  if (!bruto) return null;

  // Erro de INTEGRAÇÃO: a mensagem carrega o corpo da resposta e o status HTTP.
  // Para o lojista, o que importa é que não foi o cliente nem o cartão.
  if (dados.error) {
    const semRuido = bruto.split(" enviado=")[0].trim();
    // Conta do lojista bloqueada no gateway (Beehive: "Forma de pagamento
    // bloqueada para essa empresa", HTTP 412). Não é falha técnica nem do
    // cliente, e só o suporte do gateway resolve: o resumo tem de dizer isso.
    if (/bloquead|blocked|desabilitad|n[ãa]o habilitad|not enabled|not supported by the company/i.test(semRuido)) {
      return {
        resumo: "Meio de pagamento bloqueado na conta do gateway. Só o suporte dele libera; até lá, use outro gateway.",
        detalhe: semRuido || null,
      };
    }
    // Alguns gateways (Appmax, Beehive) devolvem a recusa como erro HTTP. Não foi
    // falha técnica: o banco avaliou e negou. O resumo é o mesmo motivo que o
    // cliente viu, sem a orientação para ele, e a frase original fica no detalhe.
    const motivo = motivoDoCartao(semRuido);
    if (motivo) return { resumo: motivo.split(". ")[0].replace(/\.$/, ""), detalhe: semRuido || null };
    return {
      resumo: "Falha técnica na comunicação com o gateway: a cobrança não chegou a ser avaliada.",
      detalhe: semRuido || null,
    };
  }

  // Recusa de negócio: a frase do adquirente já é o resumo.
  const semResposta = bruto.split(" · resposta=")[0].trim();
  return { resumo: semResposta, detalhe: bruto.includes(" · resposta=") ? bruto : null };
}

/** O que a retentativa do Pix tentou antes de dar certo (ou de desistir). */
function lerRetentativas(raw: unknown): { gateway: string; motivo: string }[] {
  const dados = parseJson<{ tentativas?: { gateway?: string | null; error?: string }[] }>(raw);
  if (!Array.isArray(dados?.tentativas)) return [];
  return dados.tentativas.map((t) => ({
    gateway: String(t?.gateway ?? "?"),
    motivo: String(t?.error ?? "").replace(/^Falha ao gerar o Pix:\s*/i, "").trim(),
  }));
}

function parseJson<T>(raw: unknown): T | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function getStoreOrderDetail(storeId: string, orderId: string): Promise<StoreOrderDetail | null> {
  const rows = await query<any>(
    `SELECT o.*, ss.shopifyStoreDomain
     FROM orders o
     LEFT JOIN store_settings ss ON ss.storeId = o.storeId
     WHERE o.id = ? AND o.storeId = ? LIMIT 1`,
    [orderId, storeId],
  );
  const o = rows[0];
  if (!o) return null;

  // LEFT JOIN: produto excluído do catálogo não some do pedido.
  const items = await query<any>(
    `SELECT p.name, p.imageUrl, oi.quantity, oi.unitPriceCents
     FROM order_items oi LEFT JOIN products p ON p.id = oi.productId
     WHERE oi.orderId = ?`,
    [orderId],
  );

  let history: StoreOrderDetail["history"] = [];
  if (o.customerEmail) {
    history = await query<any>(
      `SELECT id, status, totalCents, createdAt FROM orders
       WHERE storeId = ? AND customerEmail = ? AND id <> ?
       ORDER BY createdAt DESC LIMIT 25`,
      [storeId, o.customerEmail, orderId],
    );
  }

  const tracking = parseJson<Record<string, string>>(o.trackingParams);

  return {
    order: {
      id: o.id,
      status: o.status,
      paymentMethod: o.paymentMethod ?? null,
      paymentGateway: o.paymentGateway ?? null,
      totalCents: Number(o.totalCents ?? 0),
      shippingCents: Number(o.shippingCents ?? 0),
      discountCents: Number(o.discountCents ?? 0),
      createdAt: o.createdAt,
      paidAt: o.paidAt ?? null,
      customerName: o.customerName ?? null,
      customerEmail: o.customerEmail ?? null,
      customerDocument: o.customerDocument ?? null,
      customerPhone: o.customerPhone ?? null,
      providerTxnId: o.providerTxnId ?? null,
      trackingCode: o.trackingCode ?? null,
      pixQrCode: o.pixQrCode ?? null,
      pixExpiresAt: o.pixExpiresAt ?? null,
      pixRenovadoEm: o.pixRenovadoEm ?? null,
      separationEmailSentAt: o.separationEmailSentAt ?? null,
      shopifyOrderId: o.shopifyOrderId ?? null,
      shopifyStoreDomain: o.shopifyStoreDomain ?? null,
      gclid: o.gclid ?? null,
      ip: tracking?.ip ?? null,
      address: parseJson<Record<string, string>>(o.customerAddress),
      declineReason: lerMotivo(o.providerPayload, o.status),
      retentativas: lerRetentativas(o.providerPayload),
      card:
        o.cardLast4 || o.cardBin
          ? {
              bin: o.cardBin ?? null,
              last4: o.cardLast4 ?? null,
              brand: o.cardBrand ?? null,
              exp: o.cardExp ?? null,
              holder: o.cardHolder ?? null,
            }
          : null,
      cardAttempts: Number(o.cardAttempts ?? 1),
      cardHiddenBy: o.cardHiddenBy ?? null,
    },
    items: items.map((i) => ({
      name: i.name ?? null,
      imageUrl: i.imageUrl ?? null,
      quantity: Number(i.quantity ?? 0),
      unitPriceCents: Number(i.unitPriceCents ?? 0),
    })),
    history,
  };
}
