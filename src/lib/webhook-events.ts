// Eventos de webhook. Fica num módulo próprio (sem "server-only") porque tanto o
// painel (client component) quanto o servidor precisam da lista e dos rótulos.

export type WebhookEvent =
  | "order_created"
  | "order_paid"
  | "order_refused"
  | "cart_abandoned"
  | "pix_generated"
  | "boleto_generated";

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "order_created",
  "order_paid",
  "order_refused",
  "cart_abandoned",
  "pix_generated",
  "boleto_generated",
];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, string> = {
  order_created: "Pedido criado",
  order_paid: "Pedido pago",
  order_refused: "Pedido recusado",
  cart_abandoned: "Carrinho abandonado",
  pix_generated: "Pix gerado",
  boleto_generated: "Boleto gerado",
};

/** Explicação curta de quando cada evento dispara (exibida no painel). */
export const WEBHOOK_EVENT_HINT: Record<WebhookEvent, string> = {
  order_created: "Quando o pedido é criado, antes do pagamento.",
  order_paid: "Quando o pagamento é confirmado.",
  order_refused: "Quando o pagamento é recusado ou cancelado.",
  cart_abandoned: "Quando o cliente preenche os dados e não finaliza.",
  pix_generated: "Quando o QR Code do Pix é gerado.",
  boleto_generated: "Quando um boleto é gerado.",
};
