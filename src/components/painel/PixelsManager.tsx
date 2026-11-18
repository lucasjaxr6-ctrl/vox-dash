"use client";

import React, { useEffect, useState } from "react";
import PixelLogo from "@/components/painel/PixelLogo";

type PixelType = "meta" | "google" | "ga4" | "tiktok" | "taboola" | "kwai" | "pinterest";

const NOME_PLATAFORMA: Record<PixelType, string> = {
  meta: "Meta",
  google: "Google Ads",
  ga4: "Google Analytics",
  tiktok: "TikTok",
  taboola: "Taboola",
  kwai: "Kwai",
  pinterest: "Pinterest",
};

// Nome e exemplo do campo de ID, que muda de plataforma para plataforma.
const CAMPO_ID: Partial<Record<PixelType, { rotulo: string; exemplo: string }>> = {
  ga4: { rotulo: "ID da métrica", exemplo: "ex.: G-ABC123XYZ9" },
  tiktok: { rotulo: "Pixel ID (código do pixel)", exemplo: "ex.: CXXXXXXXXXXXXXXXXXXX" },
  taboola: { rotulo: "ID da conta (Account ID)", exemplo: "ex.: 1234567" },
  kwai: { rotulo: "Pixel ID", exemplo: "ex.: 555981782467227726" },
  pinterest: { rotulo: "Tag ID", exemplo: "ex.: 2612345678901" },
};

type Pixel = {
  id: string;
  type: PixelType;
  name: string;
  pixelId: string;
  conversionLabel: string;
  paidOnly: boolean;
  enabled: boolean;
  accessTokenConfigured: boolean;
};

type Draft = {
  id?: string;
  type: PixelType;
  name: string;
  pixelId: string;
  conversionLabel: string;
  paidOnly: boolean;
  enabled: boolean;
  accessTokenConfigured: boolean;
};

export default function PixelsManager() {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "form">("list");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/painel/pixels");
        if (res.ok) {
          const { pixels: list } = await res.json();
          setPixels(list);
        }
      } catch {
        /* silencioso */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function toPayload(list: Pixel[]) {
    return list.map((p) => ({
      id: p.id,
      type: p.type,
      name: p.name,
      pixelId: p.pixelId,
      conversionLabel: p.conversionLabel,
      paidOnly: p.paidOnly,
      enabled: p.enabled,
    }));
  }

  async function persist(payload: any[]) {
    const res = await fetch("/api/painel/pixels", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pixels: payload }),
    });
    const data = await res.json().catch(() => ({}));
    // `issues` traz o motivo da validação; `error` diria só "Dados inválidos".
    if (!res.ok) throw new Error(data?.issues?.pixels?.[0] ?? data?.error ?? "Erro ao salvar.");
    setPixels(data.pixels);
  }

  function startCreate(type: PixelType) {
    setDraft({
      type,
      name: "",
      pixelId: "",
      conversionLabel: "",
      paidOnly: false,
      enabled: true,
      accessTokenConfigured: false,
    });
    setToken("");
    setMsg(null);
    setView("form");
  }

  function startEdit(p: Pixel) {
    setDraft({ ...p });
    setToken("");
    setMsg(null);
    setView("form");
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.pixelId.trim()) {
      setMsg(draft.type === "ga4" ? "Preencha Nome e ID da métrica." : "Preencha Nome e Pixel ID.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const editingId = draft.id;
      const list: Pixel[] = editingId
        ? pixels.map((p) =>
            p.id === editingId
              ? { ...p, name: draft.name, pixelId: draft.pixelId, conversionLabel: draft.conversionLabel, paidOnly: draft.paidOnly, enabled: draft.enabled }
              : p,
          )
        : [
            ...pixels,
            { ...draft, id: "__new__", accessTokenConfigured: false } as Pixel,
          ];

      const payload = toPayload(list);
      // anexa o token (Meta) ou a chave (Google Analytics) se foi digitado; senão o
      // servidor mantém o atual
      if ((draft.type === "meta" || draft.type === "ga4") && token.trim()) {
        const target = editingId
          ? payload.find((p) => p.id === editingId)
          : payload[payload.length - 1];
        if (target) {
          (target as any).accessToken = token.trim();
          if (!editingId) delete (target as any).id; // novo: deixa o servidor gerar id
        }
      } else if (!editingId) {
        // novo sem token: remove o id placeholder
        delete (payload[payload.length - 1] as any).id;
      }

      await persist(payload);
      setView("list");
      setDraft(null);
    } catch (e: any) {
      setMsg(e?.message ?? "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(p: Pixel) {
    const list = pixels.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x));
    setPixels(list);
    try {
      await persist(toPayload(list));
    } catch {
      setPixels(pixels); // reverte
    }
  }

  async function remove(p: Pixel) {
    if (!confirm(`Excluir o pixel "${p.name}"?`)) return;
    const list = pixels.filter((x) => x.id !== p.id);
    try {
      await persist(toPayload(list));
    } catch (e: any) {
      setMsg(e?.message ?? "Erro ao excluir.");
    }
  }

  if (loading) {
    return <p className="text-sm text-low">Carregando...</p>;
  }

  // ── Formulário de criação/edição ──
  if (view === "form" && draft) {
    const isMeta = draft.type === "meta";
    const isTaboola = draft.type === "taboola";
    const isGa4 = draft.type === "ga4";
    const campoId = CAMPO_ID[draft.type];
    const label = draft.id ? "Editar" : "Criar";
    return (
      <div>
        <button onClick={() => setView("list")} className="flex items-center gap-1 text-sm text-low hover:text-hi">
          <IconBack /> ver todos
        </button>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold text-mid">
          <PixelLogo type={draft.type} size={40} />
          {label} {NOME_PLATAFORMA[draft.type]}
          {!isGa4 && " pixel"}
        </h1>

        <div className="mt-6 rounded-xl bg-card p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nome">
              <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
            </Field>
            <Field label={campoId?.rotulo ?? "Pixel ID"}>
              <input
                className={input}
                value={draft.pixelId}
                onChange={(e) => setDraft({ ...draft, pixelId: e.target.value })}
                maxLength={64}
                inputMode={isTaboola ? "numeric" : undefined}
                placeholder={campoId?.exemplo}
              />
            </Field>
          </div>

          {isMeta && (
            <div className="mt-5">
              <Field label="Token de acesso (Conversions API)">
                <input
                  className={input}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={draft.accessTokenConfigured ? "••••••••••••" : "Opcional - Token para envio via API"}
                  autoComplete="off"
                  maxLength={500}
                />
              </Field>
            </div>
          )}

          {draft.type === "google" && (
            <div className="mt-5">
              <Field label="Rótulo de conversão">
                <input className={input} value={draft.conversionLabel} onChange={(e) => setDraft({ ...draft, conversionLabel: e.target.value })} maxLength={120} />
              </Field>
            </div>
          )}

          {isGa4 && (
            <div className="mt-5">
              <Field label="Chave secreta da API (recomendado)">
                <input
                  className={input}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={draft.accessTokenConfigured ? "••••••••••••" : "Opcional - chave do Measurement Protocol"}
                  autoComplete="off"
                  maxLength={200}
                />
              </Field>
            </div>
          )}

          {/* No Analytics a compra já só conta com o pagamento aprovado, e ligar
              isto apagaria o funil, que é o motivo de ter o Analytics. */}
          {!isGa4 && (
            <div className="mt-5 flex items-center gap-3">
              <Switch checked={draft.paidOnly} onChange={(v) => setDraft({ ...draft, paidOnly: v })} />
              <span className="text-sm font-medium text-mid">Disparar apenas em vendas pagas</span>
            </div>
          )}

          <div className="mt-6 flex items-center gap-3">
            <button onClick={saveDraft} disabled={saving} className="flex-shrink-0 whitespace-nowrap rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {saving ? "Salvando..." : isGa4 ? "Salvar" : "Salvar pixel"}
            </button>
            <button onClick={() => setView("list")} className="text-sm font-medium text-low hover:text-hi">
              Cancelar
            </button>
            {msg && <span className="text-sm text-red-500">{msg}</span>}
          </div>
        </div>
      </div>
    );
  }

  // ── Lista ──
  return (
    <div>
      <h1 className="text-2xl font-bold text-hi">Pixels</h1>
      <p className="mt-1 text-sm text-low">
        Configure os pixels de rastreamento das suas campanhas (Meta, Google Ads, Google Analytics, TikTok, Kwai, Pinterest e Taboola).
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        {(["meta", "google", "ga4", "tiktok", "kwai", "pinterest", "taboola"] as const).map((t) => (
          <button
            key={t}
            onClick={() => startCreate(t)}
            className="flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-semibold text-mid transition hover:bg-hover"
          >
            <PixelLogo type={t} size={28} /> Criar {NOME_PLATAFORMA[t]}
            {t !== "ga4" && " pixel"}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        {pixels.length === 0 && (
          <div className="rounded-xl bg-card p-8 text-center text-sm text-dim">
            Nenhum pixel configurado ainda.
          </div>
        )}
        {pixels.map((p) => (
          <div key={p.id} className="flex items-center gap-4 rounded-xl bg-card p-4">
            <PixelLogo type={p.type} size={36} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold text-hi">{p.name || "(sem nome)"}</span>
                <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-low">
                  {NOME_PLATAFORMA[p.type] ?? p.type}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-dim">
                ID: {p.pixelId}
                {p.type === "meta" && p.accessTokenConfigured && " · CAPI ativa"}
                {p.type === "ga4" && p.accessTokenConfigured && " · compras enviadas pelo servidor"}
                {p.type === "google" && p.conversionLabel && ` · rótulo: ${p.conversionLabel}`}
                {p.paidOnly && " · só vendas pagas"}
              </div>
            </div>
            <Switch checked={p.enabled} onChange={() => toggleEnabled(p)} />
            <button onClick={() => startEdit(p)} className="text-sm font-medium text-low hover:text-hi">Editar</button>
            <button onClick={() => remove(p)} className="text-sm font-medium text-red-500 hover:text-red-700">Excluir</button>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-dim">
        O token da Conversions API (Meta) e a chave do Google Analytics são criptografados (AES-256-GCM) no banco e nunca
        são exibidos novamente.
      </p>
    </div>
  );
}

// ── Subcomponentes ──
const input =
  "w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-bold text-hi">{label}</span>
      {children}
    </label>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`}
      aria-pressed={checked}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function IconBack() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}
