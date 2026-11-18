"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Range } from "@/lib/admin";
import { usePeriodTransition } from "@/components/painel/dashboard/PeriodTransition";

// Seletor de período do admin — o mesmo desenho do PeriodControl do painel:
// a pílula é uma segunda fileira de rótulos pintada com a marca e recortada no
// formato do item ativo. Trocar de período só muda o recorte, então ela
// desliza até o novo item na hora do clique, e a tela abaixo (PendingArea)
// esmaece até os números novos chegarem.

const KEYS: Range[] = ["today", "7", "30", "all"];
const LABEL: Record<Range, string> = { today: "Hoje", "7": "7 dias", "30": "30 dias", all: "Tudo" };
// Precisa bater com o `rounded-lg` dos itens.
const PILL_RADIUS = 8;

export default function RangePicker({
  range,
  baseHref,
  params = {},
}: {
  range: Range;
  baseHref: string;
  params?: Record<string, string>;
}) {
  const nav = usePeriodTransition();
  const [current, setCurrent] = useState<Range>(range);
  useEffect(() => setCurrent(range), [range]);

  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Partial<Record<Range, HTMLAnchorElement | null>>>({});
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
    return () => ro.disconnect();
  }, [current]);

  useEffect(() => {
    if (!clip || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [clip, ready]);

  const hrefFor = (k: Range) => {
    const sp = new URLSearchParams(params);
    // O período volta sempre para a primeira página do resultado.
    sp.delete("page");
    sp.set("range", k);
    return `${baseHref}?${sp.toString()}`;
  };

  function onClick(e: React.MouseEvent<HTMLAnchorElement>, k: Range, href: string) {
    // Ctrl/Cmd+clique continua abrindo em outra aba.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (k === current) return;
    setCurrent(k);
    if (nav) nav.navigate(href);
    else window.location.assign(href);
  }

  const item = "whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium leading-5";

  return (
    <nav aria-label="Período" className="max-w-full overflow-x-auto rounded-xl bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={trackRef} className="relative flex w-max">
        {KEYS.map((k) => {
          const href = hrefFor(k);
          const on = current === k;
          return (
            <a
              key={k}
              ref={(el) => {
                itemRefs.current[k] = el;
              }}
              href={href}
              data-pill
              onClick={(e) => onClick(e, k, href)}
              aria-current={on ? "page" : undefined}
              className={`${item} transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 ${
                // Antes de medir (primeira pintura), o próprio item pinta a
                // pílula; depois quem pinta é a camada recortada.
                on && !clip ? "bg-brand text-white" : "text-low hover:text-hi"
              }`}
            >
              {LABEL[k]}
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
          {KEYS.map((k) => (
            <span key={k} className={item}>
              {LABEL[k]}
            </span>
          ))}
        </div>
      </div>
    </nav>
  );
}
