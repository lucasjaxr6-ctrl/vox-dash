"use client";

import { useState } from "react";

// Caixa do Pix copia-e-cola + botão COPIAR que funciona de verdade (web, com JS —
// diferente do e-mail, que não roda script). Usa a Clipboard API com fallback.
export default function PixCopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* ignora — o cliente ainda pode selecionar o texto manualmente */
    }
  }

  return (
    <div>
      <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-3">
        <div className="break-all font-mono text-xs leading-relaxed text-emerald-900">{code}</div>
      </div>
      <button
        onClick={copy}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700"
      >
        {copied ? (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Código copiado!
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            Copiar código Pix
          </>
        )}
      </button>
    </div>
  );
}
