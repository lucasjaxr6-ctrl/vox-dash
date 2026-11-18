import Link from "next/link";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { getShopifyCredentials, getUtmifyToken } from "@/lib/settings";
import { statusOnboarding } from "@/lib/onboarding";
import { pctDaLoja } from "@/lib/platform-fees";
import { planoDaConta, dominiosEmUso } from "@/lib/plans";
import { PLANOS } from "@/lib/planos";
import { spMidnight, ymdTodaySP } from "@/lib/painel-range";
import OnlineAgora from "@/components/painel/OnlineAgora";

export const dynamic = "force-dynamic";

// Início do painel: para onde o lojista vai depois de escolher o plano.
//
//   1. Indicadores de hoje (online agora · vendas · pedidos)
//   2. Passo a passo da loja (Shopify · Domínio · Gateway · Resend) — fica
//      sempre à vista; com tudo pronto, aparece como configurado
//   3. Integrações recomendadas (só depois da configuração) | Seu plano
//
// Cada etapa é verificada no dado real (lib/onboarding.ts): se o domínio cair
// ou o gateway for desligado, a etapa volta a aparecer pendente.

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pctBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export default async function Inicio() {
  const store = await getActiveStore();
  if (!store) return null;

  const hoje = spMidnight(ymdTodaySP());
  const [conta, taxa, dominios, onboarding, shopify, utmify, [cfg], [dia]] = await Promise.all([
    planoDaConta(store.ownerUserId),
    pctDaLoja(store.id),
    dominiosEmUso(store.ownerUserId),
    // A mesma fonte que o layout usa para travar o painel — o Início nunca
    // pode mostrar uma etapa como feita enquanto o menu ainda a cobra.
    statusOnboarding(store.id),
    getShopifyCredentials(store.id).then((c) => !!c),
    getUtmifyToken(store.id).then((t) => !!t),
    query<{ temPixel: number }>(
      `SELECT (pixels IS NOT NULL AND pixels NOT IN ('', '[]')) AS temPixel
         FROM store_settings WHERE storeId = ? LIMIT 1`,
      [store.id],
    ),
    // "Hoje" com a MESMA regra do Dashboard: pedidos criados desde a
    // meia-noite de São Paulo; pago = PAID ou SHIPPED.
    query<{ pedidos: number; pagos: number; pagoCents: number }>(
      `SELECT COUNT(*) AS pedidos,
              COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS pagos,
              COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END), 0) AS pagoCents
         FROM orders WHERE storeId = ? AND createdAt >= ?`,
      [store.id, hoje],
    ),
  ]);

  const { etapas, concluido } = onboarding;
  const feitas = etapas.filter((e) => e.feito).length;
  const tudoPronto = feitas === etapas.length;
  const proxima = etapas.findIndex((e) => !e.feito);

  const plano = PLANOS[conta.plano];
  const pago = plano.precoCents > 0;
  const diasParaVencer = conta.expiraEm ? Math.ceil((conta.expiraEm.getTime() - Date.now()) / 86_400_000) : null;
  const avisarVencimento = pago && diasParaVencer !== null && diasParaVencer <= 5;

  const pedidos = Number(dia?.pedidos ?? 0);
  const pagos = Number(dia?.pagos ?? 0);

  return (
    <div className="animate-fade-up space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-2">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">Início</h1>
          <p className="mt-1 truncate text-[13px] text-low">
            <span className="font-medium text-mid">{store.name}</span>
            <span aria-hidden className="mx-1.5 text-dim">·</span>
            Plano {plano.nome}
          </p>
        </div>
        {concluido && (
          <Link href="/painel" className="text-[13px] font-medium text-mid transition hover:text-hi">
            Ver dashboard completa
          </Link>
        )}
      </header>

      {conta.vencido && (
        <Faixa tom="alerta" href="/painel/plano" acao="Renovar plano">
          Seu plano {conta.contratado ? PLANOS[conta.contratado].nome : ""} venceu e a conta voltou para o Basic. A loja
          segue vendendo normalmente, com a taxa e os limites do Basic.
        </Faixa>
      )}
      {avisarVencimento && conta.expiraEm && (
        <Faixa tom="aviso" href="/painel/plano" acao="Renovar">
          Seu plano {plano.nome} vence em {dataBR(conta.expiraEm)}
          {diasParaVencer! <= 1 ? "" : ` (${diasParaVencer} dias)`}. Renove para manter a taxa de {pctBR(plano.pct ?? taxa.pct)}%.
        </Faixa>
      )}

      {/* ── 1. Hoje ── */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Visitantes online agora" value={<OnlineAgora />} note="Atualiza a cada 5 segundos" />
        <Kpi label="Vendas hoje" value={brl(Number(dia?.pagoCents ?? 0))} note={`${pagos} ${pagos === 1 ? "pedido pago" : "pedidos pagos"}`} destaque />
        <Kpi label="Pedidos hoje" value={String(pedidos)} note={pedidos === 0 ? "nenhum ainda" : pedidos === pagos ? "todos pagos" : `${pedidos - pagos} não pagos`} href={concluido ? "/painel/vendas" : undefined} />
      </div>

      {/* ── 2. Passo a passo — sempre à vista; pronto, mostra-se configurado ── */}
      <section className="rounded-2xl bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div>
              <h2 className="text-[14px] font-semibold text-hi">
                {tudoPronto ? "Sua loja está configurada" : "Complete a configuração da sua loja"}
              </h2>
              <p className="mt-0.5 text-[12.5px] text-low">
                {feitas} de {etapas.length} etapas concluídas
                {!concluido && " · as outras seções do painel liberam ao terminar"}
              </p>
            </div>
            <div className="flex w-full gap-1.5 sm:w-64" aria-hidden>
              {etapas.map((e) => (
                <span key={e.titulo} className={`h-1.5 flex-1 rounded-full ${e.feito ? "bg-brand" : "bg-soft"}`} />
              ))}
            </div>
          </div>

          <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {etapas.map((e, i) => (
              <li
                key={e.titulo}
                className={`flex min-w-0 flex-col rounded-xl border p-4 ${
                  e.feito ? "border-brand/30 bg-brand/[0.04]" : i === proxima ? "border-line-strong" : "border-line"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {e.feito ? (
                    <span className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand text-white">
                      <Check size={11} />
                    </span>
                  ) : (
                    <span className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-line-strong text-[11px] font-semibold text-mid">
                      {i + 1}
                    </span>
                  )}
                  <div className="min-w-0">
                    <h3 className="text-[13.5px] font-semibold text-hi">{e.titulo}</h3>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-low">{e.desc}</p>
                  </div>
                </div>
                <div className="mt-auto flex justify-end pt-4">
                  {e.feito ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2 py-1 text-[12px] font-medium text-brand dark:text-brand-bright">
                      Concluído <Check size={11} />
                    </span>
                  ) : (
                    <Link
                      href={e.href}
                      className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
                        i === proxima ? "bg-brand text-white hover:bg-brand-hover" : "bg-soft text-hi hover:bg-hover"
                      }`}
                    >
                      {e.acao}
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
      </section>

      {/* ── 3. Integrações | Plano ──
          As três integrações ficam abertas mesmo durante a configuração
          (ROTAS_LIVRES em lib/onboarding-rotas.ts). Só "Ver todos os apps"
          espera: a tela de Apps ainda está travada. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-2xl bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-hi">Integrações recomendadas</h2>
              <p className="mt-0.5 text-[12.5px] text-low">Conecte ferramentas para vender mais e acompanhar suas vendas.</p>
            </div>
            {concluido && (
              <Link href="/painel/apps" className="shrink-0 text-[12.5px] font-medium text-mid transition hover:text-hi">
                Ver todos os apps
              </Link>
            )}
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Integracao nome="Shopify" desc="Produtos e pedidos sincronizados." href="/painel/shopify" ativo={shopify} logo="/apps/shopify.webp" />
            <Integracao nome="Utmify" desc="Acompanhe a origem das vendas." href="/painel/apps/utmify" ativo={utmify} logo="/apps/utmify.png" />
            <Integracao nome="Pixels" desc="Meta e Google recebendo cada venda." href="/painel/pixels" ativo={Number(cfg?.temPixel ?? 0) === 1} />
          </div>
        </section>

        <section className="flex min-w-0 flex-col rounded-2xl bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-hi">Seu plano</h2>
              <p className="mt-0.5 text-[12.5px] text-low">
                {pago && conta.expiraEm ? `Válido até ${dataBR(conta.expiraEm)}` : "Sem mensalidade"}
              </p>
            </div>
            <span className="rounded-md bg-brand/10 px-2 py-0.5 text-[12px] font-semibold text-brand dark:text-brand-bright">
              {plano.nome}
            </span>
          </div>
          <dl className="mt-5 space-y-2.5 text-[13px]">
            <Linha rotulo="Taxa por pedido pago" valor={`${pctBR(taxa.pct)}%`} nota={taxa.individual ? "condição especial" : undefined} />
            <Linha rotulo="Taxa em vendas recuperadas" valor={`${pctBR(taxa.recoveryPct)}%`} />
            <Linha rotulo="Domínios" valor={`${dominios} de ${plano.dominios}`} />
            <Linha rotulo="Histórico de carrinhos" valor={`${plano.historicoDias} dias`} />
            {pago && <Linha rotulo="Mensalidade" valor={brl(plano.precoCents)} />}
          </dl>
          <div className="mt-auto pt-5">
            <Link
              href="/painel/plano"
              className="block w-full rounded-lg bg-soft px-4 py-2 text-center text-[13px] font-semibold text-hi transition hover:bg-hover"
            >
              {pago ? "Renovar ou mudar plano" : "Mudar plano"}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  href,
  destaque = false,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  href?: string;
  destaque?: boolean;
}) {
  const body = (
    <>
      <span className="block truncate text-[13px] font-medium text-low">{label}</span>
      <div
        className={`mt-3 whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.025em] xl:text-[26px] ${
          destaque ? "text-brand dark:text-brand-bright" : "text-hi"
        }`}
      >
        {value}
      </div>
      <div className="mt-2.5 truncate text-[12.5px] text-low">{note}</div>
    </>
  );
  const cls = "block min-w-0 rounded-2xl bg-card p-5";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:bg-soft`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Integracao({ nome, desc, href, ativo, logo }: { nome: string; desc: string; href: string; ativo: boolean; logo?: string }) {
  return (
    <Link href={href} className="group flex min-w-0 flex-col rounded-xl border border-line p-4 transition-colors hover:bg-soft">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" width={36} height={36} className="h-9 w-9 rounded-lg object-cover ring-1 ring-inset ring-black/10" />
      ) : (
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-soft text-mid">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m3 11 15-6v14L3 13v-2Z" />
            <path d="M7 13v4a2 2 0 0 0 4 0" />
          </svg>
        </span>
      )}
      <h3 className="mt-3 text-[13.5px] font-semibold text-hi">{nome}</h3>
      <p className="mt-0.5 text-[12.5px] leading-snug text-low">{desc}</p>
      <span className="mt-auto pt-3 text-[12.5px] font-medium">
        {ativo ? (
          <span className="text-brand dark:text-brand-bright">Ativo</span>
        ) : (
          <span className="text-hi transition group-hover:text-brand dark:group-hover:text-brand-bright">Configurar ›</span>
        )}
      </span>
    </Link>
  );
}

function Linha({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-low">{rotulo}</dt>
      <dd className="text-right font-medium tabular-nums text-hi">
        {valor}
        {nota && <span className="ml-1.5 text-[11.5px] font-normal text-dim">{nota}</span>}
      </dd>
    </div>
  );
}

function Faixa({ tom, href, acao, children }: { tom: "aviso" | "alerta"; href: string; acao: string; children: React.ReactNode }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        tom === "alerta" ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <p className="text-[13px] text-mid">{children}</p>
      <Link href={href} className="flex-shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-hover">
        {acao}
      </Link>
    </div>
  );
}

function Check({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
