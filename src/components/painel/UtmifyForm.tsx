"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

// Configuração da Utmify (token + liga/desliga). O token nunca volta do servidor.
export default function UtmifyForm() {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings } = await res.json();
        setEnabled(Boolean(settings.utmifyEnabled));
        setTokenSet(Boolean(settings.utmifyConfigured));
      } catch {
        /* silencioso */
      }
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = { utmifyEnabled: enabled };
    if (token.trim()) payload.utmifyApiToken = token.trim();
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(data?.error ?? "Erro ao salvar.");
      setToken("");
      setTokenSet(Boolean(data.settings?.utmifyConfigured));
      setMsg("Configurações salvas!");
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-hi">Utmify</h2>
            <p className="text-xs text-low">Envia suas vendas (geradas e pagas) para a Utmify com as UTMs, para atribuir o faturamento às campanhas.</p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${enabled ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        <div className="mt-4">
          <label className="block max-w-md">
            <span className="mb-1 block text-xs font-semibold text-mid">API Token (x-api-token)</span>
            <input
              type="password"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSet ? "••••••••••••" : "cole o token da Utmify"}
              autoComplete="off"
            />
          </label>
          <p className="mt-2 text-xs text-dim">
            Pegue em <b>Utmify → Integrações → Webhooks → Credenciais de API</b>.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
            {busy ? "Salvando..." : "Salvar configurações"}
          </button>
          {msg && <span className="text-sm text-mid">{msg}</span>}
        </div>
      </div>

      <p className="text-xs text-dim">
        O token é criptografado (AES-256-GCM) antes de ir ao banco. As UTMs são capturadas automaticamente no checkout.{" "}
        <Link href="/painel/apps" className="font-semibold text-brand hover:underline">Voltar para Apps</Link>
      </p>
    </div>
  );
}
