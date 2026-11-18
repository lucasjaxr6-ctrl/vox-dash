"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Busca manual na Resend.
 *
 * A caixa já sincroniza sozinha ao abrir; este botão existe para quando o
 * e-mail chega com a página aberta — evita ficar recarregando no F5 e diz
 * quantos vieram, que é a resposta para "chegou ou não chegou?".
 */
export default function SyncInbox() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sincronizar() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/inbox/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Falha ao buscar.");
        return;
      }
      setMsg(data.novos > 0 ? `${data.novos} novo(s).` : "Nada novo na Resend.");
      if (data.novos > 0) router.refresh();
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-low">{msg}</span>}
      <button
        onClick={sincronizar}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-2 text-xs font-semibold text-mid transition hover:bg-hover disabled:opacity-40"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={busy ? "animate-spin" : ""}
        >
          <path d="M21 12a9 9 0 1 1-2.6-6.4" />
          <path d="M21 3v6h-6" />
        </svg>
        {busy ? "Buscando..." : "Buscar na Resend"}
      </button>
    </div>
  );
}
