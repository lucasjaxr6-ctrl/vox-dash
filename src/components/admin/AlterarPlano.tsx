"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PLANOS, PLANOS_IDS, type PlanoId } from "@/lib/planos";

const ATALHOS = [7, 30, 90, 365];
const dataFinal = (dias: number) =>
  new Date(Date.now() + dias * 86_400_000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/**
 * Botão "Alterar" da aba de Assinaturas: escolhe o plano e por quantos dias
 * ele fica ativo. A data final aparece antes de salvar — o novo prazo
 * SUBSTITUI o atual, e ver a data evita encurtar a assinatura de alguém sem
 * querer.
 */
export default function AlterarPlano({
  userId,
  conta,
  planoAtual,
}: {
  userId: string;
  conta: string;
  planoAtual: PlanoId | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [plano, setPlano] = useState<PlanoId>(planoAtual && planoAtual !== "basic" ? planoAtual : "premium");
  const [dias, setDias] = useState(30);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pago = PLANOS[plano].precoCents > 0;
  const diasOk = Number.isInteger(dias) && dias >= 1 && dias <= 3650;

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [aberto]);

  async function salvar() {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/admin/platform/plano", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plano, dias: pago ? dias : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setErro(data?.error ?? "Não foi possível salvar.");
      setAberto(false);
      router.refresh();
    } catch {
      setErro("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        className="rounded-lg bg-soft px-3 py-1.5 text-[12px] font-semibold text-hi transition hover:bg-hover"
      >
        Alterar
      </button>

      {aberto &&
        createPortal(
          <div
            className="panel-root fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onClick={() => setAberto(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`Alterar plano de ${conta}`}
          >
            <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 text-left shadow-panel-hover" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-base font-bold text-hi">Alterar plano</h2>
              <p className="mt-0.5 truncate text-xs text-low">{conta}</p>

              <fieldset className="mt-4">
                <legend className="text-[12px] font-medium text-low">Plano</legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {PLANOS_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPlano(id)}
                      aria-pressed={plano === id}
                      className={`rounded-lg border px-2 py-2 text-[12.5px] font-semibold transition ${
                        plano === id ? "border-brand bg-brand/10 text-brand dark:text-brand-bright" : "border-line text-mid hover:bg-hover"
                      }`}
                    >
                      {PLANOS[id].nome}
                    </button>
                  ))}
                </div>
              </fieldset>

              {pago ? (
                <div className="mt-4">
                  <label htmlFor="dias-plano" className="text-[12px] font-medium text-low">
                    Ativo por quantos dias
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      id="dias-plano"
                      type="number"
                      min={1}
                      max={3650}
                      value={Number.isFinite(dias) ? dias : ""}
                      onChange={(e) => setDias(Math.round(Number(e.target.value)))}
                      className="w-24 rounded-lg border border-line bg-soft px-3 py-2 text-sm tabular-nums text-hi outline-none focus:border-brand"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {ATALHOS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDias(d)}
                          className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition ${dias === d ? "bg-hover text-hi" : "text-low hover:bg-hover"}`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 text-[12px] text-low">
                    {diasOk ? (
                      <>
                        Ativo até <b className="text-hi">{dataFinal(dias)}</b>. Substitui a validade atual; ao vencer, a conta volta
                        para o Basic sozinha.
                      </>
                    ) : (
                      <span className="text-red-500">Entre 1 e 3650 dias.</span>
                    )}
                  </p>
                </div>
              ) : (
                <p className="mt-4 text-[12px] text-low">O Basic não vence. A taxa por pedido volta para a padrão da plataforma.</p>
              )}

              {erro && <p className="mt-3 text-xs font-semibold text-red-500">{erro}</p>}

              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setAberto(false)}
                  className="flex-1 rounded-lg bg-soft px-4 py-2.5 text-sm font-semibold text-hi transition hover:bg-hover"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={busy || (pago && !diasOk)}
                  className="flex-1 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover disabled:opacity-50"
                >
                  {busy ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
