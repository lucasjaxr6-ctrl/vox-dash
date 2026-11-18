// Smart Routing — modelo e regras PURAS (sem banco, sem segredo), para o mesmo
// código rodar no servidor (lib/settings.ts) e no checkout do navegador.
//
// Pix e cartão têm regras SEPARADAS. Em cada método há dois modos, que podem
// ficar ligados JUNTOS:
//  - condicional: a partir de um valor, o pedido vai para outro gateway;
//  - distribuição: os pedidos são sorteados entre 2 a 4 gateways, pela %.
// Com os dois ligados, o CONDICIONAL TEM PRIORIDADE: pedido que atinge o valor
// vai para o gateway do condicional; abaixo dele, vale a distribuição.
//
// Guardado em store_settings.smartRoutingJson (TEXT). Lojas que ainda não
// salvaram nesta versão leem das colunas antigas (split* e pixHighValue*).

export type Metodo = "pix" | "cartao";
export type Fatia = { g: string; p: number };
export type RegraMetodo = {
  condicional: { ativo: boolean; minCents: number; gateway: string };
  distribuicao: { ativo: boolean; fatias: Fatia[] };
  /**
   * Só no Pix: se a cobrança não gerar, tenta nestes gateways, em ordem. No cartão não
   * existe: uma tentativa que falha por tempo pode ter cobrado, e cobrar de novo em
   * outro gateway debitaria o cliente duas vezes. No Pix, ele só paga o código que recebe.
   */
  retentativa?: { ativo: boolean; gateways: string[] };
};
export type SmartRouting = Record<Metodo, RegraMetodo>;

export const MAX_GATEWAYS = 4;
export const MAX_RETENTATIVA = 3;

export const regraVazia = (): RegraMetodo => ({
  condicional: { ativo: false, minCents: 0, gateway: "" },
  distribuicao: { ativo: false, fatias: [] },
  retentativa: { ativo: false, gateways: [] },
});

/** Gateways que as regras ligadas podem usar, além do principal. */
export function gatewaysDoRoteamento(sr: SmartRouting): string[] {
  const usados: string[] = [];
  for (const r of [sr.pix, sr.cartao]) {
    if (r.condicional.ativo && r.condicional.gateway) usados.push(r.condicional.gateway);
    if (r.distribuicao.ativo) usados.push(...r.distribuicao.fatias.map((f) => f.g));
  }
  if (sr.pix.retentativa?.ativo) usados.push(...sr.pix.retentativa.gateways);
  return [...new Set(usados.filter(Boolean))];
}

type Legado = {
  splitEnabled?: number | null;
  splitGatewayA?: string | null;
  splitGatewayB?: string | null;
  splitPercentA?: number | null;
  pixHighValueEnabled?: number | null;
  pixHighValueProvider?: string | null;
  pixHighValueMinCents?: number | null;
};

function regraValida(x: unknown): RegraMetodo {
  const r = regraVazia();
  if (!x || typeof x !== "object") return r;
  const o = x as Record<string, unknown>;
  const c = o.condicional as Record<string, unknown> | undefined;
  if (c && typeof c === "object") {
    r.condicional = {
      ativo: c.ativo === true,
      minCents: Math.max(0, Math.round(Number(c.minCents) || 0)),
      gateway: typeof c.gateway === "string" ? c.gateway : "",
    };
  }
  const d = o.distribuicao as Record<string, unknown> | undefined;
  if (d && typeof d === "object" && Array.isArray(d.fatias)) {
    r.distribuicao = {
      ativo: d.ativo === true,
      fatias: d.fatias
        .filter((f): f is Fatia => !!f && typeof (f as Fatia).g === "string")
        .slice(0, MAX_GATEWAYS)
        .map((f) => ({ g: f.g, p: Math.max(0, Math.min(100, Math.round(Number(f.p) || 0))) })),
    };
  }
  const t = o.retentativa as Record<string, unknown> | undefined;
  if (t && typeof t === "object" && Array.isArray(t.gateways)) {
    r.retentativa = {
      ativo: t.ativo === true,
      gateways: t.gateways.filter((g): g is string => typeof g === "string").slice(0, MAX_RETENTATIVA),
    };
  }
  return r;
}

/** Lê a configuração da loja: o JSON novo, ou as colunas antigas. */
export function lerSmartRouting(json: string | null | undefined, legado: Legado): SmartRouting {
  if (json) {
    try {
      const o = JSON.parse(json) as Record<string, unknown>;
      return { pix: regraValida(o.pix), cartao: regraValida(o.cartao) };
    } catch {
      /* JSON quebrado: cai no legado em vez de derrubar o checkout */
    }
  }
  const splitOn = (legado.splitEnabled ?? 0) === 1 && !!legado.splitGatewayA && !!legado.splitGatewayB;
  const pctA = Math.max(0, Math.min(100, legado.splitPercentA ?? 50));
  const fatias: Fatia[] = splitOn ? [{ g: legado.splitGatewayA!, p: pctA }, { g: legado.splitGatewayB!, p: 100 - pctA }] : [];
  return {
    // O legado já funcionava assim: ticket alto (só Pix) antes do split.
    pix: {
      condicional: {
        ativo: (legado.pixHighValueEnabled ?? 0) === 1,
        minCents: legado.pixHighValueMinCents ?? 0,
        gateway: legado.pixHighValueProvider ?? "",
      },
      distribuicao: { ativo: splitOn, fatias },
    },
    cartao: { condicional: { ativo: false, minCents: 0, gateway: "" }, distribuicao: { ativo: splitOn, fatias } },
  };
}

/** Erro de configuração para mostrar ao lojista, ou null se está tudo certo. */
export function validarRegra(r: RegraMetodo, nomeMetodo: string): string | null {
  if (r.condicional.ativo) {
    if (r.condicional.minCents <= 0) return `${nomeMetodo}: informe o valor a partir do qual o gateway muda.`;
    if (!r.condicional.gateway) return `${nomeMetodo}: escolha o gateway do roteamento condicional.`;
  }
  if (r.distribuicao.ativo) {
    const d = r.distribuicao.fatias;
    if (d.length < 2) return `${nomeMetodo}: a distribuição precisa de pelo menos 2 gateways.`;
    if (d.length > MAX_GATEWAYS) return `${nomeMetodo}: no máximo ${MAX_GATEWAYS} gateways.`;
    if (d.some((f) => !f.g)) return `${nomeMetodo}: escolha todos os gateways da distribuição.`;
    if (new Set(d.map((f) => f.g)).size !== d.length) return `${nomeMetodo}: o mesmo gateway aparece duas vezes.`;
    if (d.some((f) => f.p <= 0)) return `${nomeMetodo}: cada gateway precisa de pelo menos 1%.`;
    const soma = d.reduce((s, f) => s + f.p, 0);
    if (soma !== 100) return `${nomeMetodo}: as porcentagens somam ${soma}%, precisam somar 100%.`;
  }
  if (r.retentativa?.ativo) {
    const g = r.retentativa.gateways;
    if (!g.length || g.some((x) => !x)) return `${nomeMetodo}: escolha o gateway da retentativa.`;
    if (g.length > MAX_RETENTATIVA) return `${nomeMetodo}: no máximo ${MAX_RETENTATIVA} gateways na retentativa.`;
    if (new Set(g).size !== g.length) return `${nomeMetodo}: o mesmo gateway aparece duas vezes na retentativa.`;
  }
  return null;
}

/**
 * Sorteio ponderado. `sorteio` em [0, 1). Usa a soma real das fatias, então
 * continua certo quando alguma fatia é removida (gateway sem credencial).
 */
export function sortearFatia(fatias: Fatia[], sorteio: number): string | null {
  const total = fatias.reduce((s, f) => s + Math.max(0, f.p), 0);
  if (!fatias.length || total <= 0) return fatias[0]?.g ?? null;
  let alvo = sorteio * total;
  for (const f of fatias) {
    alvo -= Math.max(0, f.p);
    if (alvo < 0) return f.g;
  }
  return fatias[fatias.length - 1].g;
}

/**
 * Como o CHECKOUT escolhe o gateway do cartão (a tokenização acontece no
 * navegador, com o SDK do gateway escolhido). O servidor confere a escolha.
 *  - `condicional`: a partir do valor, este gateway (tem prioridade);
 *  - `fatias`: sorteio entre 2+ gateways;
 *  - `base`: o gateway quando nenhuma das duas decide.
 */
export type RotaCartao = {
  condicional?: { minCents: number; gateway: string };
  fatias?: Fatia[];
  base: string | null;
};

export function gatewaysDaRota(r: RotaCartao | undefined | null): string[] {
  if (!r) return [];
  const todos = [...(r.fatias ?? []).map((f) => f.g), r.condicional?.gateway, r.base];
  return [...new Set(todos.filter((g): g is string => !!g))];
}

export function escolherGatewayCartao(r: RotaCartao, amountCents: number, sorteio = Math.random()): string {
  if (r.condicional && amountCents >= r.condicional.minCents) return r.condicional.gateway;
  if (r.fatias && r.fatias.length) return sortearFatia(r.fatias, sorteio) ?? r.fatias[0].g;
  return r.base ?? "";
}
