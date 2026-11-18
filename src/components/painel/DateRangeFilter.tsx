"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// Formata "YYYY-MM-DD" -> "dd/mm" para o rótulo do botão.
function short(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}` : ymd;
}

// Filtro de período PERSONALIZADO (intervalo De/Até). Navega para a PRÓPRIA
// página com ?from=YYYY-MM-DD&to=YYYY-MM-DD — o server resolve a faixa.
//
// Antes o destino era sempre /painel: aplicado na tela de Dispositivos, o
// filtro levava o lojista de volta para a dashboard.
//
// `onNavigate` deixa quem usa conduzir a navegação (a dashboard passa a dela,
// que troca o período sem piscar a tela).
export default function DateRangeFilter({
  active,
  from,
  to,
  onNavigate,
}: {
  active: boolean;
  from: string;
  to: string;
  onNavigate?: (href: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/painel";
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function apply() {
    if (!f && !t) return;
    const p = new URLSearchParams();
    if (f) p.set("from", f);
    if (t) p.set("to", t || f);
    const href = `${pathname}?${p.toString()}`;
    if (onNavigate) onNavigate(href);
    else router.push(href);
    setOpen(false);
  }

  const label = active && (from || to) ? `${short(from || to)} – ${short(to || from)}` : "Personalizar";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={active ? `Período personalizado: ${label}` : "Personalizar período"}
        className={`flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[12.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:px-3.5 ${
          active ? "bg-brand text-white" : "bg-card text-low hover:text-hi"
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        {/* No celular, sem período escolhido, fica só o ícone: o seletor ao lado
            precisa da largura. */}
        <span className={active ? "" : "hidden sm:inline"}>{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-raised p-3 shadow-panel-hover">
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-low text-[12px] font-medium">De</span>
              <input
                type="date"
                value={f}
                max={t || undefined}
                onChange={(e) => setF(e.target.value)}
                className="w-full rounded-lg border border-line bg-soft px-2.5 py-1.5 text-sm text-hi outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-low text-[12px] font-medium">Até</span>
              <input
                type="date"
                value={t}
                min={f || undefined}
                onChange={(e) => setT(e.target.value)}
                className="w-full rounded-lg border border-line bg-soft px-2.5 py-1.5 text-sm text-hi outline-none transition focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={!f && !t}
            className="mt-3 w-full rounded-lg bg-brand px-3 py-2 text-xs font-bold text-white transition hover:bg-brand-hover disabled:opacity-50"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
