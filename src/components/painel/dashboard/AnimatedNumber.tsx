"use client";

import { useEffect, useRef, useState } from "react";

// Número que DESLIZA do valor antigo para o novo quando muda: troca de período,
// batida do "ao vivo", pedido liquidado pelo reconcile.
//
// Na primeira pintura ele já nasce com o valor real. Contar de 0 até o número
// ao abrir a página é enfeite, e atrasa a leitura justamente de quem abriu a
// dashboard para ler.
//
// A animação é interrompível: se um valor novo chega no meio do caminho, ela
// parte de onde o número ESTÁ, não de onde tinha começado.

export type NumberFormat = "brl" | "int" | "pct";

// O mesmo tempo e a mesma curva das barras (`duration-[420ms] ease-fluid`),
// para número e barra chegarem juntos.
const DURATION = 420;
function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pct0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function AnimatedNumber({
  value,
  format = "int",
  display = false,
  fractionDigits,
}: {
  /** "brl" em centavos; "pct" de 0 a 100. */
  value: number;
  format?: NumberFormat;
  /** Valor em reais de destaque: "R$" e centavos menores (classes num-cur/num-dec). */
  display?: boolean;
  /** Precisão fixa para percentuais; sem valor, mantém o padrão do lojista. */
  fractionDigits?: 0 | 1;
}) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    const to = value;
    if (from === to) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const v = t === 1 ? to : from + (to - from) * easeOutQuint(t);
      shownRef.current = v;
      setShown(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  if (format === "brl") return <Money cents={Math.round(shown)} display={display} />;
  // As casas decimais seguem o valor FINAL: decidir pelo valor do meio do
  // caminho faria a vírgula aparecer e sumir durante a animação.
  if (format === "pct") {
    const formatter = fractionDigits === 1 ? pct1 : fractionDigits === 0 ? pct0 : value > 0 && value < 10 ? pct1 : pct0;
    return <>{formatter.format(shown)}%</>;
  }
  return <>{int.format(Math.round(shown))}</>;
}

function Money({ cents, display }: { cents: number; display: boolean }) {
  const reais = cents / 100;
  if (!display) return <>{brl.format(reais)}</>;
  let cur = "";
  let whole = "";
  let dec = "";
  for (const p of brl.formatToParts(reais)) {
    if (p.type === "currency") cur = p.value;
    else if (p.type === "minusSign" || p.type === "integer" || p.type === "group") whole += p.value;
    else if (p.type === "decimal" || p.type === "fraction") dec += p.value;
  }
  return (
    <>
      <span className="num-cur">{cur}</span>
      {whole}
      <span className="num-dec">{dec}</span>
    </>
  );
}
