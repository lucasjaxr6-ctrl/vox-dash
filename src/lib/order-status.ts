// Estilo e rótulo dos status de pedido (cor reservada + rótulo, nunca cor sozinha).
// Compartilhado entre a Dashboard e a aba Vendas.

export type StatusBadge = { label: string; cls: string; dot: string };

// Fundo tingido + anel sutil, legível nos dois temas do painel (o tom do texto
// muda no dark para manter contraste).
export const ORDER_STATUS: Record<string, StatusBadge> = {
  PENDING: { label: "Pendente", cls: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400", dot: "bg-amber-500" },
  PAID: { label: "Pago", cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400", dot: "bg-emerald-500" },
  SHIPPED: { label: "Enviado", cls: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-400", dot: "bg-sky-500" },
  CANCELLED: { label: "Cancelado", cls: "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-400", dot: "bg-rose-500" },
};

const FALLBACK: StatusBadge = { label: "", cls: "bg-soft text-mid ring-line", dot: "bg-dim" };

/**
 * Badge do status. Quando o pedido está PENDENTE ou PAGO, o rótulo diz QUAL
 * método foi usado ("Pix pendente"/"Cartão pendente", "Pago com Pix"/"Pago com
 * cartão") — assim dá para diferenciar de relance sem abrir o pedido.
 */
export function orderStatusBadge(status: string, paymentMethod?: string | null, opts: { recuperado?: boolean } = {}): StatusBadge {
  const base = ORDER_STATUS[status] ?? { ...FALLBACK, label: status };
  const isCard = paymentMethod === "CREDIT_CARD";
  const isPix = paymentMethod === "PIX";
  if (status === "PENDING") {
    if (isCard) return { ...base, label: "Cartão pendente" };
    // O cliente voltou depois de o Pix vencer e um código novo foi gerado no mesmo pedido.
    if (isPix && opts.recuperado) return { ...base, label: "Pix recuperado" };
    if (isPix) return { ...base, label: "Pix pendente" };
  }
  if (status === "PAID") {
    if (isCard) return { ...base, label: "Pago com cartão" };
    if (isPix) return { ...base, label: "Pago com Pix" };
  }
  if (status === "CANCELLED") {
    // Pix não é cancelado (expirado fica pendente). Cartão cancelado = recusado.
    if (isCard) return { ...base, label: "Cartão recusado" };
  }
  return base;
}
