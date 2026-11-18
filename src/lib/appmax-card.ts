import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Envio do cartão quando o provedor da loja é a APPMAX (checkout transparente).
// Diferente do Mercado Pago, aqui não há tokenização no navegador: os dados do
// cartão vão para a nossa rota, que os repassa via TLS à Appmax e NÃO os grava.
// Serve igual para os outros gateways de cartão direto (Freepay, BlackCat).
// Quando o Appmax JS (tokenização no navegador) for ativado, basta mandar
// `token` no lugar dos campos brutos — a rota já aceita os dois.
// ─────────────────────────────────────────────────────────────────────────────

export async function submitAppmaxCardPayment(params: {
  card: CardFields;
  installments: number;
  order: CardOrder;
  gateway?: string;
}): Promise<CardResult> {
  const { card, installments, order, gateway } = params;

  const number = card.number.replace(/\D/g, "");
  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const expirationMonth = (mm || "").padStart(2, "0");
  const expirationYear = aa ? (aa.length === 2 ? `20${aa}` : aa) : "";

  if (number.length < 13) return { ok: false, error: "Número do cartão inválido." };
  if (!expirationMonth || !expirationYear) return { ok: false, error: "Validade do cartão inválida." };
  if (!card.cvv) return { ok: false, error: "Informe o código de segurança (CVV)." };

  try {
    const res = await fetch("/api/checkout/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: order.items,
        customer: order.customer,
        couponCode: order.couponCode,
        shippingOptionId: order.shippingOptionId,
        sessionId: order.sessionId,
        gclid: order.gclid,
        tracking: order.tracking,
        ga4: order.ga4,
        meta: order.meta,
        address: order.address,
        card: {
          installments,
          number,
          cvv: card.cvv,
          expirationMonth,
          expirationYear,
          holderName: card.holder,
          holderDocument: (card.cpf || order.customer.cpf || "").replace(/\D/g, ""),
          resumo: resumoCartao(card), ...(gateway ? { gateway } : {}),
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return { ok: false, status: data?.status, orderId: data?.orderId, error: data?.error ?? "Não foi possível processar o cartão." };
    // `threeDs` só vem quando o banco pede autenticação (BlackCat): o checkout
    // abre o desafio com ele. Os demais gateways diretos não mandam o campo.
    return { ok: true, status: data.status, orderId: data.orderId, amountCents: data.amountCents, threeDs: data.threeDs };
  } catch {
    return { ok: false, error: "Erro de rede ao processar o cartão." };
  }
}
