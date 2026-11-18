"use client";

import { useState } from "react";

/** Código de rastreio com botão de copiar — o cliente costuma colar noutro app. */
export default function CopiarCodigo({ codigo }: { codigo: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Sem permissão de área de transferência: o código está visível ao lado,
      // então dá para selecionar à mão. Nada a avisar.
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-[15px] font-bold tracking-tight text-gray-900">{codigo}</span>
      <button
        type="button"
        onClick={copiar}
        aria-label={copiado ? "Código copiado" : "Copiar código"}
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
      >
        {copiado ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="12" height="12" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </svg>
        )}
      </button>
    </span>
  );
}
