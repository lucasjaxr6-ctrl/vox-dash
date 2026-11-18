// Rotas da configuração inicial da loja. SEM "server-only": a mesma regra roda
// no layout (servidor, carga completa da página) e no guarda client (navegação
// pelo menu, que não refaz o layout). Duas cópias da regra divergiriam.

export const INICIO = "/painel/inicio";

/**
 * Sempre abertas, mesmo com a configuração pendente: o Início, o Plano e as
 * integrações recomendadas do Início (Shopify, Utmify, Pixels).
 */
// /painel/configuracoes é só a grade de atalhos: abrir não libera nada (cada
// cartão leva a uma tela que segue a regra dela).
export const ROTAS_LIVRES = [INICIO, "/painel/plano", "/painel/shopify", "/painel/apps/utmify", "/painel/pixels", "/painel/configuracoes"];

/** O que o guarda precisa saber de cada etapa. `rota/*` = a rota e as filhas. */
export type EtapaRota = { id: string; feito: boolean; rotas: string[]; titulo?: string };

function casa(path: string, rota: string): boolean {
  return rota.endsWith("/*") ? path.startsWith(rota.slice(0, -1)) : path === rota;
}

export function etapaDaRota<T extends EtapaRota>(path: string, etapas: T[]): T | null {
  return etapas.find((e) => e.rotas.some((r) => casa(path, r))) ?? null;
}

/**
 * Com a configuração pendente, só abrem o Início, o Plano e as telas das
 * etapas AINDA NÃO feitas — etapa concluída não tem mais o que fazer ali.
 */
export function rotaPermitida(path: string, etapas: EtapaRota[]): boolean {
  if (ROTAS_LIVRES.includes(path)) return true;
  const e = etapaDaRota(path, etapas);
  return !!e && !e.feito;
}

/** Telas que ganham a seta de voltar. */
const ROTAS_DE_CONFIGURACAO = [
  "/painel/shopify",
  "/painel/produtos",
  "/painel/dominio",
  "/painel/pagamentos",
  "/painel/pagamentos/*",
  "/painel/emails",
  "/painel/plano",
  "/painel/apps/utmify",
  "/painel/pixels",
];

export function ehRotaDeConfiguracao(path: string): boolean {
  return ROTAS_DE_CONFIGURACAO.some((r) => casa(path, r));
}
