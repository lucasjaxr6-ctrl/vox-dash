"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Aba de rastreamento. Mantém o que o modal antigo fazia: salvar o código,
 * marcar o pedido como ENVIADO, mandar o e-mail ao cliente e empurrar o código
 * para o gateway que processou a venda (o /api/painel/orders/tracking cuida de
 * tudo isso). Só pedido pago aceita rastreio.
 */
export default function TrackingPanel({
  orderId,
  initialCode,
  canTrack,
  sentAt,
}: {
  orderId: string;
  initialCode: string | null;
  canTrack: boolean;
  sentAt: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function send() {
    const c = code.trim();
    if (c.length < 3) return setMsg({ ok: false, text: "Informe o código." });
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/orders/tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, trackingCode: c }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, text: d?.error ?? "Falha ao enviar." });
      setMsg({ ok: true, text: "Código salvo e e-mail de rastreio enviado ao cliente." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponível */
    }
  }

  return (
    <div className="px-5 py-5">
      {!canTrack ? (
        <p className="py-6 text-center text-sm text-low">
          O rastreio fica disponível depois que o pagamento for aprovado.
        </p>
      ) : (
        <>
          <label className="block text-low text-[12px] font-medium">
            Código de rastreio
          </label>
          <div className="mt-2 flex max-w-xl flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Ex.: ZA07254180501"
              maxLength={120}
              className="min-w-[200px] flex-1 rounded-lg border border-line bg-card px-3 py-2 text-sm text-hi outline-none placeholder:text-dim focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button
              onClick={send}
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Salvando..." : initialCode ? "Reenviar" : "Salvar"}
            </button>
            {initialCode && (
              <button
                onClick={copy}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-mid transition hover:bg-hover"
              >
                {copied ? "Copiado!" : "Copiar"}
              </button>
            )}
          </div>

          {msg && (
            <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
          )}

          <p className="mt-3 text-xs leading-relaxed text-dim">
            Salvar marca o pedido como <b>Enviado</b>, dispara o e-mail com o código para o cliente e
            registra o rastreio no gateway que processou a venda.
          </p>

          {initialCode && (
            <a
              href={`https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(initialCode)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-[13px] font-semibold text-brand hover:underline"
            >
              Rastrear nos Correios →
            </a>
          )}
          {sentAt && <p className="mt-3 text-xs text-dim">E-mail de separação enviado em {sentAt}.</p>}
        </>
      )}
    </div>
  );
}
