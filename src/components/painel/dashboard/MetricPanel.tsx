"use client";

import React, { useState } from "react";
import TrendChart, { type TrendSeries } from "./TrendChart";

// Cartões que viram filtro do gráfico logo abaixo.
//
// Sem nada escolhido, o gráfico CRUZA todas as séries da seção. Clicar num
// cartão filtra o gráfico só para ele (com o período anterior de comparação);
// clicar de novo, ou em "Todos", volta ao cruzado.

export type PanelItem = {
  key: string;
  label: string;
  node: React.ReactNode;
  className?: string;
  /** Bolinha da cor da série no canto (desligar quando o cartão já tem a própria). */
  marker?: boolean;
};

export default function MetricPanel({
  items,
  series,
  labels,
  nowIndex,
  currentLabel,
  previousLabel,
  gridClassName,
  chartTitle,
  itemClassName = "",
  compact = false,
}: {
  items: PanelItem[];
  series: TrendSeries[];
  labels: string[];
  nowIndex: number;
  currentLabel: string;
  previousLabel: string | null;
  gridClassName: string;
  chartTitle: string;
  itemClassName?: string;
  /** Cartão estreito: os filtros vão numa linha própria, abaixo do título. */
  compact?: boolean;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const shown = sel ? series.filter((s) => s.key === sel) : series;
  const colorOf = (k: string) => series.find((s) => s.key === k)?.color;
  const selLabel = items.find((i) => i.key === sel)?.label;

  return (
    <div className="min-w-0">
      <div className={gridClassName}>
        {items.map((it) => {
          const on = sel === it.key;
          const dim = sel !== null && !on;
          return (
            <button
              key={it.key}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(on ? null : it.key)}
              title={on ? "Clique para voltar a ver tudo no gráfico" : `Ver só ${it.label} no gráfico`}
              className={`group relative block min-w-0 rounded-2xl text-left transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
                on ? "ring-2 ring-brand/60" : "hover:ring-1 hover:ring-line-strong"
              } ${dim ? "opacity-60 hover:opacity-100" : ""} ${it.className ?? ""} ${itemClassName}`}
            >
              {it.marker !== false && <span
                aria-hidden
                className={`absolute right-4 top-4 z-[1] h-2 w-2 rounded-full transition-transform ${on ? "scale-125" : ""}`}
                style={{ background: colorOf(it.key) }}
              />}
              {it.node}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl bg-soft p-4 ring-1 ring-line sm:p-5">
        <div className={`mb-4 flex gap-3 ${compact ? "flex-col items-start" : "flex-wrap items-center justify-between"}`}>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-hi">{sel ? selLabel : chartTitle}</h3>
            <p className="mt-0.5 text-[12.5px] text-low">
              {sel ? "Comparado ao período anterior · clique no cartão de novo para cruzar tudo" : "Clique num cartão acima para ver só ele"}
            </p>
          </div>
          <div role="group" aria-label="Série do gráfico" className="flex flex-wrap gap-1 rounded-xl bg-card p-1 ring-1 ring-line">
            <Chip on={sel === null} onClick={() => setSel(null)}>
              Todos
            </Chip>
            {items.map((it) => (
              <Chip key={it.key} on={sel === it.key} onClick={() => setSel(it.key)} color={colorOf(it.key)}>
                {it.label}
              </Chip>
            ))}
          </div>
        </div>
        <TrendChart series={shown} labels={labels} nowIndex={nowIndex} currentLabel={currentLabel} previousLabel={previousLabel} />
      </div>
    </div>
  );
}

function Chip({ on, onClick, color, children }: { on: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
        on ? "bg-brand text-white" : "text-mid hover:text-hi"
      }`}
    >
      {color && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: on ? "#fff" : color }} />}
      {children}
    </button>
  );
}
