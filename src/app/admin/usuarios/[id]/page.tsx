import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getUserDetail, getLojasDoUsuario, getKycDoUsuario, getUltimoAcesso, getPagamentosPlano } from "@/lib/admin";
import { getFeeConfig } from "@/lib/platform-fees";
import { getPaymentRouting } from "@/lib/settings";
import { getGateway } from "@/lib/gateways";
import { planoDaConta } from "@/lib/plans";
import { PLANOS } from "@/lib/planos";
import { MetricCard, brl, fmtDateTime } from "@/components/admin/ui";
import UserDetail, { type LojaDetalhe } from "@/components/admin/UserDetail";
import { Cadastro, Plano, Acesso } from "@/components/admin/UserFicha";

export const dynamic = "force-dynamic";

const nomeGateway = (k: string | null) => (k ? getGateway(k)?.name ?? k : null);

// Ficha de uma conta. Tudo que é sensível mora aqui dentro, e não na
// listagem: banir, suspender e excluir afetam o negócio de outra pessoa e não
// podem estar a um clique distraído no meio de uma tabela que se rola.
export default async function AdminUsuario({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;

  const [conta, lojas, padrao, kyc, ultimo, pagamentos, plano] = await Promise.all([
    getUserDetail(id),
    getLojasDoUsuario(id),
    getFeeConfig(),
    getKycDoUsuario(id),
    getUltimoAcesso(id),
    getPagamentosPlano({ userId: id, limit: 50 }),
    planoDaConta(id),
  ]);
  if (!conta) notFound();

  // Gateway que processa Pix e cartão em cada loja AGORA (mesma regra do checkout).
  const rotas = await Promise.all(lojas.map((l) => getPaymentRouting(l.id).catch(() => null)));

  const linhas: LojaDetalhe[] = lojas.map((l, i) => ({
    id: l.id,
    name: l.name,
    orders: Number(l.orders),
    gmvCents: Number(l.gmvCents),
    // DECIMAL volta como string no driver.
    pctIndividual: l.pctIndividual === null || l.pctIndividual === undefined ? null : Number(l.pctIndividual),
    recoveryPctIndividual:
      l.recoveryPctIndividual === null || l.recoveryPctIndividual === undefined
        ? null
        : Number(l.recoveryPctIndividual),
    taxasPendentesCents: Number(l.taxasPendentesCents),
    taxasPagasCents: Number(l.taxasPagasCents),
    criadaEm: fmtDateTime(l.createdAt),
    dominio: l.customDomain,
    dominioVerificado: Number(l.domainVerified ?? 0) === 1,
    shopify: l.shopifyStoreDomain,
    produtos: Number(l.produtos ?? 0),
    configurada: Number(l.configurada ?? 0) === 1,
    gatewayPix: nomeGateway(rotas[i]?.pixProvider ?? null),
    gatewayCartao: nomeGateway(rotas[i]?.cardProvider ?? null),
  }));

  const emAberto = linhas.reduce((s, l) => s + l.taxasPendentesCents, 0);
  // Taxa padrão das lojas desta conta = a do plano (Basic segue a da plataforma).
  const taxaPlano = {
    pct: PLANOS[plano.plano].pct ?? padrao.pct,
    recoveryPct: PLANOS[plano.plano].recoveryPct,
  };

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <Link href="/admin/usuarios" className="inline-flex items-center gap-1.5 text-sm font-semibold text-mid hover:text-hi">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Usuários
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">{conta.name || "Sem nome"}</h1>
          {conta.banned === 1 && (
            <span className="rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:text-red-400 ring-1 ring-inset ring-red-500/20">
              BANIDA · não consegue entrar
            </span>
          )}
          {conta.suspended === 1 && (
            <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20">
              SUSPENSA · painel bloqueado
            </span>
          )}
          {conta.id === admin.id && <span className="text-[11px] font-bold text-brand dark:text-brand-bright">(você)</span>}
        </div>
        <p className="mt-0.5 text-sm text-low">
          {conta.email} · conta criada em {fmtDateTime(conta.createdAt)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Faturamento" value={brl(Number(conta.gmvCents))} />
        <MetricCard label="Lojas" value={String(conta.storeCount)} />
        <MetricCard
          label="Taxa em aberto"
          value={brl(emAberto)}
          note={emAberto > 0 ? "suspende o painel após 3 dias" : "nada a cobrar"}
        />
        <MetricCard
          label="Plano"
          value={plano.escolhido ? PLANOS[plano.plano].nome : "—"}
          note={plano.vencido ? "pago vencido, vale como Basic" : plano.escolhido ? undefined : "ainda não escolheu"}
        />
      </div>

      <UserDetail
        conta={{
          id: conta.id,
          email: conta.email,
          name: conta.name,
          role: conta.role,
          banned: Number(conta.banned),
          suspended: Number(conta.suspended),
        }}
        lojas={linhas}
        ehVoce={conta.id === admin.id}
        padrao={taxaPlano}
      >
        <Cadastro phone={conta.phone} cpf={conta.cpf} kyc={kyc} />
        <Plano userId={conta.id} conta={conta.name || conta.email} plano={plano} pagamentos={pagamentos} taxaPadrao={padrao.pct} />
        <Acesso ultimo={ultimo} sessoes={Number(conta.sessions)} />
      </UserDetail>
    </div>
  );
}
