import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";
import { getStoreName, getCheckoutTheme } from "@/lib/settings";
import { mergeTheme, corDoBotao } from "@/lib/checkout-theme";
import { lerRemessa, ROTULO_ESTAGIO, type Estagio, type EventoRastreio } from "@/lib/track17";
import { CornerStyle, CORNERS_CLASS } from "@/components/checkout/ui";
import RastreioHeader from "@/components/rastreio/RastreioHeader";
import CopiarCodigo from "@/components/rastreio/CopiarCodigo";
import Etapas, { type Etapa } from "@/components/rastreio/Etapas";

export const dynamic = "force-dynamic";
export { storeMetadata as generateMetadata } from "@/lib/store-metadata";

// Acompanhamento da entrega NO DOMÍNIO DA LOJA.
//
// Antes o e-mail mandava o cliente ao 17track, que abre em chinês e tira a
// pessoa da loja no momento mais ansioso da compra. Aqui os mesmos eventos
// aparecem em português, com a marca da loja.
//
// A página é PÚBLICA, aberta pelo código de rastreio. É aceitável porque o
// código já viaja por e-mail e não é adivinhável — mas por isso a tela mostra
// só o que ajuda a acompanhar a entrega: primeiro nome e cidade/UF de destino.
// Nada de valor pago, endereço completo, telefone, e-mail ou outros pedidos.

function fmtData(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtHora(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Primeira vez que a encomenda entrou num estágio. */
function primeiraVez(eventos: EventoRastreio[], estagios: Estagio[]): Date | null {
  const candidatos = eventos
    .filter((e) => e.estagio && estagios.includes(e.estagio))
    .map((e) => new Date(e.ocorridoEm).getTime());
  return candidatos.length ? new Date(Math.min(...candidatos)) : null;
}

export default async function RastreioPage({ params }: { params: Promise<{ codigo: string }> }) {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) notFound();

  const { codigo: bruto } = await params;
  const chave = decodeURIComponent(bruto || "").trim().slice(0, 64);
  if (!chave) notFound();

  // O segmento aceita DUAS chaves: o código de rastreio ou o id do pedido.
  //
  // O id existe desde a aprovação; o código só no despacho. Sem isso, o e-mail
  // de "em preparação" não teria como trazer o cliente para cá — e é justamente
  // nessa fase que ele mais quer olhar. O id é UUID, tão impossível de adivinhar
  // quanto o código, e esta tela mostra MENOS dados que a de obrigado, que já
  // abre pelo mesmo id.
  type Pedido = {
    id: string;
    trackingCode: string | null;
    customerName: string | null;
    customerAddress: string | null;
    paidAt: Date | null;
    separationEmailSentAt: Date | null;
    updatedAt: Date;
  };
  const COLUNAS = `id, trackingCode, customerName, customerAddress, paidAt, separationEmailSentAt, updatedAt`;

  // O código precisa pertencer a um pedido DESTA loja — senão a página viraria
  // um rastreador aberto para qualquer código do mundo, gastando a cota paga.
  let pedidos = await query<Pedido>(
    `SELECT ${COLUNAS} FROM orders WHERE storeId = ? AND UPPER(TRIM(trackingCode)) = ? LIMIT 1`,
    [store.id, chave.toUpperCase()],
  );
  if (!pedidos[0]) {
    pedidos = await query<Pedido>(`SELECT ${COLUNAS} FROM orders WHERE storeId = ? AND id = ? LIMIT 1`, [
      store.id,
      chave,
    ]);
  }
  const pedido = pedidos[0];
  if (!pedido) notFound();

  // Pode ser vazio: pedido pago e ainda não postado.
  const codigo = (pedido.trackingCode || "").trim().toUpperCase();

  const [storeName, temaBruto] = await Promise.all([getStoreName(store.id), getCheckoutTheme(store.id)]);
  const theme = mergeTheme(temaBruto);
  // Sem código não há o que consultar no provedor — e consultar gastaria cota
  // à toa. A página abre igual, mostrando as etapas que já aconteceram.
  const { remessa, eventos } = codigo
    ? await lerRemessa(codigo, store.id)
    : { remessa: null, eventos: [] as EventoRastreio[] };

  const estagio = (remessa?.estagio as Estagio | null) ?? null;
  const cor = corDoBotao(theme);

  // Só cidade/UF: a rua e o número não ajudam a acompanhar e a página é pública.
  let destino = "";
  try {
    const a = pedido.customerAddress ? JSON.parse(pedido.customerAddress) : null;
    destino = [a?.city, a?.uf].filter(Boolean).join(" - ");
  } catch {
    /* endereço ilegível: some o campo */
  }
  const primeiroNome = (pedido.customerName || "").trim().split(/\s+/)[0] || "";

  const enviadoEm = primeiraVez(eventos, ["postado"]) ?? (eventos.length ? null : null);

  // Estágio da REMESSA como reserva para as etapas. O 17TRACK às vezes manda o
  // evento sem estágio (caso real: "中国邮政已收取邮件" veio com stage vazio)
  // enquanto o status geral já diz "em trânsito". Olhando só os eventos, a
  // linha do tempo parava em "Enviado" ao lado de um selo "Em trânsito" — a
  // tela se contradizendo.
  const ORDEM: Estagio[] = ["aguardando", "postado", "transito", "alfandega", "saiu_entrega", "entregue"];
  const alcancou = (alvo: Estagio) => estagio !== null && ORDEM.indexOf(estagio) >= ORDEM.indexOf(alvo);
  // Eventos vêm do mais novo para o mais antigo: o último é o primeiro
  // movimento da transportadora, que é quando o trânsito começou.
  const primeiroMovimento = eventos.length ? eventos[eventos.length - 1].ocorridoEm : null;

  const etapas: Etapa[] = [
    { titulo: "Pedido confirmado", em: pedido.paidAt, icone: "check" },
    { titulo: "Em preparação", em: pedido.separationEmailSentAt ?? pedido.paidAt, icone: "caixa" },
    // ⚠️ Só marca "Enviado" se existe código. Sem a guarda, um pedido ainda em
    // preparação cairia no `updatedAt` e apareceria como postado para o
    // cliente — etapa verde mentindo sobre onde a encomenda está.
    { titulo: "Enviado", em: codigo ? (enviadoEm ?? pedido.updatedAt) : null, icone: "caixa" },
    {
      titulo: "Em trânsito",
      em:
        primeiraVez(eventos, ["transito", "alfandega"]) ??
        (alcancou("transito") ? (primeiroMovimento ?? remessa?.ultimoEm ?? null) : null),
      icone: "caminhao",
    },
    {
      titulo: "Saiu para entrega",
      em: primeiraVez(eventos, ["saiu_entrega"]) ?? (alcancou("saiu_entrega") ? (remessa?.ultimoEm ?? null) : null),
      icone: "caminhao",
    },
    { titulo: "Entregue", em: remessa?.entregueEm ?? null, icone: "check" },
  ];

  const entregue = estagio === "entregue";
  const problema = estagio === "excecao";

  return (
    <div
      className={`${CORNERS_CLASS} flex min-h-screen flex-col`}
      style={{ background: theme.colors.background, fontFamily: theme.typography.fontFamily }}
    >
      <CornerStyle roundness={theme.corners.roundness} />
      <RastreioHeader theme={theme} storeName={storeName} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-gray-900">
          {entregue ? "Pedido entregue" : problema ? "Sua entrega precisa de atenção" : "Rastrear pedido"}
        </h1>
        <p className="mt-1 text-[13.5px] text-gray-500">
          {primeiroNome ? `Olá, ${primeiroNome}! ` : ""}
          Acompanhe sua encomenda, da postagem até a entrega.
        </p>

        {/* ── Faixa de informações + etapas ─────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Info rotulo="Código de rastreio">
              {codigo ? (
                <CopiarCodigo codigo={codigo} />
              ) : (
                // Antes da postagem não existe código. Dizer isso é melhor que
                // mostrar um campo vazio, que parece defeito da página.
                <span className="text-[13.5px] text-gray-400">Disponível após a postagem</span>
              )}
            </Info>
            <Info rotulo="Transportadora">
              <span className="text-[15px] font-bold text-gray-900">{remessa?.carrier || "A definir"}</span>
            </Info>
            <Info rotulo="Previsão de entrega">
              {remessa?.previsaoEm ? (
                <span className="text-[15px] font-bold text-gray-900">{fmtData(remessa.previsaoEm)}</span>
              ) : (
                // Sem previsão do provedor a gente NÃO inventa uma: prazo errado
                // na tela vira reclamação.
                <span className="text-[13.5px] text-gray-400">Não informada pela transportadora</span>
              )}
            </Info>
            <Info rotulo="Status atual">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
                style={{ background: `${cor}1a`, color: cor }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: cor }} />
                {estagio ? ROTULO_ESTAGIO[estagio] : "Aguardando postagem"}
              </span>
              {remessa?.ultimoTexto && (
                <span className="mt-1 block text-[12px] leading-snug text-gray-500">{remessa.ultimoTexto}</span>
              )}
            </Info>
          </div>

          <div className="mt-7 border-t border-gray-100 pt-7">
            <Etapas etapas={etapas} cor={cor} corTexto={theme.colors.buttonText} />
          </div>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Histórico ───────────────────────────────────────────────── */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-[15px] font-bold text-gray-900">Histórico de eventos</h2>
            {eventos.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13.5px] text-gray-500">Ainda não há movimentações registradas.</p>
                <p className="mx-auto mt-1 max-w-sm text-[12.5px] text-gray-400">
                  A primeira atualização costuma levar algumas horas depois da postagem.
                </p>
              </div>
            ) : (
              <ol className="mt-4">
                {eventos.map((ev, i) => (
                  <li key={`${ev.ocorridoEm}-${i}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className="mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: i === 0 ? cor : "#d1d5db" }}
                      />
                      {i < eventos.length - 1 && <span className="w-px flex-1 bg-gray-200" />}
                    </div>
                    <div className={`flex min-w-0 flex-1 gap-3 ${i < eventos.length - 1 ? "pb-5" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[13.5px] ${i === 0 ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                          {ev.descricao}
                        </p>
                        {ev.localizacao && <p className="mt-0.5 text-[12px] text-gray-400">{ev.localizacao}</p>}
                      </div>
                      <div className="flex-shrink-0 text-right text-[11.5px] leading-snug text-gray-400">
                        <div>{fmtData(ev.ocorridoEm)}</div>
                        <div>{fmtHora(ev.ocorridoEm)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* ── Informações da encomenda ────────────────────────────────── */}
          <aside className="space-y-5">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-[15px] font-bold text-gray-900">Informações da encomenda</h2>
              <dl className="mt-4 space-y-3 text-[13px]">
                <Linha rotulo="Pedido" valor={`#${pedido.id.slice(0, 8).toUpperCase()}`} />
                {primeiroNome && <Linha rotulo="Destinatário" valor={primeiroNome} />}
                {destino && <Linha rotulo="Destino" valor={destino} />}
                <Linha
                  rotulo="Última atualização"
                  valor={remessa?.ultimoEm ? `${fmtData(remessa.ultimoEm)} às ${fmtHora(remessa.ultimoEm)}` : "Ainda não houve"}
                />
              </dl>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="text-[15px] font-bold text-gray-900">Dúvidas frequentes</h2>
              <div className="mt-3 divide-y divide-gray-100">
                <Faq
                  p="A primeira atualização demora?"
                  r="Sim. Depois da postagem, a transportadora costuma levar de algumas horas a dois dias para registrar o primeiro movimento."
                />
                <Faq
                  p="O status não muda há dias. É normal?"
                  r="Em trechos longos e na alfândega é comum ficar parado por vários dias sem nova leitura. O pacote segue em movimento mesmo sem registro."
                />
                <Faq
                  p="Posso mudar o endereço de entrega?"
                  r="Depois da postagem não é possível alterar. Se o pacote voltar, a gente reenvia."
                />
              </div>
            </section>
          </aside>
        </div>

        {remessa?.erro && eventos.length === 0 && (
          <p className="mt-5 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12.5px] text-gray-500">
            Ainda não conseguimos falar com a transportadora sobre este código. Ele costuma levar algumas horas para ser
            reconhecido depois da postagem. Esta página se atualiza sozinha.
          </p>
        )}
      </main>
      {/* Sem rodapé de propósito: quem chega aqui veio do e-mail atrás de UMA
          informação — onde está a encomenda. Formas de pagamento e selos de
          segurança pertencem ao checkout, não ao pós-venda. */}
    </div>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] font-medium text-gray-400">{rotulo}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-gray-500">{rotulo}</dt>
      <dd className="text-right font-semibold text-gray-800">{valor}</dd>
    </div>
  );
}

/** <details> nativo: abre e fecha sem JavaScript. */
function Faq({ p, r }: { p: string; r: string }) {
  return (
    <details className="group py-2.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-medium text-gray-700">
        {p}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" className="flex-shrink-0 text-gray-400 transition group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">{r}</p>
    </details>
  );
}
