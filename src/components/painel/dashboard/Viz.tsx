import React from "react";
import Link from "next/link";
import AnimatedNumber from "./AnimatedNumber";

// Peças de gráfico da dashboard. Sem estado: quando o servidor devolve o período
// novo, o React só troca o recorte (clip-path) e a transição CSS faz a barra
// deslizar até o valor novo — no mesmo tempo e curva do AnimatedNumber.
//
// clip-path em vez de largura: não mexe no layout de nada em volta e mantém a
// ponta arredondada certa em qualquer tamanho.
//
// Regras seguidas (skill de dataviz): barra fina com a ponta de dado
// arredondada e a base reta; 2px de respiro entre segmentos em vez de borda;
// texto nunca na cor da série — a cor fica no marcador ao lado do nome.

export const BAR_MOTION = "transition-[clip-path] duration-[420ms] ease-fluid";

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** `icon` (já na cor da série) toma o lugar da bolinha, como no Pix e no cartão. */
export type Part = { label: string; cents: number; count: number; color: string; icon?: React.ReactNode };

export type BreakdownRow = Part & {
  /** Última coluna (aprovação, ticket...). */
  last: React.ReactNode;
  lastNote?: string;
  lastHint?: string;
};

/**
 * Detalhamento em TABELA: cada método/dispositivo numa linha, com as colunas
 * alinhadas — vendas, valor, participação no total e uma última coluna própria
 * de cada cartão (aprovação, ticket). Comparar é ler de cima para baixo na
 * mesma coluna, em vez de caçar números nas pontas do cartão.
 */
export function Breakdown({
  rows,
  firstLabel,
  lastLabel,
}: {
  rows: BreakdownRow[];
  firstLabel: string;
  lastLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const grid =
    "grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(6rem,auto)_minmax(3rem,1fr)_minmax(6rem,auto)] items-center gap-x-4";
  const shareOf = (r: BreakdownRow) => (total > 0 ? (r.cents / total) * 100 : 0);
  return (
    <div role="table" className="min-w-0 text-[13px]">
      {/* Cabeçalho só onde as colunas cabem. No celular cada linha se explica sozinha. */}
      <div role="row" className={`hidden sm:grid ${grid} pb-2.5 text-[12px] text-low`}>
        <span role="columnheader">{firstLabel}</span>
        <span role="columnheader" className="text-right">Vendas</span>
        <span role="columnheader" className="text-right">Valor</span>
        <span role="columnheader">Participação</span>
        <span role="columnheader" className="text-right">{lastLabel}</span>
      </div>
      {rows.map((r) => {
        const share = shareOf(r);
        const pct = total > 0 ? <AnimatedNumber value={share} format="pct" /> : "—";
        const dot = r.icon ?? <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />;
        return (
          <div role="row" key={r.label} className="border-t border-line py-3.5">
            {/* Celular: duas linhas — nome e valor; depois vendas, participação e a última coluna. */}
            <div className="sm:hidden">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {dot}
                  <span className="truncate font-medium text-hi">{r.label}</span>
                </span>
                <span className="whitespace-nowrap font-semibold tabular-nums text-hi">
                  <AnimatedNumber value={r.cents} format="brl" />
                </span>
              </div>
              <div className={`mt-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${r.icon ? "pl-[23px]" : "pl-[18px]"} text-[12.5px] text-low`}>
                <span className="tabular-nums">
                  <AnimatedNumber value={r.count} /> {r.count === 1 ? "venda" : "vendas"} · {pct}
                </span>
                <span className="tabular-nums" title={r.lastHint}>
                  {lastLabel}: <span className="font-semibold text-hi">{r.last}</span>
                  {r.lastNote && <span> ({r.lastNote})</span>}
                </span>
              </div>
            </div>

            {/* Tela maior: colunas alinhadas. */}
            <div className={`hidden sm:grid ${grid}`}>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                {dot}
                <span className="truncate font-medium text-hi">{r.label}</span>
              </span>
              <span role="cell" className="text-right tabular-nums text-mid">
                <AnimatedNumber value={r.count} />
              </span>
              <span role="cell" className="whitespace-nowrap text-right font-semibold tabular-nums text-hi">
                <AnimatedNumber value={r.cents} format="brl" />
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-3">
                <span aria-hidden className="relative h-1.5 min-w-0 flex-1">
                  <span className="absolute inset-0 rounded-full bg-hover" />
                  <span
                    className={`absolute inset-0 ${BAR_MOTION}`}
                    style={{ background: r.color, clipPath: `inset(0 ${clamp(100 - share)}% 0 0 round 999px)` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-low">{pct}</span>
              </span>
              <span role="cell" className="min-w-0 text-right tabular-nums" title={r.lastHint}>
                <span className="whitespace-nowrap font-semibold text-hi">{r.last}</span>
                {r.lastNote && <span className="block truncate text-[11.5px] text-low">{r.lastNote}</span>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export type FunnelStage = {
  label: string;
  /** Nome curto para a coluna ("Dados", "Compra"); o `label` completo vai na dica e na tabela. */
  short?: string;
  value: number;
  done?: boolean;
};

// Altura máxima da coluna, em px. Fixa de propósito: a coluna anima por recorte
// (clip-path) e o número do topo por transform — nada de layout na troca.
const PLOT = 120;
// Espaço acima da coluna mais alta para o número dela.
const HEADROOM = 30;

/**
 * Funil do checkout em COLUNAS, no formato das ferramentas de análise
 * (Mixpanel, funil do Google Analytics): uma coluna por etapa, todas na mesma
 * escala — a primeira é 100%.
 *
 * - A coluna é quem chegou até a etapa, com o número em cima.
 * - Entre as colunas, a % que passou de uma etapa para a outra.
 * - Embaixo: o nome, a % do total e quantos saíram. A etapa com a maior TAXA
 *   de saída leva a marca "maior perda" — é onde vale olhar primeiro.
 *
 * Colunas finas (até 24px) e neutras; só a compra, que é o resultado, leva o
 * tom forte. Uma tabela invisível repete tudo para leitor de tela.
 */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const n = stages.length;
  const base = stages[0]?.value ?? 0;
  const pctOf = (v: number) => (base > 0 ? (v / base) * 100 : 0);
  const cols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };

  const steps = stages.map((s, i) => {
    const prev = i > 0 ? stages[i - 1] : null;
    const drop = prev && prev.value > s.value ? prev.value - s.value : 0;
    return {
      ...s,
      pct: pctOf(s.value),
      drop,
      dropRate: prev && prev.value > 0 ? drop / prev.value : 0,
      /** % de quem estava na etapa anterior e chegou nesta. */
      conv: prev && prev.value > 0 ? (s.value / prev.value) * 100 : null,
    };
  });
  // Maior perda = maior TAXA de saída, não a maior quantidade: a primeira
  // passagem quase sempre perde mais gente em número só por ser a maior.
  const worst = steps.reduce(
    (w, s, i) => (i > 0 && s.drop > 0 && s.dropRate > (steps[w]?.dropRate ?? 0) ? i : w),
    -1,
  );

  return (
    <div className="flex flex-1 flex-col justify-end">
      <div className="relative" style={{ height: PLOT + HEADROOM }} aria-hidden>
        <div className="grid h-full" style={cols}>
          {steps.map((s, i) => {
            // Rampa ordinal da cor da marca: a entrada clara, a compra cheia.
            const tone = s.done ? "var(--viz-accent)" : `color-mix(in oklab, var(--viz-accent) ${Math.round(38 + (47 * i) / Math.max(1, n - 2))}%, transparent)`;
            // Um fio mínimo para quem tem valor não sumir ao lado da primeira.
            const h = s.value > 0 ? Math.max(s.pct, 1.5) : 0;
            return (
              <div key={s.label} className="relative flex justify-center">
                <span
                  className="absolute bottom-0 whitespace-nowrap text-[14px] font-semibold leading-none tabular-nums text-hi transition-transform duration-[420ms] ease-fluid"
                  style={{ transform: `translateY(-${(h / 100) * PLOT + 8}px)` }}
                >
                  <AnimatedNumber value={s.value} />
                </span>
                <div className="absolute bottom-0 w-6" style={{ height: PLOT }}>
                  <div
                    className={`absolute inset-0 ${BAR_MOTION}`}
                    style={{
                      background: tone,
                      clipPath: `inset(${100 - h}% 0 0 0 round 4px 4px 0 0)`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Passagem de uma etapa para a outra, no vão entre as colunas. */}
        {steps.slice(1).map((s, j) => (
          <span
            key={s.label}
            className="absolute bottom-2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap text-[12px] tabular-nums text-low"
            style={{ left: `${((j + 1) / n) * 100}%` }}
          >
            {s.conv === null ? "—" : <AnimatedNumber value={s.conv} format="pct" />}
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="hidden text-dim xl:block">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        ))}

        {/* Linha de base: as colunas nascem dela. */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-line" />
      </div>

      <div className="mt-3 grid gap-x-1" style={cols} aria-hidden>
        {steps.map((s, i) => (
          <div key={s.label} className="min-w-0 text-center" title={s.label}>
            <div className="whitespace-nowrap text-[12.5px] font-medium text-mid">{s.short ?? s.label}</div>
            <div className="mt-0.5 text-[12px] tabular-nums text-low">
              {base > 0 ? <AnimatedNumber value={s.pct} format="pct" /> : "—"}
            </div>
            <div
              className={`mt-1 whitespace-nowrap text-[12px] tabular-nums ${
                i === worst ? "font-medium text-rose-600 dark:text-rose-400" : "text-low"
              }`}
            >
              {i === 0 ? (
                " "
              ) : s.drop > 0 ? (
                <>
                  −<AnimatedNumber value={s.drop} />
                  <span className="hidden xl:inline"> saíram</span>
                </>
              ) : (
                "—"
              )}
            </div>
            {i === worst && (
              <div className="whitespace-nowrap text-[11.5px] font-medium text-rose-600 dark:text-rose-400">maior perda</div>
            )}
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>Funil do checkout</caption>
        <thead>
          <tr>
            <th scope="col">Etapa</th>
            <th scope="col">Pessoas</th>
            <th scope="col">Do total</th>
            <th scope="col">Passaram da etapa anterior</th>
            <th scope="col">Saíram nesta etapa</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s, i) => (
            <tr key={s.label}>
              <th scope="row">{s.label}</th>
              <td>{s.value}</td>
              <td>{base > 0 ? `${Math.round(s.pct)}%` : "—"}</td>
              <td>{s.conv === null ? "—" : `${Math.round(s.conv)}%`}</td>
              <td>{i === 0 ? "—" : `${s.drop}${i === worst ? " (maior perda)" : ""}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Link de texto dos cartões ("Ver todas", "Detalhes"). */
export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex shrink-0 items-center gap-1 rounded text-[12.5px] font-medium text-brand transition-colors hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 dark:text-brand-bright dark:hover:text-brand-bright/80"
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform duration-150 ease-fluid group-hover:translate-x-0.5">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
