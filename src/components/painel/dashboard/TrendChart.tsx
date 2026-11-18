"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

// Gráfico de linha do dashboard, desenhado em SVG (sem biblioteca).
//
// Dois modos:
//   - CRUZADO (várias séries): cada série na própria escala, para que valores
//     de grandezas diferentes (R$ e quantidade) dividam o mesmo desenho. O eixo
//     da esquerda é da primeira série; o da direita, da segunda, se for de outra
//     unidade. Os valores reais aparecem na dica ao passar o mouse.
//   - FILTRADO (uma série): só a série escolhida, na cor dela, com área.
//
// Sempre só o período do filtro de cima: sem comparação com outro período.
//
// O que ainda não aconteceu (resto do dia de hoje) vira um tracejado na base.

export type Unit = "brl" | "int";

export type TrendSeries = {
  key: string;
  label: string;
  color: string;
  unit: Unit;
  values: number[];
  /** Barras em vez de linha (no modo cruzado). */
  bars?: boolean;
  dashed?: boolean;
};

const H = 230;
const PAD = { top: 14, right: 12, bottom: 30, left: 12 };

const brlFull = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function fmt(v: number, unit: Unit, compact = false): string {
  if (unit === "int") return Math.round(v).toLocaleString("pt-BR");
  const reais = v / 100;
  if (!compact) return brlFull.format(reais);
  if (Math.abs(reais) >= 1000) return `R$ ${(reais / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(reais).toLocaleString("pt-BR")}`;
}

/** Topo "redondo" do eixo e 4 divisões. */
function niceMax(max: number, unit: Unit): number {
  const base = unit === "brl" ? 100 : 1; // centavos → reais inteiros
  const m = Math.max(max / base, 4);
  const raw = m / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow;
  return (unit === "int" ? Math.max(1, Math.ceil(step)) : step) * 4 * base;
}

/** Curva suave que não "passa do ponto" (cúbica monotônica): sem picos falsos abaixo de zero. */
function path(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n === 0) return "";
  if (n < 3) return xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join("");
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let out = `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    out += `C${(xs[i] + dx).toFixed(1)},${(ys[i] + m[i] * dx).toFixed(1)} ${(xs[i + 1] - dx).toFixed(1)},${(ys[i + 1] - m[i + 1] * dx).toFixed(1)} ${xs[i + 1].toFixed(1)},${ys[i + 1].toFixed(1)}`;
  }
  return out;
}

export default function TrendChart({
  series,
  labels,
  nowIndex,
  currentLabel,
}: {
  series: TrendSeries[];
  labels: string[];
  nowIndex: number;
  currentLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const single = series.length === 1;
  const n = labels.length;
  const units = Array.from(new Set(series.map((s) => s.unit)));
  const shared = !single && units.length === 1 && series.every((s) => !s.bars);

  // Escalas: filtrado e "mesma unidade" dividem uma escala; cruzado, uma por série.
  const scales = useMemo(() => {
    const live = (s: TrendSeries) => s.values.slice(0, nowIndex + 1);
    if (single || shared) {
      const all = series.flatMap((s) => live(s));
      const m = niceMax(Math.max(0, ...all), series[0].unit);
      return series.map(() => m);
    }
    return series.map((s) => niceMax(Math.max(0, ...live(s)), s.unit));
  }, [series, single, shared, nowIndex]);

  const leftUnit = series[0]?.unit ?? "brl";
  const rightIdx = !single && !shared ? series.findIndex((s, i) => i > 0 && s.unit !== leftUnit) : -1;

  // Espaço dos rótulos dos eixos.
  const leftW = 64;
  const rightW = rightIdx >= 0 ? 40 : 0;
  const x0 = PAD.left + leftW;
  const x1 = w - PAD.right - rightW;
  const y0 = PAD.top;
  const y1 = H - PAD.bottom;
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const xs = Array.from({ length: n }, (_, i) => x0 + i * step);
  const yOf = (v: number, max: number) => y1 - (max > 0 ? (v / max) * (y1 - y0) : 0);

  // Rótulos do eixo X sem encavalar.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((x1 - x0) / 56))));

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round((x - x0) / (step || 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const barW = Math.max(3, Math.min(18, step * 0.5));
  const live = Math.min(nowIndex, n - 1);

  return (
    <div ref={ref} className="relative min-w-0 select-none">
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        className="block max-w-full touch-none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Gráfico de ${series.map((s) => s.label).join(", ")} em ${currentLabel}`}
      >
        {/* Grade e eixo esquerdo */}
        {[0, 1, 2, 3, 4].map((t) => {
          const y = y1 - (t / 4) * (y1 - y0);
          return (
            <g key={t}>
              <line x1={x0} x2={x1} y1={y} y2={y} stroke="var(--c-line)" strokeWidth={1} />
              <text x={x0 - 10} y={y + 4} textAnchor="end" className="fill-[var(--c-text-low)] text-[11.5px] tabular-nums">
                {fmt((scales[0] * t) / 4, leftUnit, true)}
              </text>
              {rightIdx >= 0 && (
                <text x={x1 + 8} y={y + 4} textAnchor="start" className="fill-[var(--c-text-low)] text-[11.5px] tabular-nums">
                  {fmt((scales[rightIdx] * t) / 4, series[rightIdx].unit, true)}
                </text>
              )}
            </g>
          );
        })}

        {/* Eixo X */}
        {labels.map((l, i) =>
          (i % every === 0 && n - 1 - i >= every) || i === n - 1 ? (
            <text key={i} x={xs[i]} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-[var(--c-text-low)] text-[11.5px] tabular-nums">
              {l}
            </text>
          ) : null,
        )}

        {series.map((s, si) => {
          const max = scales[si];
          if (s.bars && !single) {
            return (
              <g key={s.key}>
                {s.values.slice(0, live + 1).map((v, i) => {
                  const y = yOf(v, max);
                  return v > 0 ? <rect key={i} x={xs[i] - barW / 2} y={y} width={barW} height={y1 - y} rx={Math.min(3, barW / 2)} fill={s.color} fillOpacity={0.28} /> : null;
                })}
              </g>
            );
          }
          const ys = s.values.slice(0, live + 1).map((v) => yOf(v, max));
          const lx = xs.slice(0, live + 1);
          return (
            <g key={s.key}>
              {single && ys.length > 1 && (
                <path d={`${path(lx, ys)}L${lx[lx.length - 1]},${y1}L${lx[0]},${y1}Z`} fill={s.color} fillOpacity={0.1} />
              )}
              <path d={path(lx, ys)} fill="none" stroke={s.color} strokeWidth={2.25} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}

        {/* Futuro: tracejado na base */}
        {live < n - 1 && (
          <line x1={xs[live]} x2={x1} y1={y1} y2={y1} stroke="var(--viz-mid)" strokeWidth={1.75} strokeDasharray="4 4" />
        )}

        {/* Mira do mouse */}
        {hover !== null && (
          <g>
            <line x1={xs[hover]} x2={xs[hover]} y1={y0} y2={y1} stroke="var(--c-line-strong)" strokeWidth={1} />
            {hover <= live &&
              series.map((s, si) =>
                s.bars && !single ? null : (
                  <circle key={s.key} cx={xs[hover]} cy={yOf(s.values[hover] ?? 0, scales[si])} r={4} fill={s.color} stroke="var(--c-card)" strokeWidth={2} />
                ),
              )}
          </g>
        )}
      </svg>

      {/* Dica */}
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-xl bg-raised px-3 py-2.5 text-[12px] shadow-lg ring-1 ring-line"
          style={{ left: Math.min(Math.max(xs[hover] + 12, 0), w - 180) }}
        >
          <div className="mb-1.5 font-medium text-hi">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5 text-low">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums text-hi">{hover <= live ? fmt(s.values[hover] ?? 0, s.unit) : "—"}</span>
            </div>
          ))}
        </div>
      )}

      {/* Legenda */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[12px] text-mid">
        {single ? (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: series[0].color }} />
            {series[0].label} · {currentLabel}
          </span>
        ) : (
          series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              {s.bars ? (
                <span className="h-2.5 w-2 rounded-sm" style={{ background: s.color, opacity: 0.5 }} />
              ) : (
                <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color, ...(s.dashed ? { background: `repeating-linear-gradient(90deg, ${s.color} 0 4px, transparent 4px 7px)` } : {}) }} />
              )}
              {s.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
