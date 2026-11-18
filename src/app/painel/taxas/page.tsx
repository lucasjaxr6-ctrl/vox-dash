import Link from "next/link";
import { getActiveStore } from "@/lib/stores";
import {
  pctDaLoja,
  resumoLoja,
  extratoLoja,
  cobrancasAbertas,
  vencimentoDoPix,
  DIAS_ATE_SUSPENDER,
} from "@/lib/platform-fees";
import { minimoPixPlataforma } from "@/lib/platform-pix";
import PagarTaxa from "@/components/painel/PagarTaxa";

export const dynamic = "force-dynamic";

// Taxas da plataforma, na visão do LOJISTA.
//
// Ele é quem paga a conta, então precisa ver como ela foi formada — venda por
// venda, com a base e o percentual. Um total isolado obrigaria a confiar no
// número sem poder conferir.

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }) : "—";

const ROTULO: Record<string, { texto: string; classe: string }> = {
  PENDING: { texto: "Em aberto", classe: "bg-amber-500/10 text-amber-600" },
  PAID: { texto: "Paga", classe: "bg-emerald-500/10 text-emerald-600" },
  CANCELLED: { texto: "Cancelada", classe: "bg-gray-500/10 text-low" },
};

/** Quantas linhas por página do extrato. */
const POR_PAGINA = 10;

export default async function TaxasLojista({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const store = await getActiveStore();
  if (!store) return null;

  const pagina = Math.max(1, Number((await searchParams).p) || 1);

  const [taxa, resumo, extrato, abertas] = await Promise.all([
    // O percentual DESTA loja: o individual quando existe, senão o padrão.
    pctDaLoja(store.id),
    resumoLoja(store.id),
    extratoLoja(store.id, { limit: POR_PAGINA, offset: (pagina - 1) * POR_PAGINA }),
    cobrancasAbertas(store.id),
  ]);
  const cobranca = abertas[0] ?? null;
  const totalPaginas = Math.max(1, Math.ceil(extrato.total / POR_PAGINA));
  const minimo = minimoPixPlataforma();

  return (
    <div>
      {/* Sem subtítulo: os percentuais e as regras estão em "Como funciona",
          ao lado do botão de pagar. Repetir aqui em cima só espalhava a mesma
          informação por dois lugares — e um deles dizia "pague quando quiser",
          que é falso: não pagar suspende o painel. */}
      <h1 className="text-2xl font-bold tracking-tight text-hi">Taxas da plataforma</h1>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {/* Dois por linha já no celular: três cartões empilhados empurravam
              o extrato para fora da primeira tela. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card titulo="Em aberto" valor={brl(resumo.pendentesCents)} destaque />
            <Card titulo="Já pago" valor={brl(resumo.pagasCents)} />
            <Card
              titulo="Vendas com taxa"
              valor={String(resumo.pedidos)}
              nota={resumo.baseCents > 0 ? `sobre ${brl(resumo.baseCents)}` : undefined}
              // Ocupa a linha inteira no celular: sozinho na segunda fileira,
              // deixaria metade da largura vazia ao lado.
              classe="col-span-2 sm:col-span-1"
            />
          </div>

          <section className="mt-4 overflow-hidden rounded-xl bg-card">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <h2 className="text-sm font-bold text-hi">Extrato</h2>
              {extrato.total > 0 && (
                <span className="text-xs text-dim">
                  {extrato.total} lançamento{extrato.total > 1 ? "s" : ""}
                </span>
              )}
            </div>
            {extrato.itens.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-dim">
                {pagina > 1
                  ? "Nada nesta página."
                  : "Nenhuma taxa ainda. A primeira aparece na próxima venda aprovada."}
              </p>
            ) : (
              <>
                {/* No celular, uma lista. A tabela de 5 colunas só cabia com
                    rolagem lateral, e coluna escondida atrás de arrasto é
                    coluna que ninguém lê. */}
                <ul className="divide-y divide-line sm:hidden">
                  {extrato.itens.map((t) => {
                    const r = ROTULO[t.status] ?? ROTULO.PENDING;
                    return (
                      <li key={t.orderId} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={`/painel/vendas/${t.orderId}`}
                            className="min-w-0 flex-1 truncate text-sm font-semibold text-mid hover:text-brand"
                          >
                            {t.customerName || "—"}
                          </Link>
                          <span className="flex-shrink-0 text-sm font-bold tabular-nums text-hi">
                            {brl(t.feeCents)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-dim">
                          <span>{dia(t.createdAt)}</span>
                          <span>·</span>
                          <span>venda de {brl(t.baseCents)}</span>
                          <span>·</span>
                          <span>{Number(t.ratePct).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>
                          {t.recuperado === 1 && (
                            <span className="rounded-full bg-brand/10 px-1.5 py-0.5 font-bold text-brand">
                              recuperada
                            </span>
                          )}
                          <span className={`rounded-full px-2 py-0.5 font-bold ${r.classe}`}>{r.texto}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-low text-[12px] font-medium">
                      <th className="px-4 py-2 font-semibold">Data</th>
                      <th className="px-4 py-2 font-semibold">Cliente</th>
                      <th className="px-4 py-2 text-right font-semibold">Venda</th>
                      <th className="px-4 py-2 text-right font-semibold">Taxa</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {extrato.itens.map((t) => {
                      const r = ROTULO[t.status] ?? ROTULO.PENDING;
                      // `border-line` sem opacidade: o token é rgba, e
                      // `border-line/60` não gera regra nenhuma — a borda
                      // cairia no currentColor do navegador.
                      return (
                        <tr key={t.orderId} className="border-b border-line last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-low">{dia(t.createdAt)}</td>
                          <td className="max-w-[180px] truncate px-4 py-2.5 text-mid">
                            {/* Link para a venda: dá para conferir a origem da
                                cobrança sem sair procurando. */}
                            <Link href={`/painel/vendas/${t.orderId}`} className="hover:text-brand hover:underline">
                              {t.customerName || "—"}
                            </Link>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-low">
                            {brl(t.baseCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums text-hi">
                            {brl(t.feeCents)}
                            <span className="ml-1 text-[10px] font-normal text-dim">
                              {Number(t.ratePct).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                            </span>
                            {/* Sem este selo, a linha mais cara pareceria erro
                                de cálculo em vez de venda recuperada. */}
                            {t.recuperado === 1 && (
                              <span className="ml-1.5 rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold text-brand">
                                recuperada
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${r.classe}`}>
                              {r.texto}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </>
            )}

            {totalPaginas > 1 && (
              // Links de verdade (e não botões com estado): a página é servidor,
              // então voltar e recarregar continuam funcionando.
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-xs text-dim">
                  Página {pagina} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  <PaginaLink para={pagina - 1} ativo={pagina > 1}>
                    Anterior
                  </PaginaLink>
                  <PaginaLink para={pagina + 1} ativo={pagina < totalPaginas}>
                    Próxima
                  </PaginaLink>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* No celular o pagamento vem PRIMEIRO. Empilhado na ordem do código,
            o botão de quitar ficava depois do extrato inteiro e da paginação —
            justamente a ação que a pessoa veio fazer. */}
        <aside className="order-first space-y-3 lg:order-none">
          <PagarTaxa
            pendentesCents={resumo.pendentesCents}
            minimoCents={minimo}
            cobranca={
              cobranca
                ? {
                    amountCents: cobranca.amountCents,
                    qrCode: cobranca.qrCode,
                    expiraEm: vencimentoDoPix(cobranca.createdAt),
                  }
                : null
            }
          />
          <div className="rounded-xl bg-card p-4">
            <h3 className="text-sm font-bold text-hi">Como funciona</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-low">
              <li>
                • {taxa.pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% sobre o valor total de cada venda
                aprovada.
              </li>
              <li>
                • Vendas recuperadas (Pix não pago ou carrinho abandonado) pagam{" "}
                {taxa.recoveryPct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%, e aparecem marcadas no
                extrato. É a mesma contagem do card de Recuperação.
              </li>
              <li>• Venda estornada ou com chargeback tem a taxa cancelada automaticamente.</li>
              <li>• Nada é descontado das suas vendas: o saldo acumula e você quita por Pix.</li>
              <li>
                • O Pix sai a partir de {brl(minimo)}. Abaixo disso o saldo fica para a próxima cobrança, sem prazo e
                sem bloqueio.
              </li>
              {/* O prazo precisa estar escrito. Ser suspenso sem nunca ter
                  lido a regra transforma cobrança em bloqueio arbitrário.
                  O que NÃO se diz aqui é que o checkout segue ligado durante a
                  suspensão: seria entregar de bandeja o roteiro para nunca
                  pagar e nunca mais voltar ao painel. */}
              <li className="text-mid">
                • <b>O pagamento tem prazo:</b> com {DIAS_ATE_SUSPENDER} dias de saldo em aberto, a conta é suspensa
                e o acesso a este painel é bloqueado até a quitação.
              </li>
              <li>• A baixa é automática: assim que o Pix cai, o extrato e o acesso liberam na hora.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Botão de página. Desativado vira `<span>`, não link morto. */
function PaginaLink({ para, ativo, children }: { para: number; ativo: boolean; children: React.ReactNode }) {
  const classe = "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold";
  if (!ativo) return <span className={`${classe} text-dim opacity-50`}>{children}</span>;
  return (
    <Link href={`/painel/taxas?p=${para}`} className={`${classe} text-mid transition hover:bg-hover hover:text-hi`}>
      {children}
    </Link>
  );
}

function Card({
  titulo,
  valor,
  nota,
  destaque = false,
  classe = "",
}: {
  titulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
  /** Para o cartão ocupar as duas colunas no celular. */
  classe?: string;
}) {
  return (
    <div className={`rounded-xl bg-card p-4 ${destaque ? "ring-1 ring-inset ring-brand/40" : ""} ${classe}`}>
      <div className="text-low text-[12px] font-medium">{titulo}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${destaque ? "text-brand" : "text-hi"}`}>{valor}</div>
      {nota && <div className="mt-0.5 text-[11px] text-dim">{nota}</div>}
    </div>
  );
}
