import Link from "next/link";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import DateRangeFilter from "@/components/painel/DateRangeFilter";
import { PERIODS, resolveRange, rangeClause } from "@/lib/painel-range";

// Comparação de vendas por dispositivo: de onde sai mais venda, celular ou
// computador. Tela própria porque a comparação útil é lado a lado (pedidos,
// vendas pagas, conversão e ticket) — espremer isso num cartão do Dashboard
// ficava ilegível.
//
// ⚠️ Só vale para pedidos criados DEPOIS de passarmos a gravar o dispositivo.
// Nunca guardamos o user-agent do comprador antes disso e não há como
// reconstruir — por isso a faixa "Não identificado" aparece enquanto houver
// pedido antigo no período. Sem ela, um período antigo mostraria 0 x 0 e
// pareceria defeito.

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(n: number) {
  return `${(n * 100).toFixed(1).replace(".", ",")}%`;
}

type Row = {
  device: string | null;
  orders: number;
  paidOrders: number;
  paidCents: number;
};

export default async function DispositivosPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const store = await getActiveStore();
  const { period, from, to } = await searchParams;
  const { key: activeKey, since, until } = resolveRange(period, from, to);

  if (!store) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dispositivos</h1>
        <div className="mt-6 rounded-2xl bg-card p-12 text-center">
          <p className="text-[13px] text-low">Crie sua primeira loja no seletor à esquerda para começar.</p>
        </div>
      </div>
    );
  }

  const r = rangeClause("createdAt", since, until);
  // TABLET entra em MOBILE: é aparelho de toque e a pergunta do lojista tem dois
  // lados, não três. O valor exato continua gravado no pedido.
  const rows = await query<Row>(
    `SELECT CASE WHEN device IN ('MOBILE','TABLET') THEN 'MOBILE'
                 WHEN device = 'DESKTOP' THEN 'DESKTOP'
                 ELSE NULL END AS device,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END), 0) AS paidOrders,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END), 0) AS paidCents
       FROM orders
      WHERE storeId = ?${r.sql}
      GROUP BY 1`,
    [store.id, ...r.params],
  );

  const pick = (d: string | null) => rows.find((x) => x.device === d);
  const mob = pick("MOBILE");
  const desk = pick("DESKTOP");
  const unknown = pick(null);

  const m = {
    label: "Mobile",
    orders: Number(mob?.orders ?? 0),
    paidOrders: Number(mob?.paidOrders ?? 0),
    paidCents: Number(mob?.paidCents ?? 0),
  };
  const d = {
    label: "Desktop",
    orders: Number(desk?.orders ?? 0),
    paidOrders: Number(desk?.paidOrders ?? 0),
    paidCents: Number(desk?.paidCents ?? 0),
  };
  const unknownOrders = Number(unknown?.orders ?? 0);
  const unknownPaidCents = Number(unknown?.paidCents ?? 0);

  // Comparação é SEMPRE entre os dois identificados. Incluir os antigos no
  // denominador achataria as duas barras e responderia outra pergunta.
  const knownPaidCents = m.paidCents + d.paidCents;
  const knownOrders = m.orders + d.orders;
  const shareOf = (part: number, whole: number) => (whole > 0 ? part / whole : 0);
  const conv = (x: { orders: number; paidOrders: number }) => (x.orders > 0 ? x.paidOrders / x.orders : 0);
  const ticket = (x: { paidOrders: number; paidCents: number }) => (x.paidOrders > 0 ? x.paidCents / x.paidOrders : 0);

  const semDados = knownOrders === 0;
  const vencedor = knownPaidCents === 0 ? null : m.paidCents >= d.paidCents ? m : d;

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dispositivos</h1>
          <p className="mt-1 text-[13px] text-low">
            De onde vendem mais os clientes de <span className="font-medium text-mid">{store.name}</span> — celular ou computador.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-xl p-1 bg-card">
            {PERIODS.map((p) => (
              <Link
                key={p.key}
                href={`/painel/dispositivos?period=${p.key}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  activeKey === p.key
                    ? "bg-brand text-white"
                    : "text-low hover:bg-hover hover:text-hi"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <DateRangeFilter active={activeKey === "custom"} from={from ?? ""} to={to ?? ""} />
        </div>
      </div>

      {semDados ? (
        <div className="rounded-2xl bg-card p-12 text-center">
          <p className="text-[13px] font-medium text-mid">Ainda não há pedidos com dispositivo registrado neste período.</p>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-low">
            Passamos a registrar o dispositivo agora. Os {unknownOrders > 0 ? unknownOrders.toLocaleString("pt-BR") : ""} pedidos
            anteriores não têm essa informação e não há como recuperá-la — a comparação começa a valer com as próximas vendas.
          </p>
        </div>
      ) : (
        <>
          {/* Barra de participação */}
          <div className="rounded-2xl bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-hi">Participação no faturamento</h2>
              {vencedor && (
                <span className="text-[12.5px] text-low">
                  <span className="font-semibold text-hi">{vencedor.label}</span> lidera com{" "}
                  <span className="font-semibold text-hi">{pct(shareOf(vencedor.paidCents, knownPaidCents))}</span> das vendas pagas
                </span>
              )}
            </div>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-soft">
              <div className="bg-sky-500 transition-all duration-500 dark:bg-sky-400" style={{ width: `${shareOf(m.paidCents, knownPaidCents) * 100}%` }} />
              <div className="bg-indigo-500 transition-all duration-500 dark:bg-indigo-400" style={{ width: `${shareOf(d.paidCents, knownPaidCents) * 100}%` }} />
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
              <Legend dot="bg-sky-500 dark:bg-sky-400" label="Mobile" value={`${brl(m.paidCents)} · ${pct(shareOf(m.paidCents, knownPaidCents))}`} />
              <Legend dot="bg-indigo-500 dark:bg-indigo-400" label="Desktop" value={`${brl(d.paidCents)} · ${pct(shareOf(d.paidCents, knownPaidCents))}`} />
            </div>
          </div>

          {/* Lado a lado */}
          <div className="grid gap-3.5 sm:grid-cols-2">
            <DeviceCard
              icon={<IconPhone />}
              accent="sky"
              title="Mobile"
              note="Inclui tablets"
              orders={m.orders}
              ordersShare={shareOf(m.orders, knownOrders)}
              paidOrders={m.paidOrders}
              paidCents={m.paidCents}
              conv={conv(m)}
              ticket={ticket(m)}
            />
            <DeviceCard
              icon={<IconMonitor />}
              accent="indigo"
              title="Desktop"
              orders={d.orders}
              ordersShare={shareOf(d.orders, knownOrders)}
              paidOrders={d.paidOrders}
              paidCents={d.paidCents}
              conv={conv(d)}
              ticket={ticket(d)}
            />
          </div>

          {/* Leitura da comparação, sem inventar causa. */}
          {m.orders > 0 && d.orders > 0 && (
            <div className="rounded-2xl bg-card p-5">
              <h2 className="text-[13px] font-semibold text-hi">O que isso diz</h2>
              <ul className="mt-2.5 space-y-1.5 text-[12.5px] text-low">
                <li>
                  <b className="text-mid">Volume:</b> {pct(shareOf(m.orders, knownOrders))} dos pedidos vêm do celular
                  e {pct(shareOf(d.orders, knownOrders))} do computador.
                </li>
                <li>
                  <b className="text-mid">Conversão:</b> {pct(conv(m))} no celular contra {pct(conv(d))} no computador
                  {conv(m) !== conv(d) && (
                    <> — quem compra pelo <b className="text-mid">{conv(m) > conv(d) ? "celular" : "computador"}</b> fecha mais.</>
                  )}
                </li>
                <li>
                  <b className="text-mid">Ticket médio:</b> {brl(ticket(m))} no celular contra {brl(ticket(d))} no computador.
                </li>
              </ul>
            </div>
          )}

          {unknownOrders > 0 && (
            <p className="text-[12px] text-low">
              <b className="text-mid">{unknownOrders.toLocaleString("pt-BR")} pedidos</b> deste período
              ({brl(unknownPaidCents)} pagos) são anteriores ao registro de dispositivo e ficam de fora da comparação.
              Não é possível recuperá-los — o número cai sozinho conforme as vendas novas entram.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Legend({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="text-low">{label}</span>
      <span className="font-semibold tabular-nums text-hi">{value}</span>
    </span>
  );
}

function DeviceCard(p: {
  icon: React.ReactNode;
  accent: "sky" | "indigo";
  title: string;
  note?: string;
  orders: number;
  ordersShare: number;
  paidOrders: number;
  paidCents: number;
  conv: number;
  ticket: number;
}) {
  const ring = p.accent === "sky"
    ? "bg-sky-500/10 ring-sky-500/20 text-sky-600 dark:text-sky-400"
    : "bg-indigo-500/10 ring-indigo-500/20 text-indigo-600 dark:text-indigo-400";
  return (
    <div className="rounded-2xl bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-hi">{p.title}</div>
          {p.note && <div className="mt-0.5 text-[11px] text-dim">{p.note}</div>}
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${ring}`}>{p.icon}</span>
      </div>

      <div className="mt-4 text-[26px] font-bold leading-none tracking-tight tabular-nums text-hi">{brl(p.paidCents)}</div>
      <div className="mt-1.5 text-[11.5px] text-dim">
        em {p.paidOrders.toLocaleString("pt-BR")} venda{p.paidOrders === 1 ? "" : "s"} paga{p.paidOrders === 1 ? "" : "s"}
      </div>

      <dl className="mt-4 space-y-2 pt-3 text-[12.5px]">
        <Stat label="Pedidos" value={`${p.orders.toLocaleString("pt-BR")} (${pct(p.ordersShare)})`} />
        <Stat label="Conversão" value={pct(p.conv)} />
        <Stat label="Ticket médio" value={brl(p.ticket)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-low">{label}</dt>
      <dd className="font-semibold tabular-nums text-hi">{value}</dd>
    </div>
  );
}

function IconPhone() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" />
    </svg>
  );
}
function IconMonitor() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  );
}
