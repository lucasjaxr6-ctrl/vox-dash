"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Responder um e-mail da caixa da Vox.
 *
 * Sai pela conta Resend DA PLATAFORMA (nunca pela de uma loja) e com
 * `reply_to` no endereço da caixa, para a próxima resposta voltar para cá em
 * vez de morrer num noreply.
 */
export default function PlatformInboxReply({
  id,
  para,
  podeResponder,
}: {
  id: string;
  para: string;
  podeResponder: boolean;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/inbox/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, message: texto.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, texto: data?.error ?? "Erro ao enviar." });
      setTexto("");
      setMsg({ ok: true, texto: "Resposta enviada." });
      // A resposta vai para a aba Enviados: atualiza para ela aparecer lá.
      router.refresh();
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-6 border-t border-line pt-5">
      <label className="block text-sm font-bold text-hi">Responder a {para}</label>
      {!podeResponder && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          Configure a chave do Resend e o remetente em Configurações › E-mail da Vox para poder responder.
        </p>
      )}
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        disabled={!podeResponder}
        placeholder="Escreva sua resposta..."
        className="mt-2 w-full resize-y rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-soft"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={enviar}
          disabled={enviando || !texto.trim() || !podeResponder}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Enviando..." : "Enviar resposta"}
        </button>
        {msg && (
          <span className={`text-sm font-semibold ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.texto}</span>
        )}
      </div>
    </div>
  );
}
