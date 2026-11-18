// Datas que chegam dos gateways brasileiros SEM fuso.
//
// A Appmax documenta `pix_expiration_date` como "Y-m-d H:i:s, timezone de São
// Paulo". Gravávamos a string crua, e `new Date("2026-09-24 20:40:25")` no
// servidor (UTC, na Vercel) lê aquilo como 20:40 UTC — três horas antes do que
// a Appmax quis dizer. Somada à validade de 30 minutos, a conta dava −150: o
// Pix nascia vencido. Medido em 306 de 307 cobranças.
//
// Não era cosmético: a regra que reaproveita um Pix em aberto exige
// `pixExpiresAt > NOW()`, então ela nunca valeu para a Appmax e o mesmo cliente
// gerava cobranças repetidas.
//
// Módulo PURO — dá para testar sem banco nem rede.

/** Brasil não tem mais horário de verão desde 2019: Brasília é UTC−03:00 fixo. */
const BRASILIA = "-03:00";

/** A string já diz em que fuso está? (Z, +03:00, -0300 …) */
const TEM_FUSO = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** "2026-09-24 20:40:25" ou "2026-09-24T20:40" — data local, sem fuso. */
const DATA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Carimba o fuso de Brasília numa data local vinda do gateway.
 *
 * - Já tem fuso  -> devolve intacta (não desloca o que já está certo).
 * - Data local   -> vira ISO com −03:00.
 * - Outro formato-> devolve intacta. Palpite aqui erraria em silêncio, e o
 *   chamador já trata data ilegível descartando o campo.
 */
export function comoHorarioDeBrasilia(valor: string | null | undefined): string | null {
  const s = (valor ?? "").trim();
  if (!s) return null;
  if (TEM_FUSO.test(s)) return s;
  const m = s.match(DATA_LOCAL);
  if (!m) return s;
  const [, ano, mes, dia, hora, min, seg = "00"] = m;
  return `${ano}-${mes}-${dia}T${hora}:${min}:${seg}${BRASILIA}`;
}
