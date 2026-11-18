"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { IconePix } from "@/components/painel/MetodoIcon";

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Cobranca = {
  amountCents: number;
  qrCode: string | null;
  /** Instante em que o Pix vence, em ISO. */
  expiraEm?: string | null;
};

/** Segundos que faltam para o Pix vencer. 0 quando já passou. */
function segundosRestantes(expiraEm?: string | null): number | null {
  if (!expiraEm) return null;
  const t = new Date(expiraEm).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((t - Date.now()) / 1000));
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Pagamento da taxa pelo próprio lojista.
 *
 * O Pix é gerado sob demanda com TODO o saldo em aberto. Uma cobrança já
 * aberta é reaproveitada em vez de gerar outra: dois Pix para a mesma dívida
 * terminam com o lojista pagando duas vezes.
 *
 * O Pix aparece numa janela centralizada, com QR e copia-e-cola juntos: quem
 * paga pelo celular lê o código, quem está no computador copia. Mostrar só o
 * texto obrigava a pessoa a abrir o banco no mesmo aparelho.
 */
export default function PagarTaxa({
  pendentesCents,
  minimoCents = 0,
  cobranca: inicial,
  diasRestantes,
  soBotao = false,
}: {
  pendentesCents: number;
  /**
   * Menor Pix possível (R$ 5,00 na Cakto). Abaixo dele o saldo acumula: o
   * botão some e a tela diz por quê, em vez de um erro depois do clique.
   */
  minimoCents?: number;
  cobranca: Cobranca | null;
  /**
   * Só a tela de conta suspensa passa isto (com 0), para trocar a chamada por
   * uma que fala em liberar o acesso. A aba de Taxas não passa — lá o texto é
   * sempre o mesmo.
   */
  diasRestantes?: number;
  /**
   * Só o botão (e o prazo/erro), sem o quadro com o saldo: a tela de conta
   * suspensa já mostra o total logo acima, e repetir o valor era ruído.
   */
  soBotao?: boolean;
}) {
  const router = useRouter();
  const [cobranca, setCobranca] = useState<Cobranca | null>(inicial);
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [restam, setRestam] = useState<number | null>(() => segundosRestantes(inicial?.expiraEm));

  // Relógio do Pix. Quando zera, a cobrança deixa de valer: o botão volta a
  // ser "gerar" e o servidor é reconsultado, porque o valor novo pode ser
  // maior — a loja continuou vendendo enquanto o Pix estava aberto.
  useEffect(() => {
    if (!cobranca?.expiraEm) return;
    const tick = () => {
      const s = segundosRestantes(cobranca.expiraEm);
      setRestam(s);
      if (s === 0) {
        setCobranca(null);
        setAberto(false);
        router.refresh();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [cobranca?.expiraEm, cobranca, router]);

  async function gerar() {
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/taxas", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      // Cadastro incompleto: recarga completa, que é quando o layout mostra o
      // formulário obrigatório (navegação comum não refaz o layout).
      if (data?.cadastroPendente && data?.ehDono) return window.location.assign("/painel/inicio");
      if (!res.ok) return setErro(data?.error ?? "Não foi possível gerar o Pix agora.");
      setCobranca(data.cobranca ?? null);
      // Abre já com o Pix na tela: gerar e ter que procurar onde ele foi parar
      // seria um passo a mais no momento em que a pessoa decidiu pagar.
      if (data.cobranca?.qrCode) setAberto(true);
      router.refresh();
    } catch {
      setErro("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  const venceu = diasRestantes !== undefined && diasRestantes <= 0;
  const chamada = venceu
    ? "Quite hoje para liberar o acesso ao painel. A baixa é automática."
    : "Pague agora e mantenha sua conta em dia. O Pix é gerado na hora.";

  if (soBotao) {
    const btn =
      "group flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.2),0_8px_20px_-8px_rgba(31,132,110,0.6)] transition-[background-color,transform,box-shadow] duration-150 ease-fluid hover:bg-brand-hover active:scale-[0.985] disabled:opacity-50 disabled:active:scale-100";
    return (
      <div>
        {cobranca?.qrCode ? (
          <button onClick={() => setAberto(true)} className={btn}>
            <IconPix />
            Ver Pix de {brl(cobranca.amountCents)}
          </button>
        ) : (
          <button onClick={gerar} disabled={busy || pendentesCents <= 0} aria-busy={busy || undefined} className={btn}>
            {busy ? <Spinner /> : <IconPix />}
            {busy ? "Gerando o Pix…" : "Gerar Pix e quitar agora"}
          </button>
        )}
        {cobranca?.qrCode && (
          <p className="mt-2 text-center text-xs tabular-nums text-low">
            {restam !== null ? <>Pix gerado · vence em {mmss(restam)}</> : "Pix gerado · aguardando pagamento"}
          </p>
        )}
        {erro && (
          <p role="alert" className="mt-2.5 text-center text-[13px] font-medium text-red-600 dark:text-red-400">
            {erro}
          </p>
        )}
        {aberto && cobranca?.qrCode && (
          <JanelaPix cobranca={cobranca} restam={restam} onFechar={() => setAberto(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-soft p-4">
      <p className="text-sm font-bold text-hi">Saldo em aberto: {brl(pendentesCents)}</p>
      <p className={`mt-0.5 text-xs ${venceu ? "text-red-500" : "text-low"}`}>{chamada}</p>

      {cobranca?.qrCode ? (
        <>
          <button
            onClick={() => setAberto(true)}
            className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover"
          >
            Ver Pix de {brl(cobranca.amountCents)}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-dim">
            {restam !== null ? <>Vence em {mmss(restam)} — depois disso é só gerar outro.</> : "Aguardando pagamento"}
          </p>
        </>
      ) : pendentesCents > 0 && pendentesCents < minimoCents ? (
        <p className="mt-3 rounded-lg bg-card px-3 py-2.5 text-xs leading-relaxed text-low">
          O Pix sai a partir de {brl(minimoCents)}. Este saldo fica para a próxima cobrança, sem prazo e sem bloqueio.
        </p>
      ) : (
        <button
          onClick={gerar}
          disabled={busy || pendentesCents <= 0}
          className="mt-3 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover disabled:opacity-40"
        >
          {busy ? "Gerando..." : "Gerar Pix e quitar agora"}
        </button>
      )}

      {erro && <p className="mt-2 text-xs font-semibold text-red-500">{erro}</p>}

      {aberto && cobranca?.qrCode && (
        <JanelaPix cobranca={cobranca} restam={restam} onFechar={() => setAberto(false)} />
      )}
    </div>
  );
}

// O mesmo símbolo do Pix do checkout e de Formas de pagamento.
function IconPix() {
  return <IconePix size={17} />;
}
function Spinner() {
  return <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

/**
 * Janela do Pix: QR + copia e cola.
 *
 * Vai por PORTAL no `<body>`: o quadro que a contém tem `overflow-hidden` e
 * fica dentro de uma coluna estreita, que cortariam uma sobreposição comum.
 */
function JanelaPix({
  cobranca,
  restam,
  onFechar,
}: {
  cobranca: Cobranca;
  restam: number | null;
  onFechar: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const codigo = cobranca.qrCode ?? "";

  // Mesmo caminho do checkout: o QR é DESENHADO a partir do copia-e-cola, em
  // vez de guardar a imagem. A biblioteca entra por import dinâmico para não
  // pesar no carregamento de quem nunca abre esta janela.
  useEffect(() => {
    let vivo = true;
    import("qrcode")
      .then((QR) => QR.toDataURL(codigo, { margin: 1, width: 260 }))
      .then((url) => {
        if (vivo) setQr(url);
      })
      .catch(() => {
        /* sem QR: o copia e cola abaixo continua resolvendo */
      });
    return () => {
      vivo = false;
    };
  }, [codigo]);

  // Esc fecha. Sem isso, numa sobreposição sem foco de teclado, a única saída
  // seria o mouse.
  const fechar = useCallback(onFechar, [onFechar]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [fechar]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* área de transferência bloqueada: o texto continua selecionável */
    }
  }

  return createPortal(
    <div
      className="panel-root fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-[pix-fundo_.2s_ease-out_both]"
      onClick={fechar}
      role="dialog"
      aria-modal="true"
      aria-label="Pix da taxa da plataforma"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-card p-5 shadow-panel-hover animate-[pix-janela_.32s_cubic-bezier(0.22,1,0.36,1)_both]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-hi">Pix de {brl(cobranca.amountCents)}</h2>
            <p className="mt-0.5 text-xs text-low">Leia o código no app do seu banco ou use o copia e cola.</p>
          </div>
          <button
            onClick={fechar}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-dim transition hover:bg-hover hover:text-hi"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Fundo branco fixo no QR nos dois temas: leitor de banco espera
            preto sobre branco, e invertê-lo quebra a leitura. */}
        <div className="mt-4 flex justify-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR Code do Pix" className="h-56 w-56 rounded-xl border border-line bg-white object-contain p-2" />
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-xl border border-line bg-white text-xs text-gray-400">
              gerando o QR...
            </div>
          )}
        </div>

        <textarea
          readOnly
          value={codigo}
          onFocus={(e) => e.currentTarget.select()}
          rows={3}
          className="mt-4 w-full resize-none rounded-lg border border-line bg-soft px-3 py-2 font-mono text-[11px] leading-snug text-mid outline-none"
        />

        <button
          onClick={copiar}
          className="mt-2 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-hover"
        >
          {copiado ? "Código copiado ✓" : "Copiar código Pix"}
        </button>

        {/* O prazo fica à vista: um Pix que some sem aviso parece erro do
            sistema, e não uma cobrança que venceu. */}
        {restam !== null && (
          <p className={`mt-3 text-center text-xs font-semibold ${restam <= 60 ? "text-red-500" : "text-mid"}`}>
            Este Pix vence em {mmss(restam)}
          </p>
        )}
        <p className="mt-1 text-center text-[11px] leading-relaxed text-dim">
          A baixa é automática assim que o pagamento cair — não precisa enviar comprovante. Se vencer, é só gerar
          outro com o valor atualizado.
        </p>
      </div>
    </div>,
    document.body,
  );
}
