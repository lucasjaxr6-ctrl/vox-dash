// Rótulo de cada tipo de e-mail enviado.
//
// Fica num arquivo só porque a lista estava duplicada na caixa e na página do
// e-mail, e as duas cópias ficaram para trás: `cart_recovery` (476 envios) e
// `pix_recovery` (93) nunca foram acrescentados, então quase um quarto dos
// e-mails aparecia no painel com a chave crua do banco.
export const KIND_LABEL: Record<string, string> = {
  pix_generated: "Pix gerado",
  pix_recovery: "Recuperação de Pix",
  cart_recovery: "Carrinho abandonado",
  order_paid: "Pedido confirmado",
  separation: "Em separação",
  tracking: "Rastreio",
  reply: "Resposta",
  test: "Teste",
  // Legado: nome antigo da recuperação de Pix, ainda presente em envios velhos.
  recovery: "Recuperação de Pix",
};

/** Nome amigável do tipo; cai na própria chave se for um tipo novo. */
export function rotuloKind(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return KIND_LABEL[kind] ?? kind;
}
