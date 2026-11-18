"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Opcao = {
  tipo: string;
  nome: string;
  descricao: string;
  bloqueio: string | null;
  /** Já formatado no servidor (fuso de São Paulo). */
  ultimoEnvio: string | null;
  agendadoPara: string | null;
};
type Enviado = { id: string; nome: string; assunto: string | null; quando: string };

/**
 * Aba "E-mails" do pedido: reenviar cada e-mail ao cliente e ver o que já foi.
 *
 * O reenvio pede confirmação na própria linha (mostra o endereço): mandar para
 * o cliente é irreversível, e o e-mail errado no pedido se corrige antes, em
 * "Editar cliente".
 */
export default function EmailsDoPedido({
  orderId,
  email,
  opcoes,
  enviados,
}: {
  orderId: string;
  email: string | null;
  opcoes: Opcao[];
  enviados: Enviado[];
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; texto: string } | undefined>>({});

  async function reenviar(tipo: string) {
    setEnviando(tipo);
    setResultado((r) => ({ ...r, [tipo]: undefined }));
    try {
      const res = await fetch("/api/painel/orders/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, tipo }),
      });
      const d = await res.json().catch(() => ({}));
      setResultado((r) => ({
        ...r,
        [tipo]: res.ok ? { ok: true, texto: "Enviado agora." } : { ok: false, texto: d?.error ?? "Não foi possível enviar." },
      }));
      if (res.ok) router.refresh();
    } catch {
      setResultado((r) => ({ ...r, [tipo]: { ok: false, texto: "Erro de rede." } }));
    } finally {
      setEnviando(null);
      setConfirmando(null);
    }
  }

  return (
    <div>
      {!email && (
        <p className="border-b border-line px-5 py-3 text-[13px] text-low">
          Este pedido não tem e-mail do cliente. Adicione em <b className="font-semibold text-mid">Editar cliente</b> para reenviar.
        </p>
      )}

      <ul className="divide-y divide-line">
        {opcoes.map((o) => {
          const r = resultado[o.tipo];
          const ocupado = enviando === o.tipo;
          return (
            <li key={o.tipo} className="px-5 py-3.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${o.bloqueio ? "text-low" : "text-hi"}`}>{o.nome}</p>
                  <p className="text-xs text-dim">{o.bloqueio ?? o.descricao}</p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <p className="min-w-0 text-xs tabular-nums text-low sm:w-56 sm:whitespace-nowrap">
                    {o.agendadoPara ? `Agendado: ${o.agendadoPara}` : o.ultimoEnvio ? `Último envio: ${o.ultimoEnvio}` : "Ainda não enviado"}
                  </p>
                  <div className="flex flex-shrink-0 items-center justify-end gap-2 sm:min-w-[9rem]">
                    {confirmando === o.tipo ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmando(null)}
                          disabled={ocupado}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-low transition hover:text-hi disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => reenviar(o.tipo)}
                          disabled={ocupado}
                          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
                        >
                          {ocupado ? "Enviando..." : "Enviar"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmando(o.tipo)}
                        disabled={!!o.bloqueio || !!enviando}
                        title={o.bloqueio ?? undefined}
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-mid transition hover:bg-hover hover:text-hi disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Reenviar
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {confirmando === o.tipo && email && (
                <p className="mt-2 text-xs text-low sm:text-right">
                  Vai para <b className="font-semibold text-mid">{email}</b>.
                </p>
              )}
              {r && <p className={`mt-2 text-xs font-medium sm:text-right ${r.ok ? "text-emerald-600" : "text-red-600"}`}>{r.texto}</p>}
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line px-5 py-4">
        <h3 className="text-[12px] font-medium text-low">Enviados{email ? ` para ${email}` : ""}</h3>
        {enviados.length === 0 ? (
          <p className="mt-2 text-sm text-dim">Nenhum e-mail enviado para este cliente desde o pedido.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {enviados.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
                <span className="w-full flex-shrink-0 text-[13px] font-semibold text-mid sm:w-44">{e.nome}</span>
                <Link
                  href={`/painel/emails/caixa/enviado/${e.id}`}
                  className="min-w-0 flex-1 truncate text-[13px] text-low hover:text-brand hover:underline"
                >
                  {e.assunto || "Sem assunto"}
                </Link>
                <span className="flex-shrink-0 text-xs tabular-nums text-dim">{e.quando}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
