"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncProductsButton({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/shopify/sync-products", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Erro ao sincronizar.");
        return;
      }
      setMsg(`${data.synced} produto(s) sincronizado(s).`);
      router.refresh();
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-sm text-low">{msg}</span>}
      <button
        onClick={sync}
        disabled={busy || !connected}
        title={connected ? "" : "Conecte a Shopify primeiro"}
        className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
      >
        <svg className={busy ? "animate-spin" : ""} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        {busy ? "Sincronizando..." : "Sincronizar com a Shopify"}
      </button>
    </div>
  );
}
