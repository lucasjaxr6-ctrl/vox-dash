"use client";

import React, { useState } from "react";

export default function InboxReply({ id, para }: { id: string; para: string }) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, message: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(data?.error ?? "Erro ao enviar.");
      setReply("");
      setMsg("Resposta enviada! ✅");
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 pt-5">
      <label className="block text-sm font-bold text-hi">Responder a {para}</label>
      <textarea
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        rows={5}
        placeholder="Escreva sua resposta..."
        className="mt-2 w-full resize-y rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={send}
          disabled={sending || !reply.trim()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50"
        >
          {sending ? "Enviando..." : "Enviar resposta"}
        </button>
        {msg && <span className="text-sm text-mid">{msg}</span>}
      </div>
    </div>
  );
}
