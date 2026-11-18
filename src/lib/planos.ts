// Planos da plataforma. SEM "server-only": a grade de planos é um componente
// client e precisa dos mesmos números que o servidor cobra. Uma cópia de preço
// no front e outra no back terminaria com a tela prometendo um valor e o Pix
// saindo com outro.

export const PLANOS_IDS = ["basic", "premium", "enterprise"] as const;
export type PlanoId = (typeof PLANOS_IDS)[number];

export type Plano = {
  id: PlanoId;
  nome: string;
  /** Preço por período, em centavos. 0 = grátis. */
  precoCents: number;
  /**
   * Taxa por pedido pago. `null` = segue o percentual PADRÃO da plataforma
   * (o que o admin define em Taxas). O Basic é null de propósito: todo lojista
   * que já existia foi colocado nele, e a taxa dele não pode mudar por isso.
   */
  pct: number | null;
  /**
   * Taxa das vendas RECUPERADAS (Pix não pago ou carrinho abandonado que
   * voltou por e-mail). Definida por plano, inclusive no Basic — decisão do
   * dono (02/10/2026). Taxa individual da loja, quando existe, vale acima.
   */
  recoveryPct: number;
  /** Lojas da conta com domínio próprio configurado. */
  dominios: number;
  /** Janela da tela de carrinhos abandonados. */
  historicoDias: number;
  publico: string;
};

/** Dias de acesso que cada Pix de plano pago compra. */
export const DIAS_POR_PERIODO = 30;

export const PLANOS: Record<PlanoId, Plano> = {
  basic: {
    id: "basic",
    nome: "Basic",
    precoCents: 0,
    pct: null,
    recoveryPct: 10,
    dominios: 1,
    historicoDias: 45,
    publico: "Para quem está começando",
  },
  premium: {
    id: "premium",
    nome: "Premium",
    precoCents: 12700,
    pct: 2,
    recoveryPct: 6,
    dominios: 5,
    historicoDias: 90,
    publico: "Para quem fatura mais de R$ 30 mil por mês",
  },
  enterprise: {
    id: "enterprise",
    nome: "Enterprise",
    precoCents: 44700,
    pct: 1.5,
    recoveryPct: 4.5,
    dominios: 10,
    historicoDias: 120,
    publico: "Para quem fatura mais de R$ 60 mil por mês",
  },
};

export function isPlanoId(v: unknown): v is PlanoId {
  return typeof v === "string" && (PLANOS_IDS as readonly string[]).includes(v);
}
