"use client";

import { useState } from "react";

export type DayPoint = { day: string; gmvCents: number; orders: number };

function brl(c: number) {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function brlShort(c: number) {
  const v = Number(c) / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return `R$ ${Math.round(v)}`;
}
/** 'YYYY-MM-DD' -> data no fuso local, sem o pulo de um dia do parse UTC. */
function toDate(day: string) {
  return new Date(day + "T12:00:00");
}
function fmtDay(day: string) {
  return toDate(day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function fmtFull(day: string) {
  return toDate(day).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Receita e vendas por dia. A coluna inteira é a área de hover (não só a altura
 * da barra), senão um dia de R$ 20 vira um alvo de 2px.
 */
export default function RevenueChart({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) return <p className="py-12 text-center text-sm text-low">Sem vendas no período.</p>;

  const maxGmv = Math.max(1, ...data.map((d) => d.gmvCents));
  const maxOrders = Math.max(1, ...data.map((d) => d.orders));
  const totalGmv = data.reduce((s, d) => s + d.gmvCents, 0);
  const totalOrders = data.reduce((s, d) => s + d.orders, 0);
  const active = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-bold tracking-tight text-hi tabular-nums">{brl(totalGmv)}</span>
          <span className="text-xs text-low">
            em {totalOrders} {totalOrders === 1 ? "venda" : "vendas"}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium text-low">
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-brand" />Receita</span>
          <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-orange-300" />Vendas</span>
        </div>
      </div>

      <div className="relative" onMouseLeave={() => setHover(null)}>
        {/* Tooltip flutuando sobre o topo das barras: nunca é cortado por cima.
            Nas pontas ele encosta na borda em vez de centralizar, senão metade
            dele sairia do cartão nos primeiros e últimos dias. */}
        {active && (
          <div
            className="pointer-events-none absolute top-0 z-10"
            style={(() => {
              const p = ((hover! + 0.5) / data.length) * 100;
              if (p < 18) return { left: 0 };
              if (p > 82) return { right: 0 };
              return { left: `${p}%`, transform: "translateX(-50%)" };
            })()}
          >
            <div className="whitespace-nowrap rounded-xl border border-line bg-card px-3 py-2 shadow-lg">
              <div className="text-[11px] font-semibold capitalize text-low">{fmtFull(active.day)}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[13px]">
                <i className="h-2 w-2 rounded-full bg-brand" />
                <span className="text-low">Receita:</span>
                <span className="font-bold tabular-nums text-hi">{brl(active.gmvCents)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px]">
                <i className="h-2 w-2 rounded-full bg-orange-300" />
                <span className="text-low">Vendas:</span>
                <span className="font-bold tabular-nums text-hi">{active.orders}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex h-56 items-end gap-[3px]">
          {data.map((d, i) => {
            const h = d.gmvCents > 0 ? Math.max(3, (d.gmvCents / maxGmv) * 100) : 0;
            const dot = (d.orders / maxOrders) * 100;
            const on = hover === i;
            return (
              <div
                key={d.day}
                tabIndex={0}
                role="img"
                aria-label={`${fmtFull(d.day)}: ${brl(d.gmvCents)}, ${d.orders} vendas`}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="relative h-full flex-1 cursor-default"
                onMouseEnter={() => setHover(i)}
              >
                {/* Faixa de fundo: dá alvo de hover em toda a altura da coluna. */}
                <div className={`absolute inset-0 rounded transition-colors ${on ? "bg-soft" : "bg-transparent"}`} />
                <div
                  className={`absolute bottom-0 w-full rounded-t transition-colors ${on ? "bg-brand" : "bg-brand/80"}`}
                  style={{ height: `${h}%` }}
                />
                {d.orders > 0 && (
                  <span
                    className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-card transition-colors ${on ? "bg-orange-500" : "bg-orange-300"}`}
                    style={{ bottom: `calc(${dot}% - 4px)` }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-between text-[10px] tabular-nums text-low">
        <span>{fmtDay(data[0].day)}</span>
        <span>pico de {brlShort(maxGmv)} num dia</span>
        <span>{fmtDay(data[data.length - 1].day)}</span>
      </div>
    </div>
  );
}
