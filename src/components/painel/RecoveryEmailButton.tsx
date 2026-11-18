"use client";

import { useState } from "react";

/**
 * Manda o e-mail de recuperação de um carrinho.
 *
 * Fica desabilitado quando não há e-mail do cliente ou quando a recuperação
 * está desligada — em vez de deixar clicar e falhar, o motivo aparece no
 * próprio botão. E depois de enviado ele NÃO volta ao estado inicial: reenviar
 * por engano é insistência em cima de quem não comprou.
 */
export default function RecoveryEmailButton({
  cartId,
  temEmail,
  ativo,
  situacao,
}: {
  cartId: string;
  temEmail: boolean;
  ativo: boolean;
  /** "agendado" (marcado no Resend, ainda vai sair) ou "enviado" (já saiu). */
  situacao: "nenhum" | "agendado" | "enviado";
}) {
  const [estado, setEstado] = useState<"pronto" | "enviando" | "enviado" | "erro">("pronto");
  const [erro, setErro] = useState<string | null>(null);

  if (!temEmail) {
    return <span className="text-xs text-dim" title="Este carrinho não tem e-mail">—</span>;
  }
  if (!ativo) {
    return (
      <span className="text-xs text-dim" title="Ative a recuperação em E-mails › Configuração">
        desligado
      </span>
    );
  }

  async function enviar() {
    setEstado("enviando");
    setErro(null);
    try {
      const r = await fetch("/api/painel/carrinhos/recuperar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErro(j?.error ?? "Falha ao enviar.");
        setEstado("erro");
        return;
      }
      setEstado("enviado");
    } catch {
      setErro("Erro de rede.");
      setEstado("erro");
    }
  }

  if (estado === "enviado" || situacao === "enviado") {
    return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">enviado</span>;
  }
  // Agendado: o e-mail já está marcado no Resend e sai sozinho. O botão segue
  // clicável para ANTECIPAR — e o servidor cancela o agendado antes de mandar,
  // então o cliente nunca recebe dois.
  if (situacao === "agendado" && estado === "pronto") {
    return (
      <button
        onClick={enviar}
        title="Já está agendado. Clique para enviar agora."
        className="rounded-full bg-soft px-2 py-1 text-[10px] font-bold text-mid transition hover:bg-hover hover:text-hi"
      >
        agendado
      </button>
    );
  }

  return (
    <button
      onClick={enviar}
      disabled={estado === "enviando"}
      title={erro ?? "Enviar e-mail de recuperação"}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-50 ${
        estado === "erro"
          ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
          : "bg-soft text-mid hover:bg-hover hover:text-hi"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m2 7 10 6 10-6" />
      </svg>
    </button>
  );
}
