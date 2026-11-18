"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Encerra uma sessão. Quando é a sessão ATUAL, o servidor faz logout e o
 * usuário vai para o login — por isso o texto do botão muda: a pessoa precisa
 * saber que vai sair, e não descobrir depois de clicar.
 */
export default function RevokeSessionButton({ id, current }: { id: string; current: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/sessoes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(data?.error ?? "Não foi possível encerrar.");
        return;
      }
      if (data.loggedOut) {
        window.location.href = "/login";
        return;
      }
      router.refresh();
    } catch {
      setErro("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={revoke}
        disabled={busy}
        className="rounded-full border border-red-500/25 px-4 py-2 text-xs font-bold text-red-600 transition hover:bg-red-500/10 disabled:opacity-50 dark:border-red-500/40 dark:hover:bg-red-500/10 dark:text-red-300"
      >
        {busy ? "Encerrando..." : current ? "Encerrar e sair desta conta" : "Encerrar sessão"}
      </button>
      {erro && <span className="text-xs font-medium text-red-600">{erro}</span>}
    </div>
  );
}
