// Faixa de datas das telas do painel (Dashboard, Dispositivos...).
//
// Fica num lib só de propósito: quando cada página resolve o próprio "7 dias",
// mais cedo ou mais tarde duas telas passam a discordar do mesmo período e o
// lojista não sabe em qual acreditar.

export const PERIODS: { key: string; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "all", label: "Tudo" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" de hoje no fuso de São Paulo (UTC-3, sem horário de verão desde 2019). */
export function ymdTodaySP(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Meia-noite (SP) de um dia "YYYY-MM-DD". */
export function spMidnight(ymd: string): Date {
  return new Date(`${ymd}T00:00:00-03:00`);
}

/**
 * Resolve a faixa: atalho (period) OU intervalo personalizado (from/to).
 * `since` = limite inferior (>=), `until` = limite superior (<).
 */
export function resolveRange(
  period: string | undefined,
  from?: string,
  to?: string,
): { key: string; since: Date | null; until: Date | null } {
  const okFrom = !!from && DATE_RE.test(from);
  const okTo = !!to && DATE_RE.test(to);
  if (okFrom || okTo) {
    const since = okFrom ? spMidnight(from!) : null;
    // `until` é a meia-noite do dia SEGUINTE ao "to" (fim do dia, exclusivo).
    const until = okTo ? new Date(spMidnight(to!).getTime() + 86400000) : null;
    return { key: "custom", since, until };
  }
  // Sem período na URL (ou um que não existe mais, como o antigo "90d"), abre em Hoje.
  const key = PERIODS.some((p) => p.key === period) ? period! : "today";
  const now = Date.now();
  switch (key) {
    case "today": return { key, since: spMidnight(ymdTodaySP()), until: null };
    case "yesterday": {
      const today = spMidnight(ymdTodaySP());
      return { key, since: new Date(today.getTime() - 86400000), until: today };
    }
    case "7d": return { key, since: new Date(now - 7 * 86400000), until: null };
    case "30d": return { key, since: new Date(now - 30 * 86400000), until: null };
    default: return { key: "all", since: null, until: null };
  }
}

/** O período escrito por extenso ("Últimos 30 dias", "De 01/09/2026 a 15/09/2026"). */
export function rangeLabel(key: string, from?: string, to?: string): string {
  const br = (ymd?: string) => (ymd && DATE_RE.test(ymd) ? ymd.split("-").reverse().join("/") : "");
  switch (key) {
    case "today": return "Hoje";
    case "yesterday": return "Ontem";
    case "7d": return "Últimos 7 dias";
    case "30d": return "Últimos 30 dias";
    case "all": return "Todo o período";
  }
  const f = br(from);
  const t = br(to);
  if (f && t) return f === t ? `Em ${f}` : `De ${f} a ${t}`;
  if (f) return `Desde ${f}`;
  if (t) return `Até ${t}`;
  return "Período personalizado";
}

/** Cláusula SQL de faixa para uma coluna de data (+ params na ordem). */
export function rangeClause(col: string, since: Date | null, until: Date | null): { sql: string; params: Date[] } {
  const parts: string[] = [];
  const params: Date[] = [];
  if (since) { parts.push(`${col} >= ?`); params.push(since); }
  if (until) { parts.push(`${col} < ?`); params.push(until); }
  return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
}
