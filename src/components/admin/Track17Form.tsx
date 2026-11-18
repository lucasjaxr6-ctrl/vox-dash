"use client";

import { useState } from "react";

/**
 * Token da API do 17TRACK — um para toda a plataforma.
 *
 * É ele que alimenta a página de rastreio no domínio de cada loja. Sem token a
 * página abre, mas sem eventos: o cliente vê "aguardando postagem" para sempre.
 */
export default function Track17Form({ configurado }: { configurado: boolean }) {
  const [token, setToken] = useState("");
  const [salvo, setSalvo] = useState(configurado);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar(valor: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/track17", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: valor }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, texto: data?.error ?? "Erro ao salvar." });
      setSalvo(Boolean(data.configurado));
      setToken("");
      if (!data.configurado) return setMsg({ ok: true, texto: "Token removido." });
      // `valido` vem null quando a checagem contra a API não pôde ser feita.
      setMsg(
        data.valido === true
          ? { ok: true, texto: "Token salvo e aceito pelo 17TRACK." }
          : data.valido === false
            ? { ok: false, texto: "Salvo, mas o 17TRACK recusou o token. Confira na conta deles." }
            : { ok: true, texto: "Token salvo. Não deu para conferir com o 17TRACK agora." },
      );
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={salvo ? "Token salvo — cole um novo para trocar" : "Cole o Security Key do 17TRACK"}
          className="min-w-0 flex-1 rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => salvar(token)}
          disabled={busy || !token.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Salvando..." : "Salvar"}
        </button>
        {salvo && (
          <button
            onClick={() => salvar("")}
            disabled={busy}
            className="rounded-lg border border-line-strong px-3 py-2 text-sm font-semibold text-mid disabled:opacity-40"
          >
            Remover
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-low">
        {salvo ? (
          <>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Configurado.</span> As páginas de rastreio das lojas já
            buscam os eventos.
          </>
        ) : (
          <>
            <span className="font-semibold text-amber-600 dark:text-amber-400">Sem token.</span> A página de rastreio abre, mas fica sem
            eventos. Pegue o Security Key em{" "}
            <a href="https://api.17track.net/" target="_blank" rel="noreferrer" className="underline">
              api.17track.net
            </a>
            .
          </>
        )}
      </p>

      {msg && (
        <p className={`mt-2 text-xs font-semibold ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.texto}</p>
      )}
    </div>
  );
}
