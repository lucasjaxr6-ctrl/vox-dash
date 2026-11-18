"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { rotuloKind } from "@/lib/email-kinds";

// A lista NÃO recebe mais os corpos dos e-mails. Antes vinham os 100 htmlBody
// completos para o navegador só para desenhar linhas de assunto; o corpo agora
// é carregado na página do e-mail, que é quem precisa dele.
export type InboxItem = {
  id: string;
  fromAddr: string | null;
  fromName: string | null;
  subject: string | null;
  /** Primeiras palavras do que a pessoa escreveu, já sem o histórico citado. */
  preview: string | null;
  isRead: number;
  receivedAt: string;
};

export type SentItem = {
  id: string;
  toAddr: string | null;
  subject: string | null;
  kind: string | null;
  createdAt: string;
};

function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}


type Resultado = {
  id: string;
  direcao: "recebido" | "enviado";
  contato: string | null;
  nome: string | null;
  subject: string | null;
  preview: string | null;
  kind: string | null;
  isRead: number | null;
  quando: string;
};

export default function InboxManager({ emails, sent = [] }: { emails: InboxItem[]; sent?: SentItem[] }) {
  const [tab, setTab] = useState<"recebidos" | "enviados">("recebidos");
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  const unread = useMemo(() => emails.filter((e) => !e.isRead).length, [emails]);

  const termo = busca.trim();
  const buscaAtiva = termo.length >= 3;

  // A busca vai ao SERVIDOR: a lista abaixo traz só os 100 mais recentes, então
  // filtrar o que já está na tela não acharia um cliente de semanas atrás.
  useEffect(() => {
    if (!buscaAtiva) {
      setResultados(null);
      return;
    }
    const ctrl = new AbortController();
    // Espera a digitação parar — sem isto seria uma consulta por tecla.
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetch(`/api/painel/emails/busca?q=${encodeURIComponent(termo)}`, { signal: ctrl.signal });
        if (!res.ok) return setResultados([]);
        const data = await res.json();
        setResultados(data.resultados ?? []);
      } catch {
        // Abortada pela digitação seguinte: ignora, a próxima responde.
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [termo, buscaAtiva]);

  return (
    <div className="mt-6 space-y-5">
      {/* Busca por contato — cruza recebidos e enviados */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por e-mail ou nome do cliente…"
          className="w-full rounded-xl border border-line bg-card py-2.5 pl-9 pr-9 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        {busca && (
          <button
            onClick={() => setBusca("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-dim hover:bg-hover hover:text-mid"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {buscaAtiva ? (
        <div className="overflow-hidden rounded-2xl bg-card">
          <div className="px-5 py-3 text-sm text-mid">
            {buscando && resultados === null ? (
              "Buscando…"
            ) : (
              <>
                <b className="text-hi">{resultados?.length ?? 0}</b> e-mail
                {(resultados?.length ?? 0) === 1 ? "" : "s"} com <b className="text-hi">{termo}</b>
                <span className="text-dim"> · recebidos e enviados, do mais novo para o mais antigo</span>
              </>
            )}
          </div>
          {resultados && resultados.length === 0 && !buscando ? (
            <div className="px-5 py-16 text-center text-sm text-low">
              Nada encontrado para <b className="text-mid">{termo}</b>.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {(resultados ?? []).map((r) => (
                <li key={`${r.direcao}-${r.id}`}>
                  <Link
                    href={r.direcao === "recebido" ? `/painel/emails/caixa/${r.id}` : `/painel/emails/caixa/enviado/${r.id}`}
                    className="flex w-full items-start gap-3 px-5 py-3 text-left transition hover:bg-hover/60"
                  >
                    <span
                      className={`mt-0.5 flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        r.direcao === "recebido"
                          ? "bg-brand/10 text-brand"
                          : "bg-soft text-low"
                      }`}
                    >
                      {r.direcao === "recebido" ? "Recebido" : "Enviado"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-hi">
                          {r.direcao === "recebido" ? r.nome || r.contato : `Para: ${r.contato}`}
                        </span>
                        <span className="flex-shrink-0 text-xs text-dim">{fmtWhen(r.quando)}</span>
                      </div>
                      <div className="flex items-center gap-2 truncate">
                        {r.kind && (
                          <span className="flex-shrink-0 rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-low">
                            {rotuloKind(r.kind)}
                          </span>
                        )}
                        <span className="truncate text-sm text-low">{r.subject || "(sem assunto)"}</span>
                      </div>
                      {r.preview && <div className="truncate text-xs text-dim">{r.preview}</div>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (

      /* Lista — abas Recebidos / Enviados */
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="flex items-center gap-1 px-3 py-2">
          <button onClick={() => setTab("recebidos")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === "recebidos" ? "bg-brand/10 text-brand" : "text-low hover:bg-hover"}`}>
            Recebidos{unread > 0 && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
          </button>
          <button onClick={() => setTab("enviados")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${tab === "enviados" ? "bg-brand/10 text-brand" : "text-low hover:bg-hover"}`}>
            Enviados{sent.length > 0 && <span className="ml-1.5 text-xs text-dim">{sent.length}</span>}
          </button>
        </div>

        {tab === "recebidos" ? (
          emails.length === 0 ? (
            <div className="px-5 py-16 text-center text-sm text-low">
              Nenhum e-mail recebido ainda.{" "}
              {/* A configuração saiu desta tela; sem este atalho, quem chega com
                  a caixa vazia não descobre que falta ligar o Inbound. */}
              <Link href="/painel/emails" className="font-semibold text-brand hover:underline">
                Configure o recebimento
              </Link>{" "}
              e as mensagens aparecem aqui.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {emails.map((e) => {
                const isRead = Boolean(e.isRead);
                return (
                  <li key={e.id}>
                    <Link href={`/painel/emails/caixa/${e.id}`} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-hover/60">
                      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isRead ? "bg-transparent" : "bg-brand"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className={`truncate text-sm ${isRead ? "text-mid" : "font-bold text-hi"}`}>{e.fromName || e.fromAddr || "—"}</span>
                          <span className="flex-shrink-0 text-xs text-dim">{fmtWhen(e.receivedAt)}</span>
                        </div>
                        <div className={`truncate text-sm ${isRead ? "text-low" : "font-semibold text-hi"}`}>{e.subject || "(sem assunto)"}</div>
                        {/* Prévia do que a PESSOA escreveu, sem o histórico citado —
                            antes a lista mostrava só o assunto, quase sempre "Re: ...". */}
                        {e.preview && <div className="truncate text-xs text-dim">{e.preview}</div>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        ) : sent.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-low">
            Nenhum e-mail enviado ainda. Confirmações de pedido, rastreio, recuperação de Pix e respostas aparecem aqui.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sent.map((e) => (
              <li key={e.id}>
                <Link href={`/painel/emails/caixa/enviado/${e.id}`} className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-hover/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-hi">Para: {e.toAddr || "—"}</span>
                      <span className="flex-shrink-0 text-xs text-dim">{fmtWhen(e.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      {e.kind && <span className="flex-shrink-0 rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-low">{rotuloKind(e.kind)}</span>}
                      <span className="truncate text-sm text-low">{e.subject || "(sem assunto)"}</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}
    </div>
  );
}
