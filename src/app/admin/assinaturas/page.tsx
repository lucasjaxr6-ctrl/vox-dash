import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { listarAssinaturas, type Assinatura } from "@/lib/plans";
import { getPagamentosPlano } from "@/lib/admin";
import { PLANOS } from "@/lib/planos";
import { PageHeader, MetricCard, EmptyState, brl, fmtDateTime } from "@/components/admin/ui";
import { StatusPagamento, nomePlano } from "@/components/admin/UserFicha";

export const dynamic = "force-dynamic";

// Assinaturas: os números das assinaturas e o extrato dos pagamentos de plano
// (Pix gerado, pago, vencido, concedido pelo admin). Só leitura — mudar o
// plano de alguém é na ficha da conta, em Usuários.

/** Vence em até N dias = "vencendo". */
const JANELA_VENCENDO = 7;

type Filtro = "todos" | "PENDING" | "PAID" | "EXPIRED" | "ADMIN";

const FILTROS: { key: Filtro; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "PAID", label: "Pagos" },
  { key: "PENDING", label: "Pix gerado" },
  { key: "EXPIRED", label: "Pix vencido" },
  { key: "ADMIN", label: "Concedidos pelo admin" },
];

const pagaAtiva = (a: Assinatura) => PLANOS[a.plano].precoCents > 0;
const vencendo = (a: Assinatura) => pagaAtiva(a) && a.diasRestantes !== null && a.diasRestantes <= JANELA_VENCENDO;

export default async function AdminAssinaturas({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireAdmin();
  const f = ((await searchParams).f ?? "todos") as Filtro;
  const filtro: Filtro = FILTROS.some((x) => x.key === f) ? f : "todos";

  const [contas, pagamentos, [receita]] = await Promise.all([
    listarAssinaturas(),
    getPagamentosPlano({ limit: 300 }),
    query<{ total: number; mes: number }>(
      `SELECT COALESCE(SUM(amountCents), 0) AS total,
              COALESCE(SUM(CASE WHEN paidAt >= NOW(3) - INTERVAL 30 DAY THEN amountCents ELSE 0 END), 0) AS mes
         FROM plan_charges WHERE status = 'PAID'`,
    ),
  ]);

  const ativas = contas.filter(pagaAtiva);
  const porPlano = (id: "premium" | "enterprise") => ativas.filter((a) => a.plano === id).length;
  const lista = filtro === "todos" ? pagamentos : pagamentos.filter((p) => p.status === filtro);

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Assinaturas"
        subtitle="Números das assinaturas e os pagamentos de plano. Para mudar o plano de alguém, abra a conta em Usuários."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Pagas ativas" value={String(ativas.length)} note={`${porPlano("premium")} Premium · ${porPlano("enterprise")} Enterprise`} />
        <MetricCard label={`Vencendo em ${JANELA_VENCENDO} dias`} value={String(contas.filter(vencendo).length)} note="Renovação ou volta ao Basic" />
        <MetricCard label="Vencidas" value={String(contas.filter((a) => a.vencido).length)} note="Já valendo como Basic" />
        <MetricCard label="Receita de planos" value={brl(Number(receita?.mes ?? 0))} note={`últimos 30 dias · ${brl(Number(receita?.total ?? 0))} no total`} />
      </div>

      <nav aria-label="Filtro" className="flex flex-wrap gap-1.5">
        {FILTROS.map((x) => {
          const n = x.key === "todos" ? pagamentos.length : pagamentos.filter((p) => p.status === x.key).length;
          const ativo = x.key === filtro;
          return (
            <Link
              key={x.key}
              href={x.key === "todos" ? "/admin/assinaturas" : `/admin/assinaturas?f=${x.key}`}
              aria-current={ativo ? "page" : undefined}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium transition ${
                ativo ? "bg-brand/10 text-brand dark:text-brand-bright" : "bg-card text-mid hover:bg-hover hover:text-hi"
              }`}
            >
              {x.label} <span className="tabular-nums text-low">{n}</span>
            </Link>
          );
        })}
      </nav>

      <section className="overflow-hidden rounded-2xl bg-card">
        {lista.length === 0 ? (
          <EmptyState>Nenhum pagamento de plano neste filtro.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-low">
                  <th className="px-5 pb-2.5 pt-4">Data</th>
                  <th className="px-3 pb-2.5 pt-4">Conta</th>
                  <th className="px-3 pb-2.5 pt-4">Plano</th>
                  <th className="px-3 pb-2.5 pt-4">Situação</th>
                  <th className="px-3 pb-2.5 pt-4 text-right">Valor</th>
                  <th className="px-3 pb-2.5 pt-4">Pago em</th>
                  <th className="px-5 pb-2.5 pt-4">Transação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-hover">
                    <td className="whitespace-nowrap px-5 py-3 tabular-nums text-mid">{fmtDateTime(p.createdAt)}</td>
                    <td className="max-w-[260px] px-3 py-3">
                      <Link href={`/admin/usuarios/${p.userId}`} className="block truncate font-semibold text-hi hover:underline">
                        {p.name || "—"}
                      </Link>
                      <div className="truncate text-xs text-low">{p.email ?? "conta removida"}</div>
                    </td>
                    <td className="px-3 py-3 font-medium text-hi">{nomePlano(p.plan)}</td>
                    <td className="px-3 py-3"><StatusPagamento status={p.status} /></td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{Number(p.amountCents) > 0 ? brl(Number(p.amountCents)) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-mid">{p.paidAt ? fmtDateTime(p.paidAt) : "—"}</td>
                    <td className="max-w-[160px] truncate px-5 py-3 font-mono text-[11.5px] text-low" title={p.txnId ?? undefined}>
                      {p.txnId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
