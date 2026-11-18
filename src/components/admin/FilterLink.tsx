"use client";

import React from "react";
import { usePeriodTransition } from "@/components/painel/dashboard/PeriodTransition";

// Link de filtro que só troca a query da mesma tela (aba de status, "Limpar").
// Passa pela mesma transição do seletor de período: a lista atual fica de pé,
// esmaecida, até a nova chegar — em vez de a tela congelar sem resposta.
export default function FilterLink({
  href,
  className,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const nav = usePeriodTransition();
  return (
    <a
      {...rest}
      href={href}
      className={className}
      onClick={(e) => {
        if (!nav || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        nav.navigate(href);
      }}
    >
      {children}
    </a>
  );
}
