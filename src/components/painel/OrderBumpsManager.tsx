"use client";

import React, { useEffect, useState } from "react";
import { thumb } from "@/lib/image";

type Product = { id: string; name: string; priceCents: number; imageUrl: string | null; active: boolean };
type Bump = {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  active: boolean;
  position: number;
  product: { name: string; priceCents: number; imageUrl: string | null } | null;
};
type Draft = { id?: string; productId: string; title: string; description: string; active: boolean; position: number };

const emptyDraft: Draft = { productId: "", title: "", description: "", active: true, position: 0 };

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function OrderBumpsManager() {
  const [bumps, setBumps] = useState<Bump[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "form">("list");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [bRes, pRes] = await Promise.all([
        fetch("/api/painel/order-bumps"),
        fetch("/api/admin/products"),
      ]);
      if (bRes.ok) setBumps((await bRes.json()).bumps);
      if (pRes.ok) setProducts(((await pRes.json()).products as Product[]).filter((p) => p.active));
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
    setDraft({ ...emptyDraft, productId: products[0]?.id ?? "" });
    setMsg(null);
    setView("form");
  }
  function startEdit(b: Bump) {
    setDraft({ id: b.id, productId: b.productId, title: b.title, description: b.description ?? "", active: b.active, position: b.position });
    setMsg(null);
    setView("form");
  }

  async function save() {
    if (!draft.productId) return setMsg("Escolha o produto da oferta.");
    if (draft.title.trim().length < 2) return setMsg("Informe um título.");
    setSaving(true);
    setMsg(null);
    try {
      const payload = {
        productId: draft.productId,
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        active: draft.active,
        position: Number(draft.position) || 0,
      };
      const url = draft.id ? `/api/painel/order-bumps/${draft.id}` : "/api/painel/order-bumps";
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

  async function remove(b: Bump) {
    if (!confirm(`Excluir o order bump "${b.title}"?`)) return;
    try {
      const res = await fetch(`/api/painel/order-bumps/${b.id}`, { method: "DELETE" });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  async function toggleActive(b: Bump) {
    try {
      const res = await fetch(`/api/painel/order-bumps/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: b.productId, title: b.title, description: b.description || undefined, active: !b.active, position: b.position }),
      });
      if (res.ok) await load();
    } catch {
      /* silencioso */
    }
  }

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  // ── Formulário ──
  if (view === "form") {
    const selected = products.find((p) => p.id === draft.productId);
    return (
      <div>
        <button onClick={() => setView("list")} className="flex items-center gap-1 text-sm text-low hover:text-hi">
          <IconBack /> ver todos
        </button>
        <h1 className="mt-2 text-3xl font-bold text-mid">{draft.id ? "Editar" : "Criar"} order bump</h1>

        {products.length === 0 ? (
          <div className="mt-6 max-w-2xl rounded-xl bg-card p-8 text-center text-sm text-low">
            Você precisa ter ao menos um produto ativo para criar um order bump.{" "}
            <a href="/painel/produtos" className="font-semibold text-brand hover:underline">Criar produto</a>
          </div>
        ) : (
          <div className="mt-6 max-w-2xl rounded-xl bg-card p-6">
            <Field label="Produto oferecido">
              <select className={input} value={draft.productId} onChange={(e) => setDraft({ ...draft, productId: e.target.value })}>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {brl(p.priceCents)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-dim">O preço cobrado é sempre o do produto. Crie um produto com o preço da oferta.</p>
            </Field>

            <Field label="Título (chamada da oferta)" className="mt-5">
              <input className={input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ex.: Adicione a garantia estendida" maxLength={120} />
            </Field>

            <Field label="Descrição (opcional)" className="mt-5">
              <textarea className={`${input} min-h-[80px] resize-y`} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Detalhe o benefício da oferta..." maxLength={300} />
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

            {/* Prévia */}
            {selected && (
              <div className="mt-6">
                <span className="block text-sm font-bold text-hi">Prévia no checkout</span>
                <div className="mt-2 flex items-center gap-3 rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 p-3">
                  <input type="checkbox" checked readOnly className="h-5 w-5 accent-brand" />
                  {selected.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb(selected.imageUrl, 48)} alt={selected.name} className="h-12 w-12 rounded-lg border border-line object-cover" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-soft" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-hi">{draft.title || "Título da oferta"}</div>
                    {draft.description && <div className="truncate text-xs text-low">{draft.description}</div>}
                  </div>
                  <span className="text-sm font-bold text-hi">{brl(selected.priceCents)}</span>
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
                {saving ? "Salvando..." : "Salvar order bump"}
              </button>
              <button onClick={() => setView("list")} className="text-sm font-medium text-low hover:text-hi">Cancelar</button>
              {msg && <span className="text-sm text-red-500">{msg}</span>}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Lista ──
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-hi">Order bump</h1>
          <p className="mt-1 text-sm text-low">Ofereça um produto adicional na finalização da compra — o cliente adiciona com um clique.</p>
        </div>
        <button onClick={startCreate} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover">
          Criar order bump
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {bumps.length === 0 && (
          <div className="rounded-xl bg-card p-8 text-center text-sm text-dim">
            Nenhum order bump criado ainda.
          </div>
        )}
        {bumps.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-4 rounded-xl bg-card p-4">
            {b.product?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb(b.product.imageUrl, 48)} alt={b.title} className="h-12 w-12 flex-shrink-0 rounded-lg border border-line object-cover" />
            ) : (
              <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-gradient-to-br from-gray-200 to-gray-300" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-hi">{b.title}</div>
              <p className="mt-0.5 truncate text-xs text-dim">
                {b.product ? `${b.product.name} • ${brl(b.product.priceCents)}` : "Produto removido"}
              </p>
            </div>
            <Switch checked={b.active} onChange={() => toggleActive(b)} />
            <button onClick={() => startEdit(b)} className="text-sm font-medium text-low hover:text-hi">Editar</button>
            <button onClick={() => remove(b)} className="text-sm font-medium text-red-500 hover:text-red-700">Excluir</button>
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
