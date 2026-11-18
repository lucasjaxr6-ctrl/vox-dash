"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { PLANOS, PLANOS_IDS, type PlanoId } from "@/lib/planos";

type Cobranca = {
  id: string;
  plano: PlanoId;
  amountCents: number;
  qrCode: string | null;
  /** Instante em que o Pix vence, em ISO. */
  expiraEm: string;
};

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const preco = (c: number) => (c / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const pctBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const restante = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));

/**
 * Grade de planos.
 *
 * Dois usos: a PRIMEIRA escolha (o layout do painel mostra só isto até a conta
 * ter um plano) e a troca de plano em /painel/plano. O Basic ativa na hora; os
 * pagos abrem o Pix e a tela confere sozinha até o pagamento cair.
 */
export default function EscolherPlano({
  padraoPct,
  atual,
  vencido = false,
  expiraEm,
  cobrancaAberta,
  inicial = false,
}: {
  /** Taxa padrão da plataforma — é a do Basic. */
  padraoPct: number;
  /** Plano em vigor. Ausente na primeira escolha. */
  atual?: PlanoId | null;
  vencido?: boolean;
  expiraEm?: string | null;
  /** Pix de plano ainda válido, para retomar depois de recarregar a página. */
  cobrancaAberta?: Cobranca | null;
  inicial?: boolean;
}) {
  const router = useRouter();
  const [cobranca, setCobranca] = useState<Cobranca | null>(cobrancaAberta ?? null);
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState<PlanoId | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(plano: PlanoId) {
    setBusy(plano);
    setErro(null);
    try {
      const res = await fetch("/api/painel/plano", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano }),
      });
      const data = await res.json().catch(() => ({}));
      // Cadastro incompleto: a recarga leva ao formulário obrigatório do layout.
      if (data?.cadastroPendente && data?.ehDono) return window.location.assign("/painel/inicio");
      if (!res.ok) return setErro(data?.error ?? "Não foi possível escolher o plano agora.");
      if (data.ativo) return concluir();
      if (data.cobranca?.qrCode) {
        setCobranca(data.cobranca);
        setAberto(true);
      }
    } catch {
      setErro("Erro de rede. Tente de novo.");
    } finally {
      setBusy(null);
    }
  }

  // Recarga completa, não router.push: o layout do painel (que decide se
  // mostra esta tela ou o painel) não é refeito numa navegação comum.
  const concluir = useCallback(() => {
    if (inicial) window.location.assign("/painel/inicio");
    else router.refresh();
  }, [inicial, router]);

  async function sair() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const expira = expiraEm ? new Date(expiraEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

  return (
    <div className={inicial ? "mx-auto max-w-[1080px] py-6 sm:py-10" : ""}>
      {inicial && (
        <div className="mb-8 flex items-center justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vox-logo.png" alt="VoxCheckout" width={59} height={32} className="h-8 w-auto select-none" draggable={false} />
          <button onClick={sair} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-low transition hover:bg-hover hover:text-hi">
            Sair
          </button>
        </div>
      )}

      <header className={inicial ? "mx-auto max-w-xl text-center" : ""}>
        <h1 className={`font-semibold tracking-tight text-hi ${inicial ? "text-[26px]" : "text-[22px]"}`}>
          {inicial ? "Escolha o plano ideal para você." : "Plano"}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-low">
          {inicial
            ? "Preços que acompanham o crescimento do seu negócio, para você nunca pagar mais do que precisa. Dá para mudar de plano quando quiser."
            : atual && expira && !vencido && PLANOS[atual].precoCents > 0
              ? `Você está no ${PLANOS[atual].nome} até ${expira}. Renovar soma mais 30 dias; ao vencer, a conta volta para o Basic sem congelar nada.`
              : vencido
                ? "Seu plano pago venceu e a conta voltou para o Basic. Renove para recuperar a taxa e os limites do plano."
                : "Mude de plano quando quiser. Planos pagos valem por 30 dias a partir do pagamento."}
        </p>
      </header>

      {erro && (
        <p role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-[13px] font-medium text-red-500">
          {erro}
        </p>
      )}

      <div className={`grid gap-4 lg:grid-cols-3 ${inicial ? "mt-8" : "mt-5"}`}>
        {PLANOS_IDS.map((id) => {
          const p = PLANOS[id];
          const pct = p.pct ?? padraoPct;
          const ehAtual = atual === id && !inicial;
          const pago = p.precoCents > 0;
          const pendente = cobranca?.plano === id;
          const rotulo = busy === id
            ? pago ? "Gerando Pix..." : "Ativando..."
            : pendente
              ? "Ver Pix"
              : ehAtual
                ? pago ? "Renovar por mais 30 dias" : "Plano atual"
                : "Escolher esse plano";
          return (
            <section
              key={id}
              className={`flex flex-col rounded-2xl border bg-card p-5 ${ehAtual ? "border-brand" : "border-line"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div>
                  <h2 className="text-[17px] font-semibold text-hi">{p.nome}</h2>
                  {ehAtual && <span className="mt-1 inline-block rounded-md bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:text-brand-bright">Plano atual</span>}
                </div>
                <div className="text-right">
                  {pago ? (
                    <p className="whitespace-nowrap">
                      <span className="text-[13px] font-medium text-brand dark:text-brand-bright">R$ </span>
                      <span className="text-[26px] font-bold leading-none tracking-tight text-brand dark:text-brand-bright">{preco(p.precoCents)}</span>
                      <span className="text-[13px] text-low"> /mês</span>
                    </p>
                  ) : (
                    <p className="text-[26px] font-bold leading-none tracking-tight text-brand dark:text-brand-bright">Grátis</p>
                  )}
                  <p className="mt-1 text-[11.5px] text-dim">{pago ? "30 dias, pago via Pix" : "Sem mensalidade"}</p>
                </div>
              </div>

              <ul className="mt-5 flex-1 space-y-2.5 text-[13px] text-mid">
                <Item>+{pctBR(pct)}% por pedido pago</Item>
                <Item>+{pctBR(p.recoveryPct)}% por venda recuperada</Item>
                <Item>Checkout transparente com Pix e cartão</Item>
                <Item>Order bump, cupons e provas sociais</Item>
                <Item>Recuperação de vendas por e-mail</Item>
                <Item>Integração com Shopify</Item>
                <Item>{p.dominios} {p.dominios === 1 ? "domínio" : "domínios"}</Item>
                <Item>{p.historicoDias} dias de histórico de carrinhos abandonados</Item>
              </ul>

              <button
                onClick={() => (pendente ? setAberto(true) : escolher(id))}
                disabled={busy !== null || (ehAtual && !pago)}
                className={`mt-6 w-full rounded-lg px-4 py-2.5 text-[13.5px] font-semibold transition disabled:cursor-not-allowed ${
                  ehAtual && !pago
                    ? "bg-soft text-low"
                    : "bg-brand text-white hover:bg-brand-hover disabled:opacity-50"
                }`}
              >
                {rotulo}
              </button>
              <p className="mt-2.5 text-center text-[12px] text-low">{p.publico}</p>
            </section>
          );
        })}
      </div>

      {aberto && cobranca?.qrCode && (
        <JanelaPix
          cobranca={cobranca}
          onFechar={() => setAberto(false)}
          onVencer={() => {
            setAberto(false);
            setCobranca(null);
          }}
          onPago={concluir}
        />
      )}
    </div>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <svg className="mt-[3px] flex-shrink-0 text-brand dark:text-brand-bright" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/**
 * Pix do plano: QR + copia e cola, com conferência automática a cada 4 s.
 * Por portal no <body>, pelo mesmo motivo da janela de Pix da taxa.
 */
function JanelaPix({
  cobranca,
  onFechar,
  onVencer,
  onPago,
}: {
  cobranca: Cobranca;
  onFechar: () => void;
  onVencer: () => void;
  onPago: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [restam, setRestam] = useState(() => restante(cobranca.expiraEm));
  const [pago, setPago] = useState(false);
  const codigo = cobranca.qrCode ?? "";

  useEffect(() => {
    let vivo = true;
    import("qrcode")
      .then((QR) => QR.toDataURL(codigo, { margin: 1, width: 260 }))
      .then((url) => vivo && setQr(url))
      .catch(() => {
        /* sem QR: o copia e cola resolve */
      });
    return () => {
      vivo = false;
    };
  }, [codigo]);

  // Relógio do Pix.
  useEffect(() => {
    const id = setInterval(() => {
      const s = restante(cobranca.expiraEm);
      setRestam(s);
      // Dá uma última conferência antes de desistir: o pagamento pode ter
      // caído nos segundos finais. A janela fecha só se não caiu.
      if (s === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [cobranca.expiraEm]);

  // Conferência do pagamento. Continua até 2 min depois do vencimento: o
  // servidor aceita Pix pago no último segundo e confirmado logo depois.
  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await fetch(`/api/painel/plano?cobranca=${encodeURIComponent(cobranca.id)}`, { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (j?.status === "PAID") {
          setPago(true);
          setTimeout(onPago, 1200);
          return;
        }
        if (restante(cobranca.expiraEm) === 0 && Date.now() - new Date(cobranca.expiraEm).getTime() > 120_000) {
          onVencer();
        }
      } catch {
        /* rede oscilou: tenta na próxima batida */
      }
    };
    const id = setInterval(conferir, 4000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [cobranca.id, cobranca.expiraEm, onPago, onVencer]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [onFechar]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* área de transferência bloqueada: o texto continua selecionável */
    }
  }

  const nome = PLANOS[cobranca.plano].nome;

  return createPortal(
    <div
      className="panel-root fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}
      role="dialog"
      aria-modal="true"
      aria-label={`Pix do plano ${nome}`}
    >
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-panel-hover" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-hi">Plano {nome} · {brl(cobranca.amountCents)}</h2>
            <p className="mt-0.5 text-xs text-low">Leia o código no app do seu banco ou use o copia e cola.</p>
          </div>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-dim transition hover:bg-hover hover:text-hi"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {pago ? (
          <div className="py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand dark:text-brand-bright">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            </div>
            <p className="mt-3 text-sm font-semibold text-hi">Pagamento confirmado</p>
            <p className="mt-1 text-xs text-low">Ativando o plano {nome}...</p>
          </div>
        ) : (
          <>
            {/* Fundo branco fixo no QR nos dois temas: leitor de banco espera preto sobre branco. */}
            <div className="mt-4 flex justify-center">
              {qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR Code do Pix" className="h-56 w-56 rounded-xl border border-line bg-white object-contain p-2" />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-line bg-white text-xs text-gray-400">gerando o QR...</div>
              )}
            </div>

            <textarea
              readOnly
              value={codigo}
              onFocus={(e) => e.currentTarget.select()}
              rows={3}
              className="mt-4 w-full resize-none rounded-lg border border-line bg-soft px-3 py-2 font-mono text-[11px] leading-snug text-mid outline-none"
            />
            <button onClick={copiar} className="mt-2 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover">
              {copiado ? "Código copiado ✓" : "Copiar código Pix"}
            </button>

            <p className={`mt-3 text-center text-xs font-semibold ${restam <= 60 ? "text-red-500" : "text-mid"}`}>
              {restam > 0 ? `Este Pix vence em ${mmss(restam)}` : "Pix vencido — conferindo um eventual pagamento..."}
            </p>
            <p className="mt-1 text-center text-[11px] leading-relaxed text-dim">
              Aguardando o pagamento. O plano ativa sozinho assim que o Pix cair — pode deixar esta janela aberta.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
