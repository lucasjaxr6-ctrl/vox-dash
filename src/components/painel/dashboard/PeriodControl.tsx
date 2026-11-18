"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { PERIODS } from "@/lib/painel-range";
import DateRangeFilter from "@/components/painel/DateRangeFilter";
import { usePeriodTransition } from "./PeriodTransition";

// Seletor de período da dashboard.
//
// A pílula ativa é uma SEGUNDA fileira de rótulos, pintada com a cor da marca e
// recortada por clip-path no formato do item ativo. Trocar de período só muda
// o recorte, então a pílula desliza até o novo item com o texto já em branco —
// sem medir largura por largura nem trocar cor de texto no meio do caminho.
//
// A pílula anda NA HORA do clique (antes de o servidor responder): o retorno do
// clique é imediato, e a tela abaixo esmaece até os números novos chegarem.

// Precisa bater com o `rounded-lg` dos itens.
const PILL_RADIUS = 8;

export default function PeriodControl({ active, from, to }: { active: string; from: string; to: string }) {
  const pathname = usePathname() || "/painel";
  const nav = usePeriodTransition();
  const [current, setCurrent] = useState(active);
  useEffect(() => setCurrent(active), [active]);

  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [clip, setClip] = useState<string | null>(null);
  // A primeira medição não anima: sem isto a pílula "voaria" do canto ao abrir.
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = itemRefs.current[current];
      if (!el) return setClip(null);
      const right = track.offsetWidth - (el.offsetLeft + el.offsetWidth);
      setClip(`inset(0 ${right}px 0 ${el.offsetLeft}px round ${PILL_RADIUS}px)`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);

    // No celular o seletor rola: traz o item ativo para a vista ("Tudo" e
    // "30 dias" nascem fora da tela).
    const scroller = track.parentElement;
    const el = itemRefs.current[current];
    if (scroller && el) {
      const pad = 16;
      if (el.offsetLeft + el.offsetWidth > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollLeft = el.offsetLeft + el.offsetWidth - scroller.clientWidth + pad;
      } else if (el.offsetLeft < scroller.scrollLeft) {
        scroller.scrollLeft = Math.max(0, el.offsetLeft - pad);
      }
    }
    return () => ro.disconnect();
  }, [current]);

  useEffect(() => {
    if (!clip || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [clip, ready]);

  function go(href: string, key: string) {
    setCurrent(key);
    if (nav) nav.navigate(href);
    else window.location.assign(href);
  }

  function onClick(e: React.MouseEvent<HTMLAnchorElement>, key: string, href: string) {
    // Ctrl/Cmd+clique continua abrindo em outra aba.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (key !== current) go(href, key);
  }

  const item = "whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium leading-5";

  return (
    // No celular ocupa a linha toda: o seletor rola na horizontal e o calendário
    // fica colado a ele, em vez de cair sozinho na linha de baixo.
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <nav aria-label="Período" className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-card p-1 [scrollbar-width:none] sm:flex-none [&::-webkit-scrollbar]:hidden">
        <div ref={trackRef} className="relative flex w-max">
          {PERIODS.map((p) => {
            const href = `${pathname}?period=${p.key}`;
            const on = current === p.key;
            return (
              <a
                key={p.key}
                ref={(el) => {
                  itemRefs.current[p.key] = el;
                }}
                href={href}
                onClick={(e) => onClick(e, p.key, href)}
                aria-current={on ? "page" : undefined}
                className={`${item} transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 ${
                  // Antes de medir (primeira pintura, sem JS), o próprio item
                  // pinta a pílula; depois quem pinta é a camada recortada.
                  on && !clip ? "bg-brand text-white" : "text-low hover:text-hi"
                }`}
              >
                {p.label}
              </a>
            );
          })}

          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 flex bg-brand text-white ${
              ready ? "transition-[clip-path,opacity] duration-200 ease-fluid" : ""
            }`}
            style={{ clipPath: clip ?? `inset(0 100% 0 0 round ${PILL_RADIUS}px)`, opacity: clip ? 1 : 0 }}
          >
            {PERIODS.map((p) => (
              <span key={p.key} className={item}>
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </nav>

      <DateRangeFilter
        active={current === "custom"}
        from={from}
        to={to}
        onNavigate={(href) => go(href, "custom")}
      />
    </div>
  );
}
