import "server-only";
import { query } from "./db";
import { rangeClause, spMidnight, ymdTodaySP } from "./painel-range";
import { abandonedCartsSql, recoveredOrdersSql } from "./abandoned-carts";

// Séries no tempo dos gráficos do dashboard. Mesmas regras dos números da tela
// (mesmo recorte de período, mesmos filtros de "pago", de carrinho abandonado e
// de venda recuperada), só que quebradas em baldes de hora, dia ou mês.
//
// O banco grava em UTC; o lojista pensa em horário de São Paulo, que é UTC-3
// fixo desde 2019. Por isso o balde é calculado sobre `col - 3h`.

export type Gran = "hour" | "day" | "month";

export type SeriesBlock = {
  gran: Gran;
  /** Rótulo de cada balde ("00h", "12/11", "nov/26"). */
  labels: string[];
  /** Último balde que já aconteceu (o resto do dia de hoje ainda não chegou). */
  nowIndex: number;
  currentLabel: string;
  cur: Record<string, number[]>;
};

const DAY = 86400000;
const SP = 3 * 3600000;

/** "YYYY-MM-DD" (SP) de um instante. */
function ymdSP(d: Date): string {
  return new Date(d.getTime() - SP).toISOString().slice(0, 10);
}
const addDays = (ymd: string, n: number) => ymdSP(new Date(spMidnight(ymd).getTime() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((spMidnight(b).getTime() - spMidnight(a).getTime()) / DAY);

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dayMonth = (ymd: string) => `${Number(ymd.slice(8, 10))} de ${MES[Number(ymd.slice(5, 7)) - 1]}`;
const rangeText = (a: string, b: string) => (a === b ? dayMonth(a) : `${dayMonth(a)} - ${dayMonth(b)}`);

function bucketExpr(col: string, gran: Gran): string {
  const local = `DATE_SUB(${col}, INTERVAL 3 HOUR)`;
  if (gran === "hour") return `DATE_FORMAT(${local}, '%Y-%m-%d %H')`;
  if (gran === "day") return `DATE_FORMAT(${local}, '%Y-%m-%d')`;
  return `DATE_FORMAT(${local}, '%Y-%m')`;
}

type Plan = {
  gran: Gran;
  since: Date;
  until: Date;
  keys: string[];
  labels: string[];
  nowIndex: number;
  label: string;
};

/** Baldes de uma faixa [since, until). */
function plan(since: Date, until: Date): Plan {
  const first = ymdSP(since);
  const last = ymdSP(new Date(until.getTime() - 1));
  const days = daysBetween(first, last) + 1;
  const gran: Gran = (days <= 1 ? "hour" : days <= 62 ? "day" : "month");
  const now = Date.now();
  const keys: string[] = [];
  const labels: string[] = [];
  if (gran === "hour") {
    for (let h = 0; h < 24; h++) {
      keys.push(`${first} ${String(h).padStart(2, "0")}`);
      labels.push(`${String(h).padStart(2, "0")}h`);
    }
  } else if (gran === "day") {
    for (let i = 0; i < days; i++) {
      const d = addDays(first, i);
      keys.push(d);
      labels.push(`${d.slice(8, 10)}/${d.slice(5, 7)}`);
    }
  } else {
    let y = Number(first.slice(0, 4));
    let m = Number(first.slice(5, 7));
    const ly = Number(last.slice(0, 4));
    const lm = Number(last.slice(5, 7));
    while (y < ly || (y === ly && m <= lm)) {
      keys.push(`${y}-${String(m).padStart(2, "0")}`);
      labels.push(`${MES[m - 1]}/${String(y).slice(2)}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  // Até onde a linha vai: no dia de hoje, só até a hora atual.
  let nowIndex = keys.length - 1;
  if (gran === "hour" && first === ymdSP(new Date(now))) {
    nowIndex = new Date(now - SP).getUTCHours();
  }
  return { gran, since, until, keys, labels, nowIndex, label: rangeText(first, last) };
}

async function collect(storeId: string, p: Plan): Promise<Record<string, number[]>> {
  const idx = new Map(p.keys.map((k, i) => [k, i]));
  const n = p.keys.length;
  const z = () => new Array<number>(n).fill(0);
  const out: Record<string, number[]> = {
    paid: z(), paidCount: z(), orders: z(), ticket: z(),
    pix: z(), card: z(), mobile: z(), desktop: z(),
    pending: z(), abandoned: z(), recovered: z(),
  };
  const r = rangeClause("createdAt", p.since, p.until);
  const b = bucketExpr("createdAt", p.gran);

  // Mesmas regras dos cartões: "pago" = PAID ou SHIPPED; tentativas de cartão
  // agrupadas (cardHiddenBy) não contam como pedido; tablet entra em Mobile.
  const rows = await query<any>(
    `SELECT ${b} AS b,
            SUM(CASE WHEN cardHiddenBy IS NULL THEN 1 ELSE 0 END) AS orders,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents ELSE 0 END) AS paid,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN 1 ELSE 0 END) AS paidCount,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'PIX' THEN totalCents ELSE 0 END) AS pix,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') AND paymentMethod = 'CREDIT_CARD' THEN totalCents ELSE 0 END) AS card,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') AND device IN ('MOBILE','TABLET') THEN totalCents ELSE 0 END) AS mobile,
            SUM(CASE WHEN status IN ('PAID','SHIPPED') AND device = 'DESKTOP' THEN totalCents ELSE 0 END) AS desktop,
            SUM(CASE WHEN status = 'PENDING' THEN totalCents ELSE 0 END) AS pending
       FROM orders WHERE storeId = ?${r.sql}
      GROUP BY b`,
    [storeId, ...r.params],
  );
  for (const row of rows) {
    const i = idx.get(String(row.b));
    if (i === undefined) continue;
    for (const k of ["orders", "paid", "paidCount", "pix", "card", "mobile", "desktop", "pending"]) out[k][i] = Number(row[k] ?? 0);
  }
  out.ticket = out.paid.map((v, i) => (out.paidCount[i] > 0 ? Math.round(v / out.paidCount[i]) : 0));

  const rl = rangeClause("ac.updatedAt", p.since, p.until);
  const ab = await query<any>(
    `SELECT ${bucketExpr("d.updatedAt", p.gran)} AS b, SUM(d.totalCents) AS v
       FROM (${abandonedCartsSql(rl.sql)}) d GROUP BY b`,
    [storeId, ...rl.params],
  );
  for (const row of ab) {
    const i = idx.get(String(row.b));
    if (i !== undefined) out.abandoned[i] = Number(row.v ?? 0);
  }

  const rr = rangeClause("o.createdAt", p.since, p.until);
  const rec = await query<any>(recoveredOrdersSql(rr.sql, bucketExpr("o.createdAt", p.gran)), [storeId, ...rr.params]);
  for (const row of rec) {
    const i = idx.get(String(row.b));
    if (i !== undefined) out.recovered[i] = Number(row.valor ?? 0);
  }
  return out;
}

/**
 * Séries do período escolhido no filtro — só dele, sem período de comparação.
 * Os baldes começam na meia-noite do primeiro dia, mas a consulta usa o limite
 * exato do filtro ("7 dias" = últimas 168 h), para o gráfico somar o mesmo que
 * os cartões.
 */
export async function dashboardSeries(
  storeId: string,
  _key: string,
  since: Date | null,
  until: Date | null,
): Promise<SeriesBlock> {
  let from = since;
  if (!from) {
    const [row] = await query<{ m: string | Date | null }>(`SELECT MIN(createdAt) AS m FROM orders WHERE storeId = ?`, [storeId]);
    from = row?.m ? spMidnight(ymdSP(new Date(row.m))) : spMidnight(ymdTodaySP());
  }
  const start = spMidnight(ymdSP(from));
  const end = until ?? new Date(spMidnight(ymdTodaySP()).getTime() + DAY);
  const cur = plan(start, end);
  // Recorte exato do filtro (sem limite inferior em "Tudo").
  cur.since = since ?? new Date(0);
  if (!until) cur.until = new Date(Date.now() + 60000);

  const c = await collect(storeId, cur);
  return { gran: cur.gran, labels: cur.labels, nowIndex: cur.nowIndex, currentLabel: cur.label, cur: c };
}
