"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Botão "Exportar" de Vendas, com as duas planilhas: a normal e a com
 * criptografia (nome mascarado dos produtos, o mesmo que o gateway recebeu;
 * ver api/painel/vendas/export). As duas levam os filtros da tela.
 *
 * Os itens são <a> comuns, não <Link>: o Link pré-carrega o destino ao
 * aparecer, e aqui o destino é o arquivo. Cada abertura do menu geraria um
 * export inteiro à toa.
 */
export default function ExportarVendas({ total, qs }: { total: number; qs: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const href = (cripto: boolean) => {
    const p = new URLSearchParams(qs);
    if (cripto) p.set("cripto", "1");
    const s = p.toString();
    return `/api/painel/vendas/export${s ? `?${s}` : ""}`;
  };

  const vazio = total === 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={vazio}
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        title={vazio ? "Nenhuma venda para exportar" : `Baixar ${total} venda(s) em planilha`}
        className="inline-flex items-center gap-1.5 rounded-lg bg-card px-3.5 py-2 text-xs font-semibold text-mid ring-1 ring-inset ring-line transition hover:bg-hover hover:text-hi disabled:pointer-events-none disabled:text-dim disabled:opacity-50"
      >
        <IconDownload />
        Exportar{total > 0 ? ` (${total})` : ""}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition ${aberto ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        // No celular o botão fica à esquerda (a linha quebra): o menu abre
        // para a direita, senão sairia da tela.
        <div role="menu" className="absolute left-0 z-20 mt-1.5 w-64 animate-fade-up rounded-xl bg-card p-1 shadow-panel-hover ring-1 ring-line sm:left-auto sm:right-0">
          <a role="menuitem" href={href(false)} download onClick={() => setAberto(false)} className="block rounded-lg px-3 py-2 transition hover:bg-hover">
            <span className="block text-[13px] font-semibold text-hi">Planilha</span>
            <span className="block text-[11.5px] leading-snug text-dim">Com o nome real dos produtos.</span>
          </a>
          <a role="menuitem" href={href(true)} download onClick={() => setAberto(false)} className="block rounded-lg px-3 py-2 transition hover:bg-hover">
            <span className="block text-[13px] font-semibold text-hi">Planilha com criptografia</span>
            <span className="block text-[11.5px] leading-snug text-dim">Com o nome mascarado dos produtos, o mesmo que foi para o gateway.</span>
          </a>
        </div>
      )}
    </div>
  );
}

function IconDownload() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
