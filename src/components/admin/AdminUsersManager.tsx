import Link from "next/link";
import { PLANOS, isPlanoId } from "@/lib/planos";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "MERCHANT" | "ADMIN";
  banned: number;
  suspended: number;
  createdAt: string;
  storeCount: number;
  gmvCents: number;
  plan: string | null;
  planExpiresAt: string | null;
};

/** Plano em vigor, na mesma regra do servidor: pago vencido vale como Basic. */
function PlanoCelula({ plan, expiresAt }: { plan: string | null; expiresAt: string | null }) {
  if (!plan || !isPlanoId(plan)) return <span className="text-xs text-dim">Sem plano</span>;
  const pago = PLANOS[plan].precoCents > 0;
  const vencido = pago && (!expiresAt || new Date(expiresAt).getTime() <= Date.now());
  const fim = expiresAt ? new Date(expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;
  return (
    <span className="block">
      <span className="text-sm font-semibold text-hi">{PLANOS[plan].nome}</span>
      {pago && <span className={`block text-[11px] ${vencido ? "text-red-600 dark:text-red-400" : "text-low"}`}>{vencido ? `venceu ${fim ?? ""}` : `até ${fim}`}</span>}
    </span>
  );
}

const ROLE_BADGE: Record<string, string> = {
  ADMIN: "bg-purple-500/10 text-purple-700 dark:text-purple-400 ring-purple-500/20",
  MERCHANT: "bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/20",
  USER: "bg-soft text-mid ring-line",
};

function brl(cents: number) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Listagem de contas — só leitura.
 *
 * Nenhuma ação mora aqui de propósito. Editar, banir, suspender e excluir
 * ficam na ficha da conta, atrás do olho: são decisões sobre o negócio de
 * outra pessoa, e uma tabela que se rola é o pior lugar possível para um
 * clique errado. Aqui não há nada para clicar errado.
 *
 * Virou server component no processo: sem estado nem ação, não havia mais
 * motivo para mandar JavaScript ao navegador por causa desta tela.
 */
export default function AdminUsersManager({ users, selfId }: { users: AdminUser[]; selfId: string }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
              <th className="px-5 pb-2.5 pt-4">Conta</th>
              <th className="px-3 pb-2.5 pt-4">Papel</th>
              <th className="px-3 pb-2.5 pt-4">Plano</th>
              <th className="px-3 pb-2.5 pt-4 text-right">Lojas</th>
              <th className="px-3 pb-2.5 pt-4 text-right">Faturamento</th>
              <th className="w-12 px-5 pb-2.5 pt-4"><span className="sr-only">Ver</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((u) => {
              const isSelf = u.id === selfId;
              return (
                <tr key={u.id} className={`transition-colors ${u.banned ? "bg-rose-500/[0.06] hover:bg-rose-500/10" : "hover:bg-hover"}`}>
                  <td className="max-w-[320px] px-5 py-3">
                    <div className="truncate font-semibold text-hi">
                      {u.name || "—"} {isSelf && <span className="text-[10px] font-bold text-brand dark:text-brand-bright">(você)</span>}
                    </div>
                    <div className="truncate text-xs text-low">{u.email}</div>
                    <div className="flex flex-wrap gap-1 empty:hidden [&:not(:empty)]:mt-1.5">
                      {u.banned === 1 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-600 ring-1 ring-inset ring-red-500/20 dark:text-red-400"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />Banida</span>
                      )}
                      {u.suspended === 1 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />Suspensa</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${ROLE_BADGE[u.role]}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <PlanoCelula plan={u.plan} expiresAt={u.planExpiresAt} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-mid">{u.storeCount}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(u.gmvCents)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/admin/usuarios/${u.id}`}
                      title="Ver conta"
                      aria-label={`Ver a conta de ${u.email}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-low transition-colors hover:bg-hover hover:text-hi"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
