"use client";

import { useState } from "react";

/** Campo somente leitura com botão de copiar (Pix copia-e-cola, ids, etc). */
export default function CopyField({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard bloqueado: o input continua selecionável */
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={`min-w-0 flex-1 truncate rounded-lg border border-line bg-soft px-3 py-2 text-[12px] text-low outline-none ${mono ? "font-mono" : ""}`}
      />
      <button
        onClick={copy}
        title="Copiar"
        aria-label="Copiar"
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-line text-low transition hover:bg-hover hover:text-hi"
      >
        {copied ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        )}
      </button>
    </div>
  );
}
