"use client";

import React, { useRef, useState } from "react";

// Upload de imagem reutilizável: mostra preview, botão enviar/trocar/remover.
export default function ImageUpload({
  value,
  onChange,
  label = "imagem",
  className = "",
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/painel/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? "Falha no upload.");
        return;
      }
      onChange(data.url);
    } catch {
      setErr("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={label} className="h-14 w-14 rounded-lg border border-line object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-line text-dim">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
          </div>
        )}
        <div className="flex flex-col items-start gap-1">
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-mid hover:border-line-strong disabled:opacity-50">
            {busy ? "Enviando..." : value ? "Trocar imagem" : "Enviar imagem"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange("")} className="text-xs font-medium text-red-500 hover:text-red-700">
              Remover
            </button>
          )}
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}
