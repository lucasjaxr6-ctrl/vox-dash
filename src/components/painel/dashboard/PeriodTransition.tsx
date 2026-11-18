"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Troca de período sem piscar a tela.
//
// Enquanto o servidor busca o período novo, a tela ANTERIOR continua de pé, só
// mais apagada. Quando os dados chegam, os números deslizam do valor antigo
// para o novo (AnimatedNumber) e as barras acompanham.
//
// O "carregando" NÃO depende de useTransition: com o loading.tsx do painel, no
// build de produção, a transição de uma troca só de ?period= às vezes nunca
// terminava — a página ficava apagada para sempre (medido: resposta completa
// do servidor e a tela sem trocar). Aqui o "carregando" acaba quando a URL
// muda de fato; e, se o roteador empacar, uma navegação normal assume.

type Ctx = { pending: boolean; navigate: (href: string) => void };
const PeriodCtx = createContext<Ctx | null>(null);

// Tempo máximo esperando o roteador antes de recarregar a página no destino.
const LIMITE_MS = 4000;

export function PeriodTransition({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const search = useSearchParams();
  const [target, setTarget] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A URL mudou (os dados do período novo chegaram): fim do "carregando".
  useEffect(() => {
    setTarget(null);
    if (timer.current) clearTimeout(timer.current);
  }, [search]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const navigate = useCallback(
    (href: string) => {
      // Mesmo endereço: a URL não mudaria e o "carregando" nunca acabaria.
      const dest = new URL(href, window.location.href);
      if (dest.pathname === window.location.pathname && dest.search === window.location.search) return;
      setTarget(href);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => window.location.assign(href), LIMITE_MS);
      router.push(href, { scroll: false });
    },
    [router],
  );

  return <PeriodCtx.Provider value={{ pending: target !== null, navigate }}>{children}</PeriodCtx.Provider>;
}

export function usePeriodTransition() {
  return useContext(PeriodCtx);
}

/** Área que depende do período: esmaece enquanto o período novo carrega. */
export function PendingArea({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const pending = !!useContext(PeriodCtx)?.pending;
  return (
    <div
      aria-busy={pending || undefined}
      className={`transition-opacity duration-200 ease-fluid ${pending ? "opacity-50" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
