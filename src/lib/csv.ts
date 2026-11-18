// ─────────────────────────────────────────────────────────────────────────────
// CSV para o Excel em português.
//
// Três decisões, todas por causa de como o Excel pt-BR abre arquivo:
//   • `;` como separador — a vírgula já é o separador decimal aqui;
//   • BOM no início — sem ele o Excel lê como ANSI e os acentos quebram;
//   • valores em "1234,56" — ponto decimal viraria texto ou milhar.
//
// E uma de SEGURANÇA, que vale mais que as três: INJEÇÃO DE FÓRMULA.
// Nome, e-mail e endereço vêm do checkout público — qualquer um digita o que
// quiser. Um "nome" como `=HYPERLINK("http://golpe","Clique")` vira link
// clicável quando o lojista abre a planilha; variantes com `=cmd|...` já
// executaram comando em Excel antigo. Por isso toda célula que começa com
// caractere de fórmula ganha um apóstrofo na frente, e o Excel a trata como
// texto. (Recomendação da OWASP para exportação de CSV.)
// ─────────────────────────────────────────────────────────────────────────────

/** Caracteres que fazem o Excel/Sheets interpretar a célula como fórmula. */
const INICIO_DE_FORMULA = /^[=+\-@\t\r]/;

/** Uma célula: neutraliza fórmula, escapa aspas e envolve em aspas. */
export function celula(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (INICIO_DE_FORMULA.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Arquivo inteiro: cabeçalho + linhas, com BOM e quebra CRLF. */
export function montarCsv(cabecalho: string[], linhas: unknown[][]): string {
  const texto = [cabecalho.map(celula).join(";"), ...linhas.map((l) => l.map(celula).join(";"))];
  return "﻿" + texto.join("\r\n");
}

/** Centavos -> "1234,56", no formato que o Excel pt-BR soma sozinho. */
export function dinheiro(cents: unknown): string {
  return (Number(cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

/** Data -> "29/09/2026 14:32", no fuso do negócio (não no do servidor). */
export function dataHoraBr(d: Date | string | null | undefined): string {
  if (!d) return "";
  const data = new Date(d);
  if (!Number.isFinite(data.getTime())) return "";
  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Resposta de download, sem cache — é dado de cliente. */
export function respostaCsv(conteudo: string, nomeArquivo: string): Response {
  return new Response(conteudo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
