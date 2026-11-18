import React from "react";

// Ícones dos MÉTODOS de pagamento (Pix e cartão). Substituem as bolinhas
// coloridas (Formas de pagamento, dashboard): a cor do método (ou o cinza de
// "desligado") passa a pintar o próprio ícone, então a informação que a
// bolinha carregava continua lá.

type Props = { size?: number; className?: string; style?: React.CSSProperties };

/**
 * Símbolo oficial do Pix, o mesmo do checkout. Os três traços saíram de
 * public/payment/pix.svg (logo do Banco Central); o viewBox recorta só o
 * símbolo. Preenchido com currentColor para seguir a cor de cada tela.
 */
export function IconePix({ size = 14, className = "", style }: Props) {
  return (
    <svg width={size} height={size} viewBox="2.63 4.07 5.2 5.2" fill="currentColor" aria-hidden className={`shrink-0 ${className}`} style={style}>
      <path d="M6.67 8.04c-0.2,0 -0.39,-0.08 -0.53,-0.22l-0.78 -0.78c-0.05,-0.05 -0.15,-0.05 -0.2,0l-0.78 0.78c-0.14,0.15 -0.33,0.22 -0.54,0.22l-0.15 0 0.98 0.99c0.31,0.3 0.81,0.3 1.11,0l0.99 -0.99 -0.1 0z" />
      <path d="M3.84 5.3c0.21,0 0.4,0.08 0.54,0.22l0.78 0.78c0.05,0.06 0.15,0.06 0.2,0l0.78 -0.77c0.14,-0.15 0.33,-0.23 0.53,-0.23l0.1 0 -0.99 -0.98c-0.3,-0.31 -0.8,-0.31 -1.11,0l-0.98 0.98 0.15 0z" />
      <path d="M7.58 6.12l-0.6 -0.6c-0.01,0.01 -0.02,0.01 -0.04,0.01l-0.27 0c-0.14,0 -0.27,0.06 -0.37,0.16l-0.78 0.77c-0.07,0.07 -0.17,0.11 -0.26,0.11 -0.1,0 -0.19,-0.04 -0.26,-0.11l-0.78 -0.77c-0.1,-0.1 -0.24,-0.16 -0.38,-0.16l-0.33 0c-0.01,0 -0.03,0 -0.04,-0.01l-0.59 0.6c-0.31,0.3 -0.31,0.8 0,1.11l0.59 0.59c0.01,0 0.03,0 0.04,0l0.33 0c0.14,0 0.28,-0.06 0.38,-0.16l0.78 -0.78c0.14,-0.14 0.38,-0.14 0.52,0l0.78 0.78c0.1,0.1 0.23,0.15 0.37,0.15l0.27 0c0.02,0 0.03,0.01 0.04,0.01l0.6 -0.59c0.31,-0.31 0.31,-0.81 0,-1.11z" />
    </svg>
  );
}

/** Cartão de crédito. */
export function IconeCartao({ size = 14, className = "", style }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`} style={style}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M2.5 10h19M6.5 15h4" />
    </svg>
  );
}

/** O ícone do método, pelo nome que as telas já usam ("Pix"/"Cartão" ou "pix"/"cartao"). */
export function IconeMetodo({ metodo, ...props }: Props & { metodo: string }) {
  return metodo.toLowerCase() === "pix" ? <IconePix {...props} /> : <IconeCartao {...props} />;
}
