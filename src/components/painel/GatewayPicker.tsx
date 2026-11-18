"use client";

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import GatewayLogo from "@/components/painel/GatewayLogo";
import { GATEWAYS, type GatewayMeta } from "@/lib/gateways";

/**
 * Seletor de gateway do Smart Routing — no lugar do <select> nativo, que não
 * mostra logo, abre como uma lista cinza de sistema e mistura os gateways sem
 * credencial com os conectados sem deixar claro o que fazer com eles.
 *
 * - Logo + nome no botão e em cada opção.
 * - Busca no topo (13 gateways já é lista longa para rolar).
 * - "Conectados" escolhíveis; "Sem credencial" com atalho para conectar.
 * - Teclado: ↑/↓ navegam, Enter escolhe, Esc fecha (padrão listbox da WAI-ARIA).
 * - Abre para cima quando não há espaço embaixo.
 */
export default function GatewayPicker({
  value,
  onChange,
  permitidos,
  prontos,
  bloqueados = {},
  rotulo,
  placeholder = "Escolher gateway",
}: {
  value: string;
  onChange: (key: string) => void;
  /** Gateways que fazem sentido aqui (ex.: só os que fazem cartão). */
  permitidos: string[];
  /** Gateways com credencial salva. */
  prontos: string[];
  /** Gateways conectados mas indisponíveis aqui, com o motivo. */
  bloqueados?: Record<string, string>;
  rotulo: string;
  placeholder?: string;
}) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState<string | null>(null);
  const [paraCima, setParaCima] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);

  const atual = GATEWAYS.find((g) => g.key === value) ?? null;
  const filtrar = (g: GatewayMeta) => !busca || g.name.toLowerCase().includes(busca.trim().toLowerCase());
  const base = GATEWAYS.filter((g) => permitidos.includes(g.key)).sort((a, b) => a.name.localeCompare(b.name));
  const conectados = base.filter((g) => prontos.includes(g.key) && filtrar(g));
  const semCredencial = base.filter((g) => !prontos.includes(g.key) && filtrar(g));
  const escolhiveis = useMemo(() => conectados.filter((g) => !bloqueados[g.key]).map((g): string => g.key), [conectados, bloqueados]);

  function abrir() {
    // Decide o lado antes de pintar: sem isso a lista nasceria cortada embaixo.
    const r = botao.current?.getBoundingClientRect();
    if (r) setParaCima(window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom);
    setBusca("");
    setAtivo(value && escolhiveis.includes(value) ? value : null);
    setAberto(true);
  }
  function fechar(focar = true) {
    setAberto(false);
    if (focar) botao.current?.focus();
  }
  function escolher(key: string) {
    onChange(key);
    fechar();
  }

  // Clique fora fecha.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) fechar(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  // A opção ativa acompanha o teclado: rola até ela.
  useLayoutEffect(() => {
    if (!aberto || !ativo) return;
    lista.current?.querySelector(`[data-key="${ativo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [ativo, aberto]);

  // A busca mudou e a opção ativa sumiu: volta para a primeira que sobrou.
  useEffect(() => {
    if (aberto && ativo && !escolhiveis.includes(ativo)) setAtivo(escolhiveis[0] ?? null);
  }, [busca, aberto, ativo, escolhiveis]);

  function teclas(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      return fechar();
    }
    if (e.key === "Tab") return fechar(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!escolhiveis.length) return;
      const i = ativo ? escolhiveis.indexOf(ativo) : -1;
      const prox = e.key === "ArrowDown" ? (i + 1) % escolhiveis.length : (i - 1 + escolhiveis.length) % escolhiveis.length;
      setAtivo(escolhiveis[prox]);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const alvo = ativo ?? (escolhiveis.length === 1 ? escolhiveis[0] : null);
      if (alvo) escolher(alvo);
    }
  }

  return (
    <div ref={raiz} className="relative">
      <button
        ref={botao}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={`${id}-lista`}
        aria-label={atual ? `${rotulo}: ${atual.name}` : rotulo}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={(e) => {
          if (!aberto && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            abrir();
          }
        }}
        className={`flex h-10 w-full items-center gap-2.5 rounded-lg border bg-card pl-2 pr-2.5 text-left text-[13.5px] outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20 ${
          aberto ? "border-brand ring-2 ring-brand/20" : "border-line hover:border-line-strong"
        }`}
      >
        {atual ? (
          <>
            <GatewayLogo gateway={atual} size={24} />
            <span className="min-w-0 flex-1 truncate font-medium text-hi">{atual.name}</span>
            {!prontos.includes(atual.key) && (
              <span className="flex-shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                sem credencial
              </span>
            )}
          </>
        ) : (
          <>
            <span aria-hidden className="h-6 w-6 flex-shrink-0 rounded-full border border-dashed border-line-strong" />
            <span className="min-w-0 flex-1 truncate text-dim">{placeholder}</span>
          </>
        )}
        <svg
          aria-hidden
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`flex-shrink-0 text-low transition-transform duration-200 ease-fluid ${aberto ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        <div
          className={`absolute left-0 z-40 w-full min-w-[260px] overflow-hidden rounded-xl border border-line-strong bg-raised shadow-panel-hover ${
            paraCima ? "bottom-full mb-1.5 origin-bottom" : "top-full mt-1.5 origin-top"
          } animate-[gp-abrir_.16s_cubic-bezier(0.22,1,0.36,1)_both]`}
        >
          <div className="border-b border-line p-2">
            <div className="relative">
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-low">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={teclas}
                placeholder="Buscar gateway"
                role="combobox"
                aria-expanded
                aria-controls={`${id}-lista`}
                aria-activedescendant={ativo ? `${id}-${ativo}` : undefined}
                aria-label={`Buscar ${rotulo.toLowerCase()}`}
                className="h-8 w-full rounded-md bg-soft pl-8 pr-2 text-[13px] text-hi outline-none placeholder:text-dim"
              />
            </div>
          </div>

          <div ref={lista} id={`${id}-lista`} role="listbox" aria-label={rotulo} className="max-h-[280px] overflow-y-auto p-1.5">
            {conectados.length > 0 && <Grupo>Conectados</Grupo>}
            {conectados.map((g) => {
              const motivo = bloqueados[g.key];
              const sel = g.key === value;
              const at = g.key === ativo;
              return (
                <div
                  key={g.key}
                  id={`${id}-${g.key}`}
                  data-key={g.key}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={!!motivo || undefined}
                  onMouseEnter={() => !motivo && setAtivo(g.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !motivo && escolher(g.key)}
                  className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] ${
                    motivo ? "cursor-not-allowed opacity-45" : "cursor-pointer"
                  } ${at && !motivo ? "bg-hover" : ""}`}
                >
                  <GatewayLogo gateway={g} size={26} />
                  <span className={`min-w-0 flex-1 truncate ${sel ? "font-semibold text-hi" : "text-mid"}`}>{g.name}</span>
                  {motivo ? (
                    <span className="flex-shrink-0 text-[11.5px] text-low">{motivo}</span>
                  ) : sel ? (
                    <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-brand dark:text-brand-bright">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </div>
              );
            })}

            {semCredencial.length > 0 && <Grupo separado={conectados.length > 0}>Sem credencial</Grupo>}
            {semCredencial.map((g) => (
              <div key={g.key} role="option" aria-selected={false} aria-disabled className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px]">
                <span className="opacity-50 grayscale">
                  <GatewayLogo gateway={g} size={26} />
                </span>
                <span className="min-w-0 flex-1 truncate text-low">{g.name}</span>
                {/* Leva para a página do gateway: é lá que se cola a credencial. */}
                <a
                  href={`/painel/pagamentos/${g.key}`}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-brand transition-colors hover:bg-brand/10 dark:text-brand-bright"
                >
                  Conectar
                </a>
              </div>
            ))}

            {conectados.length === 0 && semCredencial.length === 0 && (
              <p className="px-2 py-6 text-center text-[13px] text-low">Nenhum gateway com esse nome.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Grupo({ children, separado = false }: { children: React.ReactNode; separado?: boolean }) {
  return (
    <div role="presentation" className={`px-2 pb-1 pt-1.5 text-[11.5px] font-medium text-low ${separado ? "mt-1.5 border-t border-line pt-2.5" : ""}`}>
      {children}
    </div>
  );
}
