"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENT_HINT,
  type WebhookEvent,
} from "@/lib/webhook-events";

type Webhook = {
  id: string;
  name: string;
  url: string;
  token: string;
  events: WebhookEvent[];
  enabled: boolean;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Token opaco (32 caracteres A-Z0-9) gerado com CSPRNG do navegador. */
function newToken() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function emptyDraft(): Webhook {
  return { id: uid(), name: "", url: "", token: newToken(), events: [], enabled: true };
}

export default function WebhooksManager() {
  const [items, setItems] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // null = tela de lista; caso contrário, o webhook em edição/criação.
  const [draft, setDraft] = useState<Webhook | null>(null);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/painel/webhooks");
        if (res.ok) {
          const { webhooks } = await res.json();
          setItems(
            (webhooks as Webhook[]).map((w) => ({
              ...w,
              id: w.id || uid(),
              events: Array.isArray(w.events) ? w.events : [],
            })),
          );
        }
      } catch {
        /* silencioso */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** Persiste a lista inteira. Devolve true quando gravou. */
  async function persist(list: Webhook[], okText: string) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/webhooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhooks: list.map((w) => ({
            id: w.id,
            name: w.name.trim(),
            url: w.url.trim(),
            token: w.token,
            events: w.events,
            enabled: w.enabled,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error ?? "Erro ao salvar." });
        return false;
      }
      setItems(Array.isArray(data.webhooks) ? data.webhooks : list);
      setMsg({ kind: "ok", text: okText });
      return true;
    } catch {
      setMsg({ kind: "err", text: "Erro de rede." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  function openNew() {
    setDraft(emptyDraft());
    setIsNew(true);
    setMsg(null);
  }
  function openEdit(w: Webhook) {
    setDraft({ ...w, events: [...w.events] });
    setIsNew(false);
    setMsg(null);
  }

  async function submitDraft() {
    if (!draft) return;
    if (!draft.name.trim()) return setMsg({ kind: "err", text: "Informe o nome do webhook." });
    if (!draft.url.trim().startsWith("https://")) {
      return setMsg({ kind: "err", text: "A URL precisa começar com https://." });
    }
    if (draft.events.length === 0) return setMsg({ kind: "err", text: "Selecione ao menos um evento." });

    const exists = items.some((w) => w.id === draft.id);
    const list = exists ? items.map((w) => (w.id === draft.id ? draft : w)) : [...items, draft];
    const ok = await persist(list, exists ? "Webhook atualizado!" : "Webhook adicionado!");
    if (ok) setDraft(null);
  }

  async function remove(w: Webhook) {
    if (!confirm(`Remover o webhook "${w.name}"?`)) return;
    const ok = await persist(items.filter((i) => i.id !== w.id), "Webhook removido.");
    if (ok) setDraft(null);
  }

  async function toggleEnabled(w: Webhook) {
    await persist(
      items.map((i) => (i.id === w.id ? { ...i, enabled: !i.enabled } : i)),
      w.enabled ? "Webhook desativado." : "Webhook ativado.",
    );
  }

  async function test(w: Webhook) {
    if (!w.url.trim()) return;
    setTestingId(w.id);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: w.url.trim(), token: w.token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ kind: "err", text: data?.error ?? "Falha ao enviar o teste." });
      setMsg({ kind: "ok", text: "Notificação de teste enviada!" });
    } catch {
      setMsg({ kind: "err", text: "Erro de rede." });
    } finally {
      setTestingId(null);
    }
  }

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  const banner = msg && (
    <p
      className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${
        msg.kind === "ok"
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "bg-red-500/10 text-red-600 dark:text-red-400"
      }`}
    >
      {msg.text}
    </p>
  );

  // ── Formulário (criar / editar) ──
  if (draft) {
    return (
      <WebhookForm
        draft={draft}
        isNew={isNew}
        saving={saving}
        banner={banner}
        onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
        onCancel={() => {
          setDraft(null);
          setMsg(null);
        }}
        onSubmit={submitDraft}
        onDelete={items.some((w) => w.id === draft.id) ? () => remove(draft) : undefined}
      />
    );
  }

  // ── Lista ──
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-hi">Webhooks</h1>
          <p className="mt-1 text-sm text-low">
            Envie os eventos da sua loja para qualquer URL que aceite um POST em JSON.
          </p>
        </div>
        <button
          onClick={openNew}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover"
        >
          + Novo webhook
        </button>
      </div>

      {banner}

      {items.length === 0 ? (
        <div className="mt-5 rounded-xl bg-card p-10 text-center">
          <p className="text-sm font-semibold text-mid">Nenhum webhook cadastrado</p>
          <p className="mt-1 text-sm text-dim">
            Clique em <b>+ Novo webhook</b> para receber os eventos de pedidos em tempo real.
          </p>
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-low text-[12px] font-medium">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">URL</th>
                  <th className="px-4 py-3">Eventos</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((w) => (
                  <tr key={w.id} className="hover:bg-hover">
                    <td className="px-4 py-3 font-semibold text-hi">{w.name}</td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-mid" title={w.url}>
                      {w.url}
                    </td>
                    <td className="px-4 py-3 text-mid">
                      {w.events.length === 0
                        ? "—"
                        : w.events.length <= 2
                          ? w.events.map((e) => WEBHOOK_EVENT_LABEL[e]).join(", ")
                          : `${w.events.length} eventos`}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleEnabled(w)}
                        disabled={saving}
                        className={`rounded-full px-2.5 py-1 text-xs font-bold disabled:opacity-60 ${
                          w.enabled
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-soft text-dim"
                        }`}
                      >
                        {w.enabled ? "Ativo" : "Inativo"}
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button
                        onClick={() => test(w)}
                        disabled={testingId === w.id}
                        className="text-sm font-semibold text-mid hover:text-hi disabled:opacity-50"
                      >
                        {testingId === w.id ? "Enviando..." : "Testar"}
                      </button>
                      <button
                        onClick={() => openEdit(w)}
                        className="ml-4 text-sm font-semibold text-brand hover:underline"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function WebhookForm({
  draft,
  isNew,
  saving,
  banner,
  onChange,
  onCancel,
  onSubmit,
  onDelete,
}: {
  draft: Webhook;
  isNew: boolean;
  saving: boolean;
  banner: React.ReactNode;
  onChange: (patch: Partial<Webhook>) => void;
  onCancel: () => void;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const selected = useMemo(() => new Set(draft.events), [draft.events]);

  function toggleEvent(e: WebhookEvent) {
    onChange({
      events: selected.has(e) ? draft.events.filter((x) => x !== e) : [...draft.events, e],
    });
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(draft.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard bloqueado: o campo continua selecionável */
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-hi">{isNew ? "Criar webhook" : "Editar webhook"}</h1>
          <p className="mt-1 text-sm text-low">
            Escolha um nome, informe a URL de destino e selecione os eventos.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-mid hover:bg-hover"
        >
          Voltar
        </button>
      </div>

      {banner}

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl bg-card p-6 lg:col-span-2">
          <label className="block text-sm font-semibold text-mid">Nome</label>
          <input
            value={draft.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Ex.: Notificações de venda"
            maxLength={100}
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-hi outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />

          <label className="mt-5 block text-sm font-semibold text-mid">URL</label>
          <input
            value={draft.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://seu-servidor.com/webhook"
            maxLength={500}
            className="mt-1.5 w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-hi outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
          <p className="mt-1.5 text-xs text-dim">Precisa começar com https://.</p>

          <label className="mt-5 block text-sm font-semibold text-mid">Token</label>
          <div className="mt-1.5 flex gap-2">
            <input
              value={draft.token}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-line bg-soft px-3 py-2.5 font-mono text-xs text-mid outline-none"
            />
            <button
              type="button"
              onClick={copyToken}
              className="whitespace-nowrap rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-mid hover:bg-hover"
            >
              {copied ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-dim">
            Enviado no header <code className="rounded bg-soft px-1">X-Webhook-Token</code> em toda
            chamada, para o seu servidor confirmar que a requisição veio da sua loja.
          </p>

          <div className="mt-6 pt-5">
            <p className="text-sm font-semibold text-mid">Eventos</p>
            <p className="mt-1 text-xs text-dim">Selecione o que você quer receber nesta URL.</p>
            <div className="mt-3 space-y-2">
              {WEBHOOK_EVENTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => toggleEvent(e)}
                  aria-pressed={selected.has(e)}
                  className="flex w-full items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-hover"
                >
                  <SwitchVisual checked={selected.has(e)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-hi">{WEBHOOK_EVENT_LABEL[e]}</span>
                    <span className="block text-xs text-dim">{WEBHOOK_EVENT_HINT[e]}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onSubmit}
              disabled={saving}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60"
            >
              {saving ? "Salvando..." : isNew ? "Adicionar webhook" : "Salvar alterações"}
            </button>
            <button
              onClick={onCancel}
              className="rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-mid hover:bg-hover"
            >
              Cancelar
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                disabled={saving}
                className="ml-auto text-sm font-semibold text-red-500 hover:text-red-700 disabled:opacity-60"
              >
                Remover webhook
              </button>
            )}
          </div>
        </div>

        <div className="h-fit rounded-xl bg-card p-6">
          <h2 className="text-sm font-bold text-hi">Status do webhook</h2>
          <p className="mt-1 text-xs text-dim">
            Desative para parar de enviar sem perder a configuração.
          </p>
          <button
            type="button"
            onClick={() => onChange({ enabled: !draft.enabled })}
            aria-pressed={draft.enabled}
            className="mt-4 flex items-center gap-3"
          >
            <SwitchVisual checked={draft.enabled} />
            <span className="text-sm font-semibold text-mid">{draft.enabled ? "Ativo" : "Inativo"}</span>
          </button>

          <div className="mt-5 pt-4 text-xs text-dim">
            <p className="font-semibold text-mid">O que enviamos</p>
            <p className="mt-1">
              Um POST em JSON com <code className="rounded bg-soft px-1">title</code>,{" "}
              <code className="rounded bg-soft px-1">text</code>,{" "}
              <code className="rounded bg-soft px-1">event</code> e os dados do pedido. Responda com
              2xx para confirmar o recebimento.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Só o visual do interruptor — quem clica é a linha inteira (um <button>). */
function SwitchVisual({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative block h-6 w-11 flex-shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </span>
  );
}
