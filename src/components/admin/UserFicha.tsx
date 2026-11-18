import type { KycDoUsuario, PagamentoPlano, UltimoAcesso } from "@/lib/admin";
import type { PlanoDaConta } from "@/lib/plans";
import { PLANOS, isPlanoId } from "@/lib/planos";
import { brl, fmtDate, fmtDateTime } from "@/components/admin/ui";
import AlterarPlano from "@/components/admin/AlterarPlano";

// Blocos de leitura da ficha da conta (cadastro, plano, acesso). Server
// component: nada aqui é editável, exceto o botão de alterar o plano, que é a
// própria peça client AlterarPlano.

const digitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

function fmtDocumento(tipo: string | null, doc: string | null) {
  const d = digitos(doc);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return doc || "—";
}
function fmtTelefone(v: string | null) {
  const d = digitos(v);
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  return v || "—";
}
const fmtCep = (v: string) => digitos(v).replace(/^(\d{5})(\d{3})$/, "$1-$2");

/** Aparelho e navegador em linguagem humana, a partir do user-agent. */
function aparelho(ua: string | null) {
  if (!ua) return "—";
  const so = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "outro sistema";
  const nav = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${nav} no ${so}`;
}

const STATUS_PAGAMENTO: Record<string, { texto: string; cls: string }> = {
  PENDING: { texto: "Pix gerado", cls: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400" },
  PAID: { texto: "Pago", cls: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400" },
  EXPIRED: { texto: "Pix vencido", cls: "bg-soft text-low ring-line" },
  ADMIN: { texto: "Concedido pelo admin", cls: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-400" },
};

export function StatusPagamento({ status }: { status: string }) {
  const s = STATUS_PAGAMENTO[status] ?? { texto: status, cls: "bg-soft text-mid ring-line" };
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${s.cls}`}>{s.texto}</span>;
}

export const nomePlano = (p: string | null | undefined) => (p && isPlanoId(p) ? PLANOS[p].nome : p || "—");

function Secao({ titulo, acao, children }: { titulo: string; acao?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-hi">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Campo({ rotulo, children, largo = false }: { rotulo: string; children: React.ReactNode; largo?: boolean }) {
  return (
    <div className={largo ? "sm:col-span-2" : ""}>
      <dt className="mb-1 text-[11px] font-semibold text-low">{rotulo}</dt>
      <dd className="break-words text-sm text-hi">{children}</dd>
    </div>
  );
}

/** Cadastro: o que a pessoa informou ao criar a conta (etapas 1 e 2). */
export function Cadastro({ phone, cpf, kyc }: { phone: string | null; cpf: string | null; kyc: KycDoUsuario | null }) {
  return (
    <Secao titulo="Cadastro">
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Celular">{fmtTelefone(phone)}</Campo>
        <Campo rotulo={kyc ? kyc.documentType : "CPF"}>{kyc ? fmtDocumento(kyc.documentType, kyc.document) : fmtDocumento("CPF", cpf)}</Campo>
        {kyc ? (
          <>
            <Campo rotulo="Endereço" largo>
              {kyc.street}, {kyc.number}
              {kyc.complement ? ` — ${kyc.complement}` : ""}
              <span className="block text-low">
                {kyc.neighborhood} · {kyc.city}/{kyc.state} · CEP {fmtCep(kyc.cep)}
              </span>
            </Campo>
            <Campo rotulo="Cadastro completo em">{fmtDateTime(kyc.createdAt)}</Campo>
          </>
        ) : (
          <Campo rotulo="Documento e endereço" largo>
            <span className="text-low">Conta criada antes do cadastro em duas etapas: sem documento e endereço registrados.</span>
          </Campo>
        )}
      </dl>
    </Secao>
  );
}

/** Plano em vigor, ação de alterar e histórico de pagamentos do plano. */
export function Plano({
  userId,
  conta,
  plano,
  pagamentos,
  taxaPadrao,
}: {
  userId: string;
  conta: string;
  plano: PlanoDaConta;
  pagamentos: PagamentoPlano[];
  taxaPadrao: number;
}) {
  const p = PLANOS[plano.plano];
  const pago = PLANOS[plano.contratado ?? "basic"].precoCents > 0;
  const dias = plano.expiraEm ? Math.ceil((plano.expiraEm.getTime() - Date.now()) / 86_400_000) : null;
  const situacao = !plano.escolhido
    ? "Ainda não escolheu um plano"
    : plano.vencido
      ? `${nomePlano(plano.contratado)} vencido${dias !== null ? ` há ${Math.abs(dias)} dia(s)` : ""} — valendo como Basic`
      : pago && dias !== null
        ? `Faltam ${Math.max(0, dias)} dia(s)`
        : "Sem vencimento";
  const totalPago = pagamentos.filter((x) => x.status === "PAID").reduce((s, x) => s + Number(x.amountCents), 0);

  return (
    <Secao titulo="Plano" acao={<AlterarPlano userId={userId} conta={conta} planoAtual={plano.plano} />}>
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Plano em vigor">
          <span className="font-semibold">{plano.escolhido ? p.nome : "—"}</span>
        </Campo>
        <Campo rotulo="Situação">{situacao}</Campo>
        <Campo rotulo="Válido até">{pago && plano.expiraEm ? fmtDate(plano.expiraEm) : "—"}</Campo>
        <Campo rotulo="Taxas do plano">
          {(p.pct ?? taxaPadrao).toLocaleString("pt-BR")}% por pedido · {p.recoveryPct.toLocaleString("pt-BR")}% em recuperadas
        </Campo>
        <Campo rotulo="Pago em planos">{totalPago > 0 ? brl(totalPago) : "—"}</Campo>
      </dl>

      <div className="border-t border-line">
        <div className="px-5 pb-1 pt-3 text-[12.5px] font-semibold text-low">Pagamentos do plano</div>
        {pagamentos.length === 0 ? (
          <p className="px-5 pb-5 pt-1 text-sm text-low">Nenhum Pix de plano gerado nem plano concedido.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold text-low">
                  <th className="px-5 py-2">Data</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Situação</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-5 py-2">Pago em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pagamentos.map((x) => (
                  <tr key={x.id}>
                    <td className="px-5 py-2.5 tabular-nums text-mid">{fmtDateTime(x.createdAt)}</td>
                    <td className="px-3 py-2.5 font-medium text-hi">{nomePlano(x.plan)}</td>
                    <td className="px-3 py-2.5"><StatusPagamento status={x.status} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-hi">{Number(x.amountCents) > 0 ? brl(Number(x.amountCents)) : "—"}</td>
                    <td className="px-5 py-2.5 tabular-nums text-mid">{x.paidAt ? fmtDateTime(x.paidAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Secao>
  );
}

/** Último acesso: quando, de onde e de qual aparelho. */
export function Acesso({ ultimo, sessoes }: { ultimo: UltimoAcesso | null; sessoes: number }) {
  const local = ultimo ? [ultimo.city, ultimo.region, ultimo.country].filter(Boolean).join(", ") : "";
  return (
    <Secao titulo="Acesso">
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Último login">{ultimo ? fmtDateTime(ultimo.createdAt) : "Nunca entrou"}</Campo>
        <Campo rotulo="Local">{local || "—"}</Campo>
        <Campo rotulo="IP">{ultimo?.ip || "—"}</Campo>
        <Campo rotulo="Aparelho">{aparelho(ultimo?.userAgent ?? null)}</Campo>
        <Campo rotulo="Sessões ativas">{sessoes}</Campo>
      </dl>
    </Secao>
  );
}
