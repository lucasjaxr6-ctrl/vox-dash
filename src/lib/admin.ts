import "server-only";
import { query, execute } from "./db";

// Agregações da PLATAFORMA (todas as lojas). Só o super-admin acessa — as
// queries NÃO têm escopo por loja de propósito.

export type Range = "today" | "7" | "30" | "all";
export function parseRange(v: string | undefined, fallback: Range = "all"): Range {
  return v === "today" || v === "7" || v === "30" || v === "all" ? v : fallback;
}
// O banco roda em UTC; o lojista pensa no fuso do Brasil (-03:00, sem horário de
// verão). Convertemos para não errar o "hoje" à noite (quando UTC já virou o dia
// seguinte). BR_DATE(x) = a data no fuso de Brasília.
const BR = (col: string) => `DATE(CONVERT_TZ(${col},'+00:00','-03:00'))`;
const BR_TODAY = `DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`;
// Data BR já como STRING 'YYYY-MM-DD' (evita ambiguidade Date-object do driver).
const BR_STR = (col: string) => `DATE_FORMAT(CONVERT_TZ(${col},'+00:00','-03:00'), '%Y-%m-%d')`;

// Fragmento SQL de data (col é literal fixo do nosso código — sem injeção).
function dateFrag(col: string, range: Range): string {
  switch (range) {
    case "today": return ` AND ${BR(col)} = ${BR_TODAY}`;
    case "7": return ` AND ${col} >= NOW() - INTERVAL 7 DAY`;
    case "30": return ` AND ${col} >= NOW() - INTERVAL 30 DAY`;
    default: return "";
  }
}

/** Janela do período em dias (para comparar com o período anterior). */
export const RANGE_DAYS: Record<Range, number | null> = { today: 1, "7": 7, "30": 30, all: null };

/**
 * Fragmento do período ANTERIOR de mesmo tamanho (para o "vs. período anterior").
 * Em "all" não há anterior — devolve null e a tela omite a variação.
 */
function prevFrag(col: string, range: Range): string | null {
  switch (range) {
    case "today":
      return ` AND ${BR(col)} = DATE_SUB(${BR_TODAY}, INTERVAL 1 DAY)`;
    case "7":
      return ` AND ${col} >= NOW() - INTERVAL 14 DAY AND ${col} < NOW() - INTERVAL 7 DAY`;
    case "30":
      return ` AND ${col} >= NOW() - INTERVAL 60 DAY AND ${col} < NOW() - INTERVAL 30 DAY`;
    default:
      return null;
  }
}

export type PlatformStats = {
  merchants: number;
  stores: number;
  paidOrders: number;
  gmvCents: number;
  gmvTodayCents: number;
  ordersToday: number;
  pendingOrders: number;
};

export async function getPlatformStats(range: Range): Promise<PlatformStats> {
  const d = dateFrag("createdAt", range);
  const rows = await query<PlatformStats>(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE role = 'MERCHANT') AS merchants,
      (SELECT COUNT(*) FROM stores) AS stores,
      (SELECT COUNT(*) FROM orders WHERE status IN ('PAID','SHIPPED')${d}) AS paidOrders,
      (SELECT COALESCE(SUM(totalCents),0) FROM orders WHERE status IN ('PAID','SHIPPED')${d}) AS gmvCents,
      (SELECT COALESCE(SUM(totalCents),0) FROM orders WHERE status IN ('PAID','SHIPPED') AND ${BR("createdAt")} = ${BR_TODAY}) AS gmvTodayCents,
      (SELECT COUNT(*) FROM orders WHERE status IN ('PAID','SHIPPED') AND ${BR("createdAt")} = ${BR_TODAY}) AS ordersToday,
      (SELECT COUNT(*) FROM orders WHERE status = 'PENDING') AS pendingOrders`,
  );
  const r = rows[0];
  return {
    merchants: Number(r?.merchants ?? 0),
    stores: Number(r?.stores ?? 0),
    paidOrders: Number(r?.paidOrders ?? 0),
    gmvCents: Number(r?.gmvCents ?? 0),
    gmvTodayCents: Number(r?.gmvTodayCents ?? 0),
    ordersToday: Number(r?.ordersToday ?? 0),
    pendingOrders: Number(r?.pendingOrders ?? 0),
  };
}

// ── Visão geral da plataforma ────────────────────────────────────────────────

/**
 * Quando o funil começou a registrar chegadas no checkout.
 *
 * Existe para a conversão não mentir: o rastreio é recente e o histórico de
 * pedidos é bem mais antigo, então dividir TODAS as vendas pelas chegadas
 * conhecidas dá coisas como 196%. Só entram no numerador os pedidos criados a
 * partir daqui. Null = sem rastreio, e a conversão vira indisponível.
 */
async function getFunnelStart(): Promise<Date | null> {
  try {
    const [r] = await query<{ startedAt: Date | null }>(
      `SELECT MIN(createdAt) AS startedAt FROM checkout_funnel`,
    );
    return r?.startedAt ? new Date(r.startedAt) : null;
  } catch {
    return null;
  }
}

type Totals = {
  grossCents: number;
  approved: number;
  refused: number;
  /** Todos os pedidos criados na janela, em qualquer status. */
  orders: number;
  pending: number;
  /** Pix gerados e ainda não pagos: contam CONTRA a aprovação (ver taxaDeAprovacao). */
  pendingPix: number;
  arrivals: number;
  /** Aprovadas dentro da janela E depois do início do rastreio. */
  approvedTracked: number;
  tracking: boolean;
};

/** Faturamento, aprovadas, recusadas e chegadas no checkout de UMA janela. */
async function totalsFor(orderFrag: string, funnelFrag: string, funnelStart: Date | null): Promise<Totals> {
  // Mesma consulta de sempre, com duas contagens a mais (total e pendentes)
  // para o card de Pedidos: nada de ida nova ao banco.
  const [ord] = await query<{ grossCents: number; approved: number; refused: number; orders: number; pending: number; pendingPix: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents END),0) AS grossCents,
            COALESCE(SUM(status IN ('PAID','SHIPPED')),0) AS approved,
            COALESCE(SUM(status = 'CANCELLED'),0) AS refused,
            COUNT(*) AS orders,
            COALESCE(SUM(status = 'PENDING'),0) AS pending,
            COALESCE(SUM(status = 'PENDING' AND paymentMethod = 'PIX'),0) AS pendingPix
     FROM orders WHERE ${SEM_RECUSA_REPETIDA}${orderFrag}`,
  );
  let arrivals = 0;
  let approvedTracked = 0;
  if (funnelStart) {
    try {
      const [f] = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM checkout_funnel WHERE 1=1${funnelFrag}`,
      );
      arrivals = Number(f?.n ?? 0);
      const [a] = await query<{ n: number }>(
        `SELECT COALESCE(SUM(status IN ('PAID','SHIPPED')),0) AS n
         FROM orders WHERE createdAt >= ?${orderFrag}`,
        [funnelStart],
      );
      approvedTracked = Number(a?.n ?? 0);
    } catch {
      /* tabela do funil ausente: conversão fica indisponível */
    }
  }
  return {
    grossCents: Number(ord?.grossCents ?? 0),
    approved: Number(ord?.approved ?? 0),
    refused: Number(ord?.refused ?? 0),
    orders: Number(ord?.orders ?? 0),
    pending: Number(ord?.pending ?? 0),
    pendingPix: Number(ord?.pendingPix ?? 0),
    arrivals,
    approvedTracked,
    tracking: Boolean(funnelStart),
  };
}

/**
 * Recusa REPETIDA do mesmo cartão fica fora das contas.
 *
 * Cliente que aperta "Pagar" de novo com o cartão que acabou de ser recusado
 * gera um pedido por clique. Esses pedidos são agrupados (lib/card-tentativas.ts):
 * a recusa mais nova fica visível ("Recusado 3×") e as anteriores ganham
 * `cardHiddenBy`. Sem este filtro, três cliques no mesmo cartão recusado valiam
 * três recusas e derrubavam a aprovação; com ele, valem uma. Cartão DIFERENTE
 * não é agrupado, então cada um conta. Só pedido recusado é agrupado: pago e
 * pendente nunca têm `cardHiddenBy`, e nada além das recusas muda.
 */
export const SEM_RECUSA_REPETIDA = "cardHiddenBy IS NULL";

/**
 * Taxa de aprovação: a MESMA regra do painel do lojista (app/painel/page.tsx).
 *
 *   pagos ÷ (pagos + recusados + Pix gerados e não pagos)
 *
 * O Pix não pago nunca vira CANCELLED (fica pendente para a recuperação), então
 * a conta antiga, pagos ÷ (pagos + cancelados), simplesmente o ignorava e a taxa
 * saía inflada: a Sunizze aparecia com 80% aqui e 53% de Pix e 57% de cartão no
 * painel dela (24/10/2026). Cartão PENDENTE (em análise) continua fora: ainda
 * não foi decidido, e contá-lo seria lê-lo como recusa.
 */
export function taxaDeAprovacao(approved: number, refused: number, pendingPix: number): number | null {
  const base = approved + refused + pendingPix;
  return base > 0 ? (approved / base) * 100 : null;
}

function derive(t: Totals) {
  return {
    grossCents: t.grossCents,
    approved: t.approved,
    refused: t.refused,
    orders: t.orders,
    pending: t.pending,
    approvalRate: taxaDeAprovacao(t.approved, t.refused, t.pendingPix),
    avgTicketCents: t.approved > 0 ? Math.round(t.grossCents / t.approved) : 0,
    // Conversão = compraram / chegaram, ambos no período RASTREADO.
    conversion: t.tracking && t.arrivals > 0 ? (t.approvedTracked / t.arrivals) * 100 : null,
  };
}

export type Overview = ReturnType<typeof derive> & {
  prev: ReturnType<typeof derive> | null;
};

export async function getOverview(range: Range): Promise<Overview> {
  const cur = dateFrag("createdAt", range);
  const prevOrders = prevFrag("createdAt", range);
  const funnelStart = await getFunnelStart();
  const [now, prevTotals] = await Promise.all([
    totalsFor(cur, dateFrag("createdAt", range), funnelStart),
    prevOrders ? totalsFor(prevOrders, prevFrag("createdAt", range)!, funnelStart) : Promise.resolve(null),
  ]);
  return {
    ...derive(now),
    prev: prevTotals ? derive(prevTotals) : null,
  };
}

/** Faturamento e vendas por método de pagamento (só métodos com movimento). */
export type Usuarios = {
  /** Contas da plataforma (sem os admins). */
  total: number;
  /** Suspensas ou banidas. */
  bloqueados: number;
  /** Criadas no período. */
  novos: number;
  /** Criadas no período anterior de mesmo tamanho (null em "Tudo"). */
  novosAntes: number | null;
};

/** Contas de usuário: total, bloqueadas e quantas entraram no período. Uma consulta só. */
export async function getUsuarios(range: Range): Promise<Usuarios> {
  const d = dateFrag("createdAt", range);
  const p = prevFrag("createdAt", range);
  const [r] = await query<{ total: number; bloqueados: number; novos: number; novosAntes: number | null }>(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(suspended = 1 OR banned = 1), 0) AS bloqueados,
            (SELECT COUNT(*) FROM users WHERE role <> 'ADMIN'${d}) AS novos,
            ${p ? `(SELECT COUNT(*) FROM users WHERE role <> 'ADMIN'${p})` : "NULL"} AS novosAntes
       FROM users WHERE role <> 'ADMIN'`,
  );
  return {
    total: Number(r?.total ?? 0),
    bloqueados: Number(r?.bloqueados ?? 0),
    novos: Number(r?.novos ?? 0),
    novosAntes: r?.novosAntes === null || r?.novosAntes === undefined ? null : Number(r.novosAntes),
  };
}

export async function getPaymentMix(range: Range): Promise<{ method: string; gmvCents: number; orders: number }[]> {
  const d = dateFrag("createdAt", range);
  const rows = await query<{ method: string | null; gmvCents: number; orders: number }>(
    `SELECT paymentMethod AS method, COALESCE(SUM(totalCents),0) AS gmvCents, COUNT(*) AS orders
     FROM orders WHERE status IN ('PAID','SHIPPED')${d}
     GROUP BY paymentMethod ORDER BY gmvCents DESC`,
  );
  return rows
    .filter((r) => r.method && Number(r.gmvCents) > 0)
    .map((r) => ({ method: String(r.method), gmvCents: Number(r.gmvCents), orders: Number(r.orders) }));
}

export type StoreOverviewRow = {
  id: string;
  name: string;
  ownerEmail: string | null;
  suspended: number;
  gmvCents: number;
  orders: number;
  approvalRate: number | null;
  conversion: number | null;
  avgTicketCents: number;
};

/** Tabela "Principais lojas": faturamento, aprovação, conversão e ticket. */
export async function getStoresOverview(range: Range): Promise<StoreOverviewRow[]> {
  const d = dateFrag("o.createdAt", range);
  const rows = await query<any>(
    `SELECT s.id, s.name, s.suspended, u.email AS ownerEmail,
            COALESCE(SUM(CASE WHEN o.status IN ('PAID','SHIPPED') THEN o.totalCents END),0) AS gmvCents,
            COALESCE(SUM(o.status IN ('PAID','SHIPPED')),0) AS approved,
            COALESCE(SUM(o.status = 'CANCELLED'),0) AS refused,
            COALESCE(SUM(o.status = 'PENDING' AND o.paymentMethod = 'PIX'),0) AS pendingPix
     FROM stores s
     LEFT JOIN users u ON u.id = s.ownerUserId
     LEFT JOIN orders o ON o.storeId = s.id AND o.${SEM_RECUSA_REPETIDA}${d ? ` AND 1=1${d}` : ""}
     GROUP BY s.id, s.name, s.suspended, u.email
     ORDER BY gmvCents DESC, s.name ASC`,
  );

  // Chegadas no checkout por loja (para a conversão). Consultas separadas:
  // juntar no mesmo GROUP BY multiplicaria as linhas de orders pelas do funil.
  // O numerador é restrito ao período RASTREADO, senão uma loja com histórico
  // anterior ao funil passa dos 100%.
  const funnelStart = await getFunnelStart();
  const arrivals = new Map<string, number>();
  const approvedTracked = new Map<string, number>();
  if (funnelStart) {
    try {
      const [f, a] = await Promise.all([
        query<{ storeId: string; n: number }>(
          `SELECT storeId, COUNT(*) AS n FROM checkout_funnel WHERE 1=1${dateFrag("createdAt", range)} GROUP BY storeId`,
        ),
        query<{ storeId: string; n: number }>(
          `SELECT storeId, COALESCE(SUM(status IN ('PAID','SHIPPED')),0) AS n
           FROM orders WHERE createdAt >= ?${dateFrag("createdAt", range)} GROUP BY storeId`,
          [funnelStart],
        ),
      ]);
      for (const r of f) arrivals.set(r.storeId, Number(r.n));
      for (const r of a) approvedTracked.set(r.storeId, Number(r.n));
    } catch {
      /* sem funil: conversão indisponível */
    }
  }

  return rows.map((r) => {
    const approved = Number(r.approved);
    const arrived = arrivals.get(r.id) ?? 0;
    return {
      id: r.id,
      name: r.name,
      ownerEmail: r.ownerEmail,
      suspended: Number(r.suspended),
      gmvCents: Number(r.gmvCents),
      orders: approved,
      approvalRate: taxaDeAprovacao(approved, Number(r.refused), Number(r.pendingPix)),
      conversion: arrived > 0 ? ((approvedTracked.get(r.id) ?? 0) / arrived) * 100 : null,
      avgTicketCents: approved > 0 ? Math.round(Number(r.gmvCents) / approved) : 0,
    };
  });
}

export type StoreRow = {
  id: string;
  name: string;
  ownerEmail: string | null;
  ownerName: string | null;
  shopifyDomain: string | null;
  suspended: number;
  createdAt: Date;
  paidCount: number;
  gmvCents: number;
  gmvTodayCents: number;
  lastOrderAt: Date | null;
};

export async function getStoresWithStats(range: Range): Promise<StoreRow[]> {
  const d = dateFrag("o.createdAt", range);
  return query<StoreRow>(
    `SELECT s.id, s.name, s.suspended,
            u.email AS ownerEmail, u.name AS ownerName,
            ss.shopifyStoreDomain AS shopifyDomain,
            s.createdAt,
            COUNT(CASE WHEN o.status IN ('PAID','SHIPPED')${d} THEN 1 END) AS paidCount,
            COALESCE(SUM(CASE WHEN o.status IN ('PAID','SHIPPED')${d} THEN o.totalCents END),0) AS gmvCents,
            COALESCE(SUM(CASE WHEN o.status IN ('PAID','SHIPPED') AND ${BR("o.createdAt")} = ${BR_TODAY} THEN o.totalCents END),0) AS gmvTodayCents,
            MAX(CASE WHEN o.status IN ('PAID','SHIPPED') THEN o.createdAt END) AS lastOrderAt
     FROM stores s
     LEFT JOIN users u ON u.id = s.ownerUserId
     LEFT JOIN store_settings ss ON ss.storeId = s.id
     LEFT JOIN orders o ON o.storeId = s.id
     GROUP BY s.id, s.name, s.suspended, u.email, u.name, ss.shopifyStoreDomain, s.createdAt
     ORDER BY gmvCents DESC, s.createdAt DESC`,
  );
}

/** Saúde do banco: conexões abertas, limite e uptime. */
export async function getDbHealth(): Promise<{ connected: number; maxConnections: number; uptimeSeconds: number }> {
  const [conn, maxc, up] = await Promise.all([
    query<{ Value: string }>(`SHOW STATUS LIKE 'Threads_connected'`),
    query<{ Value: string }>(`SHOW VARIABLES LIKE 'max_connections'`),
    query<{ Value: string }>(`SHOW GLOBAL STATUS LIKE 'Uptime'`),
  ]);
  return {
    connected: Number(conn[0]?.Value ?? 0),
    maxConnections: Number(maxc[0]?.Value ?? 0),
    uptimeSeconds: Number(up[0]?.Value ?? 0),
  };
}

/** Faturamento por dia (últimos N dias) — para o gráfico. */
export async function getDailyRevenue(days = 30): Promise<{ day: string; gmvCents: number; orders: number }[]> {
  const win = Math.max(1, Math.min(180, days));
  const rows = await query<{ day: string; gmvCents: number; orders: number }>(
    `SELECT ${BR_STR("createdAt")} AS day, COALESCE(SUM(totalCents),0) AS gmvCents, COUNT(*) AS orders
     FROM orders
     WHERE status IN ('PAID','SHIPPED') AND createdAt >= NOW() - INTERVAL ${win} DAY
     GROUP BY day ORDER BY day ASC`,
  );
  // Preenche os dias sem venda com zero (dias no fuso do Brasil, sem buracos).
  const map = new Map(rows.map((r) => [String(r.day).slice(0, 10), { gmv: Number(r.gmvCents), n: Number(r.orders) }]));
  const brKey = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const out: { day: string; gmvCents: number; orders: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = brKey(i);
    const hit = map.get(key);
    out.push({ day: key, gmvCents: hit?.gmv ?? 0, orders: hit?.n ?? 0 });
  }
  return out;
}

export type StoreDetail = {
  id: string; name: string; suspended: number; createdAt: Date;
  ownerEmail: string | null; ownerName: string | null;
  shopifyDomain: string | null; customDomain: string | null; domainVerified: number;
  paidCount: number; gmvCents: number; pendingCount: number; productCount: number;
};

export async function getStoreDetail(storeId: string): Promise<StoreDetail | null> {
  const rows = await query<StoreDetail>(
    `SELECT s.id, s.name, s.suspended, s.createdAt,
            u.email AS ownerEmail, u.name AS ownerName,
            ss.shopifyStoreDomain AS shopifyDomain, ss.customDomain, ss.domainVerified,
            (SELECT COUNT(*) FROM orders o WHERE o.storeId = s.id AND o.status IN ('PAID','SHIPPED')) AS paidCount,
            (SELECT COALESCE(SUM(totalCents),0) FROM orders o WHERE o.storeId = s.id AND o.status IN ('PAID','SHIPPED')) AS gmvCents,
            (SELECT COUNT(*) FROM orders o WHERE o.storeId = s.id AND o.status = 'PENDING') AS pendingCount,
            (SELECT COUNT(*) FROM products p WHERE p.storeId = s.id AND p.active = 1) AS productCount
     FROM stores s
     LEFT JOIN users u ON u.id = s.ownerUserId
     LEFT JOIN store_settings ss ON ss.storeId = s.id
     WHERE s.id = ? LIMIT 1`,
    [storeId],
  );
  return rows[0] ?? null;
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "MERCHANT" | "ADMIN";
  banned: number;
  suspended: number;
  createdAt: Date;
  storeCount: number;
  gmvCents: number;
  /** Plano contratado (null = ainda não escolheu) e validade. */
  plan: string | null;
  planExpiresAt: Date | null;
};

/**
 * Contas da plataforma, com filtro opcional por e-mail ou nome (busca
 * parcial, sem diferenciar maiúsculas). O termo vai parametrizado.
 */
export async function getUsersWithStats(busca?: string): Promise<UserRow[]> {
  const termo = (busca ?? "").trim().slice(0, 120);
  // Também pelo nome da LOJA: o admin muitas vezes só sabe "a Elvora", e não o
  // e-mail de quem é dona dela. EXISTS para não cortar as outras lojas da conta
  // da contagem e do faturamento.
  const filtro = termo
    ? `WHERE (u.email LIKE ? OR u.name LIKE ? OR EXISTS(SELECT 1 FROM stores s3 WHERE s3.ownerUserId = u.id AND s3.name LIKE ?))`
    : "";
  const like = `%${termo.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  return query<UserRow>(
    `SELECT u.id, u.email, u.name, u.role, u.banned, u.suspended, u.createdAt,
            COUNT(DISTINCT s.id) AS storeCount,
            COALESCE(SUM(CASE WHEN o.status IN ('PAID','SHIPPED') THEN o.totalCents END),0) AS gmvCents,
            p.plan AS plan, p.expiresAt AS planExpiresAt
     FROM users u
     LEFT JOIN stores s ON s.ownerUserId = u.id
     LEFT JOIN orders o ON o.storeId = s.id
     LEFT JOIN account_plans p ON p.userId = u.id
     ${filtro}
     GROUP BY u.id, u.email, u.name, u.role, u.banned, u.suspended, u.createdAt, p.plan, p.expiresAt
     ORDER BY gmvCents DESC, u.createdAt ASC`,
    termo ? [like, like, like] : [],
  );
}

export type UserDetail = UserRow & {
  lastLoginAt: Date | null;
  sessions: number;
  phone: string | null;
  cpf: string | null;
  updatedAt: Date | null;
};

/** Uma conta, para a ficha do admin. */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const rows = await query<UserDetail>(
    `SELECT u.id, u.email, u.name, u.role, u.banned, u.suspended, u.createdAt, u.updatedAt, u.phone, u.cpf,
            (SELECT COUNT(*) FROM stores s WHERE s.ownerUserId = u.id) AS storeCount,
            (SELECT COALESCE(SUM(o.totalCents),0) FROM orders o
               JOIN stores s2 ON s2.id = o.storeId
              WHERE s2.ownerUserId = u.id AND o.status IN ('PAID','SHIPPED')) AS gmvCents,
            (SELECT COUNT(*) FROM sessions se WHERE se.userId = u.id AND se.expiresAt > NOW()) AS sessions,
            (SELECT MAX(se2.createdAt) FROM sessions se2 WHERE se2.userId = u.id) AS lastLoginAt
       FROM users u WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Cadastro (KYC) feito na 2ª etapa do cadastro. Null em contas anteriores a ele. */
export type KycDoUsuario = {
  documentType: string;
  document: string;
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  createdAt: Date;
};

export async function getKycDoUsuario(userId: string): Promise<KycDoUsuario | null> {
  try {
    const [r] = await query<KycDoUsuario>(
      `SELECT documentType, document, cep, street, number, complement, neighborhood, city, state, createdAt
         FROM merchant_profiles WHERE userId = ? LIMIT 1`,
      [userId],
    );
    return r ?? null;
  } catch {
    return null; // tabela ausente (migração não rodada): a ficha segue sem o bloco
  }
}

/** Último login: de onde e de qual aparelho. */
export type UltimoAcesso = {
  createdAt: Date;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
};

export async function getUltimoAcesso(userId: string): Promise<UltimoAcesso | null> {
  const [r] = await query<UltimoAcesso>(
    `SELECT createdAt, ip, city, region, country, userAgent
       FROM sessions WHERE userId = ? ORDER BY createdAt DESC LIMIT 1`,
    [userId],
  );
  return r ?? null;
}

/** Pagamentos de plano (Pix gerado, pago, vencido, concedido pelo admin). */
export type PagamentoPlano = {
  id: string;
  userId: string;
  plan: string;
  txnId: string | null;
  amountCents: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  email?: string | null;
  name?: string | null;
};

export async function getPagamentosPlano(opts: { userId?: string; limit?: number } = {}): Promise<PagamentoPlano[]> {
  const limite = Math.min(500, Math.max(1, opts.limit ?? 200));
  try {
    return await query<PagamentoPlano>(
      `SELECT c.id, c.userId, c.plan, c.txnId, c.amountCents, c.status, c.createdAt, c.paidAt, u.email, u.name
         FROM plan_charges c LEFT JOIN users u ON u.id = c.userId
        ${opts.userId ? "WHERE c.userId = ?" : ""}
        ORDER BY c.createdAt DESC
        LIMIT ${limite}`,
      opts.userId ? [opts.userId] : [],
    );
  } catch {
    return [];
  }
}

export type LojaDoUsuario = {
  id: string;
  name: string;
  createdAt: Date;
  orders: number;
  gmvCents: number;
  pctIndividual: string | number | null;
  recoveryPctIndividual: string | number | null;
  taxasPendentesCents: number;
  taxasPagasCents: number;
  customDomain: string | null;
  domainVerified: number | null;
  shopifyStoreDomain: string | null;
  produtos: number;
  /** A loja concluiu o passo a passo do Início (painel liberado). */
  configurada: number;
  suspended: number | null;
};

/** Lojas da conta, com faturamento e a situação das taxas de cada uma. */
export async function getLojasDoUsuario(userId: string): Promise<LojaDoUsuario[]> {
  return query<LojaDoUsuario>(
    `SELECT s.id, s.name, s.createdAt, s.suspended,
            ss.customDomain, ss.domainVerified, ss.shopifyStoreDomain,
            (SELECT COUNT(*) FROM products pr WHERE pr.storeId = s.id) AS produtos,
            EXISTS(SELECT 1 FROM store_onboarding so WHERE so.storeId = s.id) AS configurada,
            (SELECT COUNT(*) FROM orders o WHERE o.storeId = s.id AND o.status IN ('PAID','SHIPPED')) AS orders,
            (SELECT COALESCE(SUM(o.totalCents),0) FROM orders o
              WHERE o.storeId = s.id AND o.status IN ('PAID','SHIPPED')) AS gmvCents,
            r.pct AS pctIndividual,
            r.recoveryPct AS recoveryPctIndividual,
            (SELECT COALESCE(SUM(f.feeCents),0) FROM platform_fees f
              WHERE f.storeId = s.id AND f.status = 'PENDING') AS taxasPendentesCents,
            (SELECT COALESCE(SUM(f.feeCents),0) FROM platform_fees f
              WHERE f.storeId = s.id AND f.status = 'PAID') AS taxasPagasCents
       FROM stores s
       LEFT JOIN store_fee_rates r ON r.storeId = s.id
       LEFT JOIN store_settings ss ON ss.storeId = s.id
      WHERE s.ownerUserId = ?
      ORDER BY gmvCents DESC`,
    [userId],
  );
}

export type StoreProductCount = {
  id: string;
  name: string;
  ownerEmail: string | null;
  shopifyDomain: string | null;
  productCount: number;
  activeCount: number;
};

/** Lojas que têm produtos sincronizados (com contagem). */
export async function getStoresWithProductCount(): Promise<StoreProductCount[]> {
  return query<StoreProductCount>(
    `SELECT s.id, s.name, u.email AS ownerEmail, ss.shopifyStoreDomain AS shopifyDomain,
            COUNT(p.id) AS productCount,
            SUM(CASE WHEN p.active = 1 THEN 1 ELSE 0 END) AS activeCount
     FROM stores s
     JOIN products p ON p.storeId = s.id
     LEFT JOIN users u ON u.id = s.ownerUserId
     LEFT JOIN store_settings ss ON ss.storeId = s.id
     GROUP BY s.id, s.name, u.email, ss.shopifyStoreDomain
     ORDER BY productCount DESC`,
  );
}

export type ProductRow = { id: string; name: string; priceCents: number; active: number; imageUrl: string | null; maskedName: string | null };

/** Produtos de UMA loja (nome real + máscara de criptografia, se houver). */
export async function getStoreProducts(storeId: string, search = ""): Promise<ProductRow[]> {
  const s = (search || "").trim().slice(0, 60);
  if (s) {
    return query<ProductRow>(
      `SELECT id, name, priceCents, active, imageUrl, maskedName FROM products
       WHERE storeId = ? AND name LIKE ? ORDER BY createdAt DESC LIMIT 500`,
      [storeId, `%${s}%`],
    );
  }
  return query<ProductRow>(
    `SELECT id, name, priceCents, active, imageUrl, maskedName FROM products
     WHERE storeId = ? ORDER BY createdAt DESC LIMIT 500`,
    [storeId],
  );
}

export type ActiveSession = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: "USER" | "MERCHANT" | "ADMIN";
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
};

/** Sessões de login ATIVAS (não expiradas) — quem está logado no painel. */
export async function getActiveSessions(): Promise<ActiveSession[]> {
  try {
    return await query<ActiveSession>(
      `SELECT s.id, s.userId, u.email, u.name, u.role, s.userAgent, s.ip, s.createdAt, s.expiresAt
       FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.expiresAt > NOW(3)
       ORDER BY s.createdAt DESC
       LIMIT 500`,
    );
  } catch {
    // Coluna `ip` ainda não existe (migração pendente) — mostra sem o IP.
    const rows = await query<Omit<ActiveSession, "ip">>(
      `SELECT s.id, s.userId, u.email, u.name, u.role, s.userAgent, s.createdAt, s.expiresAt
       FROM sessions s JOIN users u ON u.id = s.userId
       WHERE s.expiresAt > NOW(3)
       ORDER BY s.createdAt DESC
       LIMIT 500`,
    );
    return rows.map((r) => ({ ...r, ip: null }));
  }
}

// ── Transações (todos os pedidos da plataforma) ──────────────────────────────

export type TxFilters = {
  range: Range;
  status?: string;
  storeId?: string;
  method?: string;
  gateway?: string;
  email?: string;
  page: number;
  pageSize: number;
};

export type TxRow = {
  id: string;
  storeId: string;
  storeName: string;
  status: string;
  totalCents: number;
  paymentMethod: string | null;
  paymentGateway: string | null;
  customerName: string | null;
  customerEmail: string | null;
  providerTxnId: string | null;
  createdAt: Date;
};

const TX_STATUS = new Set(["PENDING", "PAID", "SHIPPED", "CANCELLED"]);
const TX_METHOD = new Set(["PIX", "CREDIT_CARD", "BOLETO"]);

/** WHERE + params compartilhados pela contagem e pela listagem. */
function txWhere(f: TxFilters): { sql: string; params: unknown[] } {
  const conds: string[] = ["1=1"];
  const params: unknown[] = [];
  const d = dateFrag("o.createdAt", f.range);
  if (d) conds.push(d.replace(/^ AND /, ""));
  if (f.status && TX_STATUS.has(f.status)) {
    conds.push("o.status = ?");
    params.push(f.status);
  }
  if (f.storeId) {
    conds.push("o.storeId = ?");
    params.push(f.storeId);
  }
  if (f.method && TX_METHOD.has(f.method)) {
    conds.push("o.paymentMethod = ?");
    params.push(f.method);
  }
  if (f.gateway) {
    conds.push("o.paymentGateway = ?");
    params.push(f.gateway);
  }
  if (f.email) {
    // Curingas do LIKE escapados: "%" procura o caractere, não a base inteira.
    conds.push("o.customerEmail LIKE ? ESCAPE '!'");
    params.push(`%${f.email.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  return { sql: conds.join(" AND "), params };
}

export async function getTransactions(f: TxFilters): Promise<{ rows: TxRow[]; total: number }> {
  const { sql, params } = txWhere(f);
  const [count] = await query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM orders o WHERE ${sql}`,
    params,
  );
  const total = Number(count?.c ?? 0);
  const size = Math.max(1, Math.min(100, f.pageSize));
  const offset = Math.max(0, (f.page - 1) * size);
  const rows = await query<TxRow>(
    `SELECT o.id, o.storeId, s.name AS storeName, o.status, o.totalCents,
            o.paymentMethod, o.paymentGateway, o.customerName, o.customerEmail,
            o.providerTxnId, o.createdAt
     FROM orders o LEFT JOIN stores s ON s.id = o.storeId
     WHERE ${sql}
     ORDER BY o.createdAt DESC
     LIMIT ${size} OFFSET ${offset}`,
    params,
  );
  return { rows, total };
}

/** Gateways que já processaram algo (para o filtro). */
export async function getUsedGateways(): Promise<string[]> {
  const rows = await query<{ g: string }>(
    `SELECT DISTINCT paymentGateway AS g FROM orders WHERE paymentGateway IS NOT NULL ORDER BY g`,
  );
  return rows.map((r) => r.g).filter(Boolean);
}

// ── Detalhe de UMA transação ─────────────────────────────────────────────────

export type TxDetail = {
  order: {
    id: string;
    storeId: string;
    storeName: string | null;
    shopifyStoreDomain: string | null;
    shopifyOrderId: string | null;
    status: string;
    paymentMethod: string | null;
    paymentGateway: string | null;
    totalCents: number;
    shippingCents: number;
    discountCents: number;
    createdAt: Date;
    paidAt: Date | null;
    updatedAt: Date | null;
    customerName: string | null;
    customerEmail: string | null;
    customerDocument: string | null;
    customerPhone: string | null;
    providerTxnId: string | null;
    trackingCode: string | null;
    pixQrCode: string | null;
    pixExpiresAt: Date | null;
    separationEmailSentAt: Date | null;
    gclid: string | null;
    /** IP do comprador, quando o checkout registrou (fica em trackingParams). */
    ip: string | null;
    address: Record<string, string> | null;
  };
  items: { name: string | null; imageUrl: string | null; quantity: number; unitPriceCents: number }[];
  /** Outros pedidos do MESMO e-mail — o histórico do cliente. */
  history: { id: string; storeName: string | null; status: string; totalCents: number; createdAt: Date }[];
};

export async function getTransactionDetail(id: string): Promise<TxDetail | null> {
  const rows = await query<any>(
    `SELECT o.*, s.name AS storeName, ss.shopifyStoreDomain
     FROM orders o
     LEFT JOIN stores s ON s.id = o.storeId
     LEFT JOIN store_settings ss ON ss.storeId = o.storeId
     WHERE o.id = ? LIMIT 1`,
    [id],
  );
  const o = rows[0];
  if (!o) return null;

  // LEFT JOIN: item de produto já removido do catálogo não some do pedido.
  const items = await query<any>(
    `SELECT p.name, p.imageUrl, oi.quantity, oi.unitPriceCents
     FROM order_items oi LEFT JOIN products p ON p.id = oi.productId
     WHERE oi.orderId = ?`,
    [id],
  );

  let history: TxDetail["history"] = [];
  if (o.customerEmail) {
    history = await query<any>(
      `SELECT o2.id, s2.name AS storeName, o2.status, o2.totalCents, o2.createdAt
       FROM orders o2 LEFT JOIN stores s2 ON s2.id = o2.storeId
       WHERE o2.customerEmail = ? AND o2.id <> ?
       ORDER BY o2.createdAt DESC LIMIT 25`,
      [o.customerEmail, id],
    );
  }

  const parse = <T,>(raw: unknown): T | null => {
    if (!raw || typeof raw !== "string") return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };
  const tracking = parse<Record<string, string>>(o.trackingParams);

  return {
    order: {
      id: o.id,
      storeId: o.storeId,
      storeName: o.storeName ?? null,
      shopifyStoreDomain: o.shopifyStoreDomain ?? null,
      shopifyOrderId: o.shopifyOrderId ?? null,
      status: o.status,
      paymentMethod: o.paymentMethod ?? null,
      paymentGateway: o.paymentGateway ?? null,
      totalCents: Number(o.totalCents ?? 0),
      shippingCents: Number(o.shippingCents ?? 0),
      discountCents: Number(o.discountCents ?? 0),
      createdAt: o.createdAt,
      paidAt: o.paidAt ?? null,
      updatedAt: o.updatedAt ?? null,
      customerName: o.customerName ?? null,
      customerEmail: o.customerEmail ?? null,
      customerDocument: o.customerDocument ?? null,
      customerPhone: o.customerPhone ?? null,
      providerTxnId: o.providerTxnId ?? null,
      trackingCode: o.trackingCode ?? null,
      pixQrCode: o.pixQrCode ?? null,
      pixExpiresAt: o.pixExpiresAt ?? null,
      separationEmailSentAt: o.separationEmailSentAt ?? null,
      gclid: o.gclid ?? null,
      ip: tracking?.ip ?? null,
      address: parse<Record<string, string>>(o.customerAddress),
    },
    items: items.map((i) => ({
      name: i.name ?? null,
      imageUrl: i.imageUrl ?? null,
      quantity: Number(i.quantity ?? 0),
      unitPriceCents: Number(i.unitPriceCents ?? 0),
    })),
    history,
  };
}

// ── Clientes (compradores, agregados por e-mail) ─────────────────────────────

export type CustomerRow = {
  email: string;
  name: string | null;
  phone: string | null;
  document: string | null;
  orders: number;
  paidOrders: number;
  spentCents: number;
  stores: number;
  lastOrderAt: Date | null;
  firstOrderAt: Date | null;
};

/**
 * Compradores da plataforma. A chave é o E-MAIL: o checkout é de visitante
 * (sem conta), então é o único identificador estável entre pedidos e lojas.
 */
export async function getCustomers(opts: {
  range: Range;
  email?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: CustomerRow[]; total: number }> {
  const d = dateFrag("createdAt", opts.range);
  const conds = ["customerEmail IS NOT NULL", "customerEmail <> ''"];
  const params: unknown[] = [];
  if (d) conds.push(d.replace(/^ AND /, ""));
  if (opts.email) {
    conds.push("customerEmail LIKE ? ESCAPE '!'");
    params.push(`%${opts.email.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  const where = conds.join(" AND ");

  const [count] = await query<{ c: number }>(
    `SELECT COUNT(DISTINCT customerEmail) AS c FROM orders WHERE ${where}`,
    params,
  );
  const total = Number(count?.c ?? 0);
  const size = Math.max(1, Math.min(100, opts.pageSize));
  const offset = Math.max(0, (opts.page - 1) * size);

  const rows = await query<CustomerRow>(
    `SELECT customerEmail AS email,
            MAX(customerName) AS name,
            MAX(customerPhone) AS phone,
            MAX(customerDocument) AS document,
            COUNT(*) AS orders,
            COALESCE(SUM(status IN ('PAID','SHIPPED')),0) AS paidOrders,
            COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents END),0) AS spentCents,
            COUNT(DISTINCT storeId) AS stores,
            MAX(createdAt) AS lastOrderAt,
            MIN(createdAt) AS firstOrderAt
     FROM orders WHERE ${where}
     GROUP BY customerEmail
     ORDER BY spentCents DESC, lastOrderAt DESC
     LIMIT ${size} OFFSET ${offset}`,
    params,
  );
  return { rows, total };
}

export async function getStoreRecentOrders(storeId: string, limit = 20) {
  return query<{ id: string; status: string; totalCents: number; paymentMethod: string | null; paymentGateway: string | null; customerEmail: string | null; createdAt: Date }>(
    `SELECT id, status, totalCents, paymentMethod, paymentGateway, customerEmail, createdAt
     FROM orders WHERE storeId = ? ORDER BY createdAt DESC LIMIT ${Math.max(1, Math.min(50, Math.floor(limit) || 20))}`,
    // LIMIT vai interpolado (inteiro limitado acima), como no resto do código:
    // como parâmetro (`LIMIT ?`) o MySQL recusava o prepared statement
    // ("Incorrect arguments to mysqld_stmt_execute") e a ficha da loja dava 500.
    [storeId],
  );
}
