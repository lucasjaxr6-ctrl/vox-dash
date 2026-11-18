"use client";

import React, { useEffect, useState } from "react";
import ImageUpload from "@/components/painel/ImageUpload";

type Review = {
  id: string;
  name: string;
  stars: number;
  text: string;
  photoUrl: string | null;
  position: number;
  active: boolean;
};

type Draft = {
  id?: string;
  name: string;
  stars: number;
  text: string;
  photoUrl: string;
  position: number;
  active: boolean;
};

const emptyDraft: Draft = { name: "", stars: 5, text: "", photoUrl: "", position: 0, active: true };

export default function ReviewsManager() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "form">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/painel/reviews");
      if (res.ok) {
        const { reviews: list } = await res.json();
        setReviews(list);
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
  function startEdit(r: Review) {
    setDraft({ id: r.id, name: r.name, stars: r.stars, text: r.text, photoUrl: r.photoUrl ?? "", position: r.position, active: r.active });
    setMsg(null);
    setView("form");
  }

  async function save() {
    if (!draft.name.trim() || !draft.text.trim()) return setMsg("Preencha nome e mensagem.");
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        name: draft.name.trim(),
        stars: draft.stars,
        text: draft.text.trim(),
        photoUrl: draft.photoUrl || null,
        position: Number(draft.position) || 0,
        active: draft.active,
      };
      const url = draft.id ? `/api/painel/reviews/${draft.id}` : "/api/painel/reviews";
      const res = await fetch(url, {
        method: draft.id ? "PUT" : "POST",
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

  async function remove(r: Review) {
    if (!confirm(`Excluir a avaliação de "${r.name}"?`)) return;
    try {
      const res = await fetch(`/api/painel/reviews/${r.id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  async function toggleActive(r: Review) {
    try {
      const res = await fetch(`/api/painel/reviews/${r.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.name, stars: r.stars, text: r.text, photoUrl: r.photoUrl, position: r.position, active: !r.active }),
      });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  // ── Formulário ──
  if (view === "form") {
    return (
      <div>
        <button onClick={() => setView("list")} className="flex items-center gap-1 text-sm text-low hover:text-hi">
          <IconBack /> ver todas
        </button>
        <h1 className="mt-2 text-3xl font-bold text-mid">{draft.id ? "Editar" : "Criar"} avaliação</h1>

        <div className="mt-6 max-w-2xl rounded-xl bg-card p-6">
          <Field label="Foto (opcional)">
            <ImageUpload value={draft.photoUrl} onChange={(url) => setDraft({ ...draft, photoUrl: url })} label="foto" className="mt-1" />
          </Field>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Nome">
              <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nome do cliente" maxLength={120} />
            </Field>
            <Field label="Estrelas">
              <StarPicker value={draft.stars} onChange={(s) => setDraft({ ...draft, stars: s })} />
            </Field>
          </div>

          <Field label="Mensagem" className="mt-5">
            <textarea className={`${input} min-h-[90px] resize-y`} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="O que o cliente achou..." maxLength={500} />
          </Field>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field label="Ordem (menor aparece primeiro)">
              <input className={input} type="number" min={0} value={draft.position} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })} />
            </Field>
            <div className="flex items-end gap-3 pb-1">
              <Switch checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} />
              <span className="text-sm font-medium text-mid">Exibir no checkout</span>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {saving ? "Salvando..." : "Salvar avaliação"}
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
          <h1 className="text-2xl font-bold text-hi">Provas sociais</h1>
          <p className="mt-1 text-sm text-low">Avaliações exibidas no checkout (nome, estrelas, mensagem e foto).</p>
        </div>
        <button onClick={startCreate} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover">
          Criar avaliação
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {reviews.length === 0 && (
          <div className="rounded-xl bg-card p-8 text-center text-sm text-dim">
            Nenhuma avaliação criada ainda. (O checkout mostra exemplos enquanto não houver nenhuma.)
          </div>
        )}
        {reviews.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-4">
            {r.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.photoUrl} alt={r.name} className="h-12 w-12 flex-shrink-0 rounded-full object-cover" />
            ) : (
              <div className="h-12 w-12 flex-shrink-0 rounded-full bg-gradient-to-br from-gray-200 to-gray-300" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-hi">{r.name}</span>
                <Stars n={r.stars} />
              </div>
              <p className="mt-0.5 truncate text-xs text-dim">{r.text}</p>
            </div>
            <Switch checked={r.active} onChange={() => toggleActive(r)} />
            <button onClick={() => startEdit(r)} className="text-sm font-medium text-low hover:text-hi">Editar</button>
            <button onClick={() => remove(r)} className="text-sm font-medium text-red-500 hover:text-red-700">Excluir</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Subcomponentes ──
const input =
  "mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm font-bold text-hi">{label}</span>
      {children}
    </label>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (s: number) => void }) {
  return (
    <div className="mt-1 flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} aria-label={`${s} estrelas`}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill={s <= value ? "#fbbf24" : "#e5e7eb"}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="flex">
      {[1, 2, 3, 4, 5].map((s) => (
        <svg key={s} width="14" height="14" viewBox="0 0 24 24" fill={s <= n ? "#fbbf24" : "#e5e7eb"}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`} aria-pressed={checked}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function IconBack() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>);
}
