"use client";

import { useEffect, useState } from "react";

/**
 * Copia-e-cola do Pix com botão de copiar e o QR gerado NO NAVEGADOR a partir
 * do mesmo código que o cliente viu — serve de auditoria do recebedor sem
 * mandar o payload para nenhum terceiro.
 */
export default function PixCodeField({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!showQr || qr) return;
    let alive = true;
    import("qrcode")
      .then((QR) => QR.toDataURL(code, { margin: 1, width: 220 }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [showQr, qr, code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard indisponível: o campo continua selecionável */
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-lg border border-line bg-soft px-3 py-2 font-mono text-[12px] text-low outline-none"
        />
        <button
          onClick={copy}
          title="Copiar"
          aria-label="Copiar código Pix"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-line text-low transition hover:bg-hover hover:text-hi"
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </button>
      </div>
      <button
        onClick={() => setShowQr((v) => !v)}
        className="mt-1.5 text-[12px] font-semibold text-brand hover:underline"
      >
        {showQr ? "Ocultar QR Code" : "Ver QR Code"}
      </button>
      {showQr && (
        <div className="mt-2">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR Code do Pix" className="h-40 w-40 rounded-lg bg-white p-1 ring-1 ring-line" />
          ) : (
            <p className="text-xs text-dim">Gerando...</p>
          )}
        </div>
      )}
    </div>
  );
}
