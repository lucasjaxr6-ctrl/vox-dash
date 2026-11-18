import PagarTaxa from "@/components/painel/PagarTaxa";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valor em reais com "R$" e centavos menores (classes num-cur/num-dec). */
function Valor({ cents }: { cents: number }) {
  let cur = "";
  let whole = "";
  let dec = "";
  for (const p of brl.formatToParts(Number(cents) / 100)) {
    if (p.type === "currency") cur = p.value;
    else if (p.type === "integer" || p.type === "group" || p.type === "minusSign") whole += p.value;
    else if (p.type === "decimal" || p.type === "fraction") dec += p.value;
  }
  return (
    <>
      <span className="num-cur">{cur}</span>
      {whole}
      <span className="num-dec">{dec}</span>
    </>
  );
}

/**
 * Tela de conta suspensa por falta de pagamento.
 *
 * Substitui TODO o conteúdo do painel — é a única coisa que o lojista vê até
 * quitar. A ação de pagar mora AQUI dentro: mandar "vá em Taxas" numa tela que
 * bloqueia a navegação seria mandar para uma porta trancada.
 *
 * Um quadro só, lido de cima para baixo: o que aconteceu, quanto é, o botão,
 * e o que acontece depois de pagar. O saldo aparece UMA vez — antes ele vinha
 * no topo e de novo no quadro do botão.
 *
 * A tela NÃO informa que o checkout segue vendendo durante a suspensão
 * (decisão do dono da plataforma, 27/09/2026). Dizer isso entregaria o roteiro
 * para nunca pagar e nunca mais abrir o painel.
 *
 * O limite: não informar é uma coisa, afirmar o contrário é outra. Nada aqui
 * diz nem sugere que as vendas pararam — seria mentira sobre o serviço que a
 * pessoa está pagando, e isso não se escreve.
 */
export default function ContaSuspensa({
  porAdmin = false,
  pendentesCents,
  diasEmAberto,
  cobranca,
}: {
  /** Suspensão decidida pelo admin, não por taxa em aberto. */
  porAdmin?: boolean;
  pendentesCents: number;
  diasEmAberto: number;
  cobranca: { amountCents: number; qrCode: string | null; expiraEm?: string | null } | null;
}) {
  const dias = `${diasEmAberto} dia${diasEmAberto === 1 ? "" : "s"}`;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] items-center justify-center py-6">
      <section
        aria-labelledby="suspensa-titulo"
        className="w-full max-w-[460px] animate-fade-up rounded-2xl bg-card p-6 shadow-panel sm:p-8"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
              <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <h1 id="suspensa-titulo" className="text-[21px] font-semibold leading-tight tracking-tight text-hi [text-wrap:balance]">
            {porAdmin ? "Conta suspensa" : "Sua conta está suspensa"}
          </h1>
        </div>

        <p className="mt-3 text-[14px] leading-relaxed text-mid">
          {porAdmin ? (
            <>O acesso a este painel foi suspenso pela equipe da plataforma. Fale com o suporte para regularizar.</>
          ) : (
            <>
              A taxa da plataforma está em aberto há <b className="font-semibold text-hi">{dias}</b>. Quite o saldo
              para liberar o acesso ao painel.
            </>
          )}
        </p>

        {/* Numa suspensão manual não há Pix que resolva — mostrar o botão
            seria prometer uma saída que não existe. */}
        {!porAdmin && (
          <>
            <div className="mt-6 flex items-end justify-between gap-4 border-t border-line pt-5">
              <span className="pb-1.5 text-[13px] font-medium text-low">Total em aberto</span>
              <span className="text-[34px] font-semibold leading-none tracking-tight text-hi tabular-nums">
                <Valor cents={pendentesCents} />
              </span>
            </div>

            <div className="mt-6">
              {/* Já suspensa: o prazo acabou, então a chamada é a de vencido. */}
              <PagarTaxa pendentesCents={pendentesCents} cobranca={cobranca} diasRestantes={0} soBotao />
            </div>

            {/* O caminho inteiro em três linhas: a dúvida de quem está
                bloqueado é "e depois que eu pagar?". */}
            <ol className="mt-6 space-y-2.5 border-t border-line pt-5 text-[13px] text-mid">
              {["Gere o Pix com o valor em aberto", "Pague pelo app do seu banco", "O painel libera sozinho, sem enviar comprovante"].map(
                (passo, i) => (
                  <li key={passo} className="flex items-center gap-3">
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-semibold tabular-nums text-low">
                      {i + 1}
                    </span>
                    {passo}
                  </li>
                ),
              )}
            </ol>

            <p className="mt-5 text-xs leading-relaxed text-low">
              Já pagou e ainda vê esta tela? Recarregue a página em alguns instantes.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
