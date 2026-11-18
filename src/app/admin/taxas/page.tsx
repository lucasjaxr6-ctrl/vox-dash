import { requireAdmin } from "@/lib/auth";
import { getFeeConfig, resumoTaxas, listarCobrancas } from "@/lib/platform-fees";
import { PageHeader, MetricCard, brl, fmtDateTime } from "@/components/admin/ui";
import TaxasManager, { type Transacao } from "@/components/admin/TaxasManager";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";

export const dynamic = "force-dynamic";

// Taxas da plataforma: os totais, os percentuais padrão e a movimentação das
// cobranças.
//
// O saldo POR LOJA saiu daqui: quem gera o Pix é o próprio lojista, no painel
// dele, e a taxa individual é definida na ficha em Usuários. O que faltava
// nesta tela era acompanhar o dinheiro se mexendo — Pix gerado, pago, vencido.
export default async function AdminTaxas() {
  await requireAdmin();
  const [cfg, resumo, cobrancas] = await Promise.all([getFeeConfig(), resumoTaxas(), listarCobrancas()]);

  // Datas formatadas no servidor: o componente é client e formatar lá daria
  // fuso do navegador, que não é o do negócio.
  const transacoes: Transacao[] = cobrancas.map((c) => ({
    id: c.id,
    loja: c.loja,
    txnId: c.txnId,
    amountCents: Number(c.amountCents),
    status: c.status,
    feeCount: Number(c.feeCount),
    criadoEm: fmtDateTime(c.createdAt),
    pagoEm: c.paidAt ? fmtDateTime(c.paidAt) : null,
  }));

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Taxas da plataforma"
        subtitle={`${cfg.pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% por venda aprovada (ou a taxa própria de cada loja), valendo desde ${new Date(
          cfg.startedAt,
        ).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total gerado"
          value={<AnimatedNumber value={Number(resumo.totalCents)} format="brl" display />}
          note={`${resumo.pedidos} venda(s) sobre ${brl(resumo.baseCents)}`}
        />
        <MetricCard
          label="Taxas não pagas"
          value={<AnimatedNumber value={Number(resumo.pendentesCents)} format="brl" display />}
          note={`${resumo.lojasDevendo} loja(s) com saldo em aberto`}
        />
        <MetricCard label="Taxas pagas" value={<AnimatedNumber value={Number(resumo.pagasCents)} format="brl" display />} note="Recebido via Pix" />
      </div>

      <TaxasManager pct={cfg.pct} recoveryPct={cfg.recoveryPct} transacoes={transacoes} />
    </div>
  );
}
