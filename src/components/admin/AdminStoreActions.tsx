"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

// Ações do super-admin sobre uma loja: impersonar (abrir painel), suspender/
// reativar, apagar (só loja vazia). Compacto para caber na linha da tabela.
export default function AdminStoreActions({ storeId, suspended, canDelete = false }: { storeId: string; suspended: boolean; canDelete?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "suspend" | "unsuspend" | "delete" | "impersonate") {
    setErr(null);
    if (action === "delete" && !confirm("Apagar esta loja? (só funciona se não tiver nenhum pedido)")) return;
    setBusy(action);
    try {
      const res = await fetch("/api/admin/platform/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, storeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data?.error ?? "Falha na ação.");
        return;
      }
      if (action === "impersonate") {
        window.location.href = "/painel"; // abre o painel já com esta loja ativa
        return;
      }
      router.refresh();
    } catch {
      setErr("Erro de rede.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset transition-colors duration-150 disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button onClick={() => act("impersonate")} disabled={!!busy} className={`${btn} bg-brand/10 text-brand dark:text-brand-bright ring-brand/20 hover:bg-brand/20`}>
        {busy === "impersonate" ? "..." : "Ver painel"}
      </button>
      {suspended ? (
        <button onClick={() => act("unsuspend")} disabled={!!busy} className={`${btn} bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20 hover:bg-emerald-500/20`}>
          {busy === "unsuspend" ? "..." : "Reativar"}
        </button>
      ) : (
        <button onClick={() => act("suspend")} disabled={!!busy} className={`${btn} bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20 hover:bg-amber-500/20`}>
          {busy === "suspend" ? "..." : "Suspender"}
        </button>
      )}
      {canDelete && (
        <button onClick={() => act("delete")} disabled={!!busy} className={`${btn} bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-rose-500/20 hover:bg-rose-500/20`}>
          {busy === "delete" ? "..." : "Apagar"}
        </button>
      )}
      {err && <span className="text-xs text-rose-600 dark:text-rose-400">{err}</span>}
    </div>
  );
}
