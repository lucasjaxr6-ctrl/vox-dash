import Link from "next/link";
import InitialsAvatar from "@/components/painel/InitialsAvatar";
import ContadorTentativas from "@/components/painel/ContadorTentativas";
import { orderStatusBadge } from "@/lib/order-status";
import { TextLink } from "./Viz";

export type RecentOrder = {
  id: string;
  status: string;
  paymentMethod: string | null;
  /** Recusas seguidas do mesmo cartão que esta linha representa. */
  cardAttempts?: number;
  totalCents: number;
  createdAt: Date | string;
  name: string;
  email: string | null;
};

const TZ = "America/Sao_Paulo";

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function ymd(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** "Hoje, 14:32" · "Ontem, 09:10" · "12/09, 18:44" · "12/09/2025, 18:44". */
function when(value: Date | string) {
  const d = new Date(value);
  const time = d.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const day = ymd(d);
  const now = new Date();
  if (day === ymd(now)) return `Hoje, ${time}`;
  if (day === ymd(new Date(now.getTime() - 86400000))) return `Ontem, ${time}`;
  const sameYear = day.slice(0, 4) === ymd(now).slice(0, 4);
  const date = d.toLocaleDateString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}

// Últimos pedidos do período. Cada linha abre o pedido.
export default function RecentOrders({ orders }: { orders: RecentOrder[] }) {
  return (
    <section className="rounded-2xl bg-card">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5">
        <h2 className="text-[14px] font-semibold text-hi">Pedidos recentes</h2>
        <TextLink href="/painel/vendas">Ver todas</TextLink>
      </div>

      {orders.length === 0 ? (
        <p className="px-5 pb-6 pt-3 text-[12.5px] text-low">
          Nenhum pedido no período. Eles aparecem aqui assim que chegarem.
        </p>
      ) : (
        <ul className="px-2 pb-2">
          {orders.map((o) => {
            const st = orderStatusBadge(o.status, o.paymentMethod);
            return (
              <li key={o.id}>
                <Link
                  href={`/painel/vendas/${encodeURIComponent(o.id)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1.5 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(6.5rem,auto)_7.5rem]"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <InitialsAvatar name={o.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-hi">{o.name}</span>
                      {o.email && <span className="block truncate text-[12px] text-low">{o.email}</span>}
                    </span>
                  </span>
                  <span className="text-right text-[13.5px] font-medium tabular-nums text-hi sm:order-3">
                    {brl(o.totalCents)}
                  </span>
                  {/* No celular o status desce para baixo do nome, alinhado ao texto (e não ao avatar). */}
                  <span className="inline-flex items-center gap-1.5 pl-11 sm:order-2 sm:pl-0">
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${st.cls}`}>
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                    <ContadorTentativas n={o.cardAttempts} />
                  </span>
                  <span
                    className="text-right text-[12.5px] tabular-nums text-low sm:order-4"
                    title={new Date(o.createdAt).toLocaleString("pt-BR", { timeZone: TZ })}
                  >
                    {when(o.createdAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
