"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";

// Paginação server-side (links com ?page=). Preserva filtros extras (params).
//
// Client por causa da TROCA: a página nova é montada no servidor e, até ela
// chegar, a tela não mudava nada. O clique parecia não ter pegado, o lojista
// clicava de novo, e um clique dado no meio da troca se perdia. Agora o número
// clicado acende na hora, com um indicador de carregamento, e cada clique
// novo substitui o anterior (o último vence), sem precisar esperar.
//
// Rede de segurança, como em PeriodTransition: se o roteador empacar, a página
// abre por navegação normal. Ele já empacou para sempre aqui, por um motivo que
// só aparece em produção (ver PainelLoading).
//
// `scroll: false`: a paginação fica parada debaixo do mouse. Com a rolagem para
// o topo, ela saía do lugar e o clique seguinte caía em outra coisa (medido:
// cliques perdidos numa tela de 900 px de altura, nenhum numa de 1500 px).
//
// Continua sendo <a> de verdade: abrir em nova aba e Ctrl+clique funcionam.

// Tempo máximo esperando o roteador antes de abrir a página no destino.
const LIMITE_MS = 4000;

type Transicao = { pendente: boolean; iniciar: (fn: () => void) => void };
const TransicaoCtx = createContext<Transicao | null>(null);

/**
 * Envolve a lista + a paginação para a LISTA apagar enquanto a página nova
 * carrega (ver AreaPendente). Sem ele, a paginação funciona do mesmo jeito,
 * só sem apagar a lista.
 */
export function TransicaoLista({ children }: { children: React.ReactNode }) {
  const [pendente, iniciar] = useTransition();
  return <TransicaoCtx.Provider value={{ pendente, iniciar }}>{children}</TransicaoCtx.Provider>;
}

/** A parte da tela que apaga durante a troca de página. */
export function AreaPendente({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const ctx = useContext(TransicaoCtx);
  const pendente = ctx?.pendente ?? false;
  return (
    <div aria-busy={pendente} className={`${className} transition-opacity duration-150 ${pendente ? "opacity-50" : ""}`}>
      {children}
    </div>
  );
}

export default function Pagination({
  page,
  totalPages,
  baseHref,
  params = {},
}: {
  page: number;
  totalPages: number;
  baseHref: string;
  params?: Record<string, string>;
}) {
  const router = useRouter();
  const ctx = useContext(TransicaoCtx);
  const [pendenteLocal, iniciarLocal] = useTransition();
  const pendente = ctx?.pendente ?? pendenteLocal;
  const iniciar = ctx?.iniciar ?? iniciarLocal;
  // Página clicada e ainda não mostrada. Acende no lugar da atual.
  const [alvo, setAlvo] = useState<number | null>(null);
  useEffect(() => {
    if (!pendente) setAlvo(null);
  }, [pendente, page]);
  // A página trocou (ou esta paginação saiu da tela): o vigia não tem mais o que fazer.
  const vigia = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (vigia.current) clearTimeout(vigia.current);
    },
    [page],
  );

  if (totalPages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams(params);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${baseHref}?${qs}` : baseHref;
  };

  const ir = (e: React.MouseEvent<HTMLAnchorElement>, p: number) => {
    // Nova aba / janela: deixa o navegador fazer o dele.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    // Já é esta página: a URL não mudaria e não há o que carregar.
    if (p === page && alvo === null) return;
    setAlvo(p);
    if (vigia.current) clearTimeout(vigia.current);
    if (p !== page) vigia.current = setTimeout(() => window.location.assign(href(p)), LIMITE_MS);
    iniciar(() => router.push(href(p), { scroll: false }));
  };

  // A janela segue a página CLICADA: clicou no 14, os números já se ajustam e
  // o 16 aparece para o próximo clique, sem esperar o 14 carregar.
  const atual = alvo ?? page;
  const end = Math.min(totalPages, Math.max(5, atual + 2));
  const start = Math.max(1, end - 4);
  const nums: number[] = [];
  for (let p = start; p <= end; p++) nums.push(p);

  const base = "flex h-8 min-w-8 items-center justify-center rounded-lg px-2.5 text-sm font-semibold transition";

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-xs text-dim" aria-live="polite">
        {pendente && alvo ? (
          <>
            <Girando />
            Carregando a página {alvo}...
          </>
        ) : (
          <>
            Página {page} de {totalPages}
          </>
        )}
      </span>
      <div className="flex items-center gap-1">
        {atual > 1 ? (
          <Link href={href(atual - 1)} onClick={(e) => ir(e, atual - 1)} className={`${base} text-mid ring-1 ring-line hover:bg-hover`}>
            Anterior
          </Link>
        ) : (
          <span className={`${base} cursor-not-allowed text-dim ring-1 ring-line`}>Anterior</span>
        )}
        {nums.map((p) => (
          <Link
            key={p}
            href={href(p)}
            onClick={(e) => ir(e, p)}
            aria-current={p === atual ? "page" : undefined}
            className={`${base} ${p === atual ? "bg-brand text-white" : "text-mid ring-1 ring-line hover:bg-hover"}`}
          >
            {p}
          </Link>
        ))}
        {atual < totalPages ? (
          <Link href={href(atual + 1)} onClick={(e) => ir(e, atual + 1)} className={`${base} text-mid ring-1 ring-line hover:bg-hover`}>
            Próxima
          </Link>
        ) : (
          <span className={`${base} cursor-not-allowed text-dim ring-1 ring-line`}>Próxima</span>
        )}
      </div>
    </div>
  );
}

function Girando() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
