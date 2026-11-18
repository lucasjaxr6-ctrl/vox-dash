"use client";

import React, { useEffect, useState } from "react";

type Coupon = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  active: boolean;
  minOrderCents: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null;
};

type Draft = {
  id?: string;
  code: string;
  type: "PERCENT" | "FIXED";
  valueStr: string; // % (PERCENT) ou reais (FIXED)
  minOrderStr: string; // reais
  maxStr: string;
  expiresAt: string; // YYYY-MM-DD
  active: boolean;
};

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const emptyDraft: Draft = {
  code: "",
  type: "PERCENT",
  valueStr: "",
  minOrderStr: "",
  maxStr: "",
  expiresAt: "",
  active: true,
};

export default function CouponsManager() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "form">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/painel/coupons");
      if (res.ok) {
        const { coupons: list } = await res.json();
        setCoupons(list);
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function startCreate() {
    setDraft(emptyDraft);
    setMsg(null);
    setView("form");
  }
  function startEdit(c: Coupon) {
    setDraft({
      id: c.id,
      code: c.code,
      type: c.type,
      valueStr: c.type === "PERCENT" ? String(c.value) : (c.value / 100).toFixed(2),
      minOrderStr: c.minOrderCents != null ? (c.minOrderCents / 100).toFixed(2) : "",
      maxStr: c.maxRedemptions != null ? String(c.maxRedemptions) : "",
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : "",
      active: c.active,
    });
    setMsg(null);
    setView("form");
  }

  function buildPayload() {
    const value =
      draft.type === "PERCENT"
        ? parseInt(draft.valueStr || "0", 10)
        : Math.round(parseFloat(draft.valueStr || "0") * 100);
    const minOrderCents = draft.minOrderStr.trim()
      ? Math.round(parseFloat(draft.minOrderStr) * 100)
      : null;
    const maxRedemptions = draft.maxStr.trim() ? parseInt(draft.maxStr, 10) : null;
    return {
      code: draft.code.trim().toUpperCase(),
      type: draft.type,
      value,
      active: draft.active,
      minOrderCents,
      maxRedemptions,
      expiresAt: draft.expiresAt || null,
    };
  }

  async function save() {
    if (!draft.code.trim()) return setMsg("Informe o código.");
    const payload = buildPayload();
    if (!payload.value || payload.value <= 0) return setMsg("Informe um valor de desconto válido.");
    if (draft.type === "PERCENT" && (payload.value < 1 || payload.value > 100)) {
      return setMsg("Percentual deve ser entre 1 e 100.");
    }
    setSaving(true);
    setMsg(null);
    try {
      const url = draft.id ? `/api/painel/coupons/${draft.id}` : "/api/painel/coupons";
      const method = draft.id ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Erro ao salvar.");
        return;
      }
      await load();
      setView("list");
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(c: Coupon) {
    if (!confirm(`Excluir o cupom "${c.code}"?`)) return;
    try {
      const res = await fetch(`/api/painel/coupons/${c.id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  async function toggleActive(c: Coupon) {
    try {
      const res = await fetch(`/api/painel/coupons/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: c.code,
          type: c.type,
          value: c.value,
          active: !c.active,
          minOrderCents: c.minOrderCents,
          maxRedemptions: c.maxRedemptions,
          expiresAt: c.expiresAt ? c.expiresAt.slice(0, 10) : null,
        }),
      });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  // ── Formulário ──
  if (view === "form") {
    const isPercent = draft.type === "PERCENT";
    return (
      <div>
        <button onClick={() => setView("list")} className="flex items-center gap-1 text-sm text-low hover:text-hi">
          <IconBack /> ver todos
        </button>
        <h1 className="mt-2 text-3xl font-bold text-mid">{draft.id ? "Editar" : "Criar"} cupom</h1>

        <div className="mt-6 max-w-2xl rounded-xl bg-card p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Código">
              <input className={`${input} uppercase`} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="PROMO10" maxLength={64} />
            </Field>
            <Field label="Tipo de desconto">
              <select className={input} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as Draft["type"] })}>
                <option value="PERCENT">Percentual (%)</option>
                <option value="FIXED">Valor fixo (R$)</option>
              </select>
            </Field>
            <Field label={isPercent ? "Desconto (%)" : "Desconto (R$)"}>
              <input className={input} inputMode="decimal" value={draft.valueStr} onChange={(e) => setDraft({ ...draft, valueStr: e.target.value })} placeholder={isPercent ? "10" : "5,00"} />
            </Field>
            <Field label="Pedido mínimo (R$) — opcional">
              <input className={input} inputMode="decimal" value={draft.minOrderStr} onChange={(e) => setDraft({ ...draft, minOrderStr: e.target.value })} placeholder="0,00" />
            </Field>
            <Field label="Limite de usos — opcional">
              <input className={input} inputMode="numeric" value={draft.maxStr} onChange={(e) => setDraft({ ...draft, maxStr: e.target.value })} placeholder="Ilimitado" />
            </Field>
            <Field label="Expira em — opcional">
              <input className={input} type="date" value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} />
            </Field>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
            <span className="text-sm font-medium text-mid">Cupom ativo</span>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {saving ? "Salvando..." : "Salvar cupom"}
            </button>
            <button onClick={() => setView("list")} className="text-sm font-medium text-low hover:text-hi">Cancelar</button>
            {msg && <span className="text-sm text-red-500">{msg}</span>}
          </div>
        </div>
      </div>
    );
  }

  // ── Lista ──
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-hi">Cupons</h1>
          <p className="mt-1 text-sm text-low">Crie cupons de desconto para o seu checkout.</p>
        </div>
        <button onClick={startCreate} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover">
          Criar cupom
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {coupons.length === 0 && (
          <div className="rounded-xl bg-card p-8 text-center text-sm text-dim">
            Nenhum cupom criado ainda.
          </div>
        )}
        {coupons.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <IconTag />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold uppercase text-hi">{c.code}</span>
                <span className="rounded bg-soft px-1.5 py-0.5 text-xs font-bold text-mid">
                  {c.type === "PERCENT" ? `${c.value}% OFF` : `${brl(c.value)} OFF`}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-dim">
                {c.minOrderCents != null && `mín. ${brl(c.minOrderCents)} · `}
                {c.maxRedemptions != null ? `${c.timesRedeemed}/${c.maxRedemptions} usos` : `${c.timesRedeemed} usos`}
                {c.expiresAt && ` · expira ${c.expiresAt.slice(0, 10).split("-").reverse().join("/")}`}
              </div>
            </div>
            <Switch checked={c.active} onChange={() => toggleActive(c)} />
            <button onClick={() => startEdit(c)} className="text-sm font-medium text-low hover:text-hi">Editar</button>
            <button onClick={() => remove(c)} className="text-sm font-medium text-red-500 hover:text-red-700">Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subcomponentes ──
const input =
  "mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-bold text-hi">{label}</span>
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
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>);
}
function IconTag() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>);
}
