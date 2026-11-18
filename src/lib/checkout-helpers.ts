import type { RotaCartao } from "./smart-routing";
// Helpers puros do checkout (formulário Charm, páginas do Pix e do pedido).
// Máscaras são apenas UX — a validação REAL é no servidor (Zod).

export function maskCPF(v: string) {
  return v.replace(/\D/g, "").slice(0, 11).replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}
/**
 * CPF válido de verdade (dígitos verificadores), não só 11 dígitos.
 *
 * O checkout conferia só o tamanho, e um CPF digitado errado passava até o
 * gateway, que recusava o CARTÃO com "documento inválido" — para o cliente,
 * parecia cartão negado. Mesma regra de isValidCPF (lib/validation.ts), que o
 * servidor aplica de novo; repetida aqui para não levar o zod ao navegador.
 */
export function cpfValido(v: string) {
  const s = v.replace(/\D/g, "");
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  const dv = (n: number) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += Number(s[i]) * (n + 1 - i);
    const r = (t * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(s[9]) && dv(10) === Number(s[10]);
}
export function maskPhone(v: string) {
  let d = v.replace(/\D/g, "");
  // O campo já assume +55. Se a pessoa digitar o 55 do país de novo, o número
  // fica com mais de 11 dígitos (BR tem no máx. 11) e o final seria cortado —
  // então removemos o "55" redigitado e mantemos só o telefone dela.
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3").trim();
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3").trim();
}
// ── Sugestão de provedor de e-mail ───────────────────────────────────────────
//
// Quando o cliente digita o "@", oferecemos os provedores mais usados no Brasil.
// Não é enfeite: e-mail errado é pedido sem confirmação, sem código de rastreio
// e cliente no suporte. "@gmail.con" e "@hotmai.com" são erros clássicos.
//
// A ordem é por frequência real de uso no e-commerce brasileiro — o primeiro da
// lista é o que mais aparece, para o toque certo ficar logo no topo.
export const EMAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "yahoo.com.br",
  "icloud.com",
  "bol.com.br",
  "uol.com.br",
  "live.com",
  "terra.com.br",
  "globo.com",
  "yahoo.com",
  "me.com",
] as const;

/**
 * Sugestões de e-mail completo a partir do que já foi digitado.
 * Devolve lista VAZIA quando não há o que sugerir — nada antes do "@", mais de
 * um "@", domínio já completo ou nenhum provedor compatível.
 */
export function emailSuggestions(value: string, limit = 5): string[] {
  const v = (value || "").trim();
  const at = v.indexOf("@");
  if (at <= 0) return []; // sem "@", ou "@" logo no começo (sem nome)
  if (v.indexOf("@", at + 1) !== -1) return []; // dois "@" não é e-mail
  const local = v.slice(0, at);
  const typed = v.slice(at + 1).toLowerCase();
  // `d !== typed` descarta o domínio JÁ digitado por inteiro. Sem isso,
  // "maria@yahoo.com" sugeria "maria@yahoo.com" junto de "maria@yahoo.com.br" —
  // ou seja, oferecia de volta exatamente o que a pessoa acabou de escrever.
  const matches = EMAIL_DOMAINS.filter((d) => d.startsWith(typed) && d !== typed);
  return matches.slice(0, limit).map((d) => `${local}@${d}`);
}

export function maskCEP(v: string) {
  return v.replace(/\D/g, "").slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
}
export function maskCardNumber(v: string) {
  return v.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}
export function maskExpiry(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}
export function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export function fmtTime(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Faz o parse do expires_at do gateway de forma robusta em TODOS os navegadores.
// O iOS/Safari é rígido: rejeita frações de segundo com >3 dígitos (formato .NET
// da Freepay, ex.: "2026-08-05T16:09:16.1012807") e datas com espaço no lugar do
// 'T'. Sem isso, no celular o contador estourava (ex.: "2879:00"). Retorna epoch
// em ms, ou NaN se não conseguir.
export function parsePixExpiry(s: string | null | undefined): number {
  const raw = (s || "").trim();
  if (!raw) return NaN;
  const norm = raw.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  let t = Date.parse(norm);
  if (isNaN(t)) t = Date.parse(raw);
  return t;
}

export type AppliedCoupon = { code: string; type: "PERCENT" | "FIXED"; value: number };
export function computeCoupon(type: "PERCENT" | "FIXED", value: number, sub: number): number {
  if (sub <= 0) return 0;
  if (type === "PERCENT") return Math.min(sub, Math.round((sub * Math.min(100, Math.max(0, value))) / 100));
  return Math.min(sub, Math.max(0, value));
}

// Cor de destaque para seleção (radios / bordas ativas).
export const SELECT = "#2563eb";
export const CARD_DISCOUNT = 0.05;
export const PIX_DISCOUNT = 0.05;
// Desconto extra oferecido quando o cartão "fica indisponível" e o cliente é
// direcionado ao Pix.
export const PIX_BOOST_DISCOUNT = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// JUROS DE PARCELAMENTO NO CARTÃO (repasse ao cliente).
// As parcelas com juros são repassadas via GROSS-UP EXATO: o total cobrado é
// calculado para que, depois da taxa da adquirente, o lojista receba exatamente
// o valor líquido (produto + frete). 1x = sem juros (preço cheio).
//   total = (base + FIXO) / (1 - taxa)
// Fonte da tabela: taxas da plataforma de cartão (Freepay). Usada IDÊNTICA no
// cliente (exibição) e no servidor (cobrança) — a regra de ouro recalcula lá.
// ─────────────────────────────────────────────────────────────────────────────
// Taxas PADRÃO (usadas quando o gateway não tem tabela própria). A tabela é
// definida POR GATEWAY, na página de cada um no painel (1x a 12x + fixo). Um
// gateway sem tabela própria usa a tabela antiga da loja, se houver, e senão
// esta. 1x com taxa 0 = preço cheio; com taxa > 0 entra no mesmo gross-up.
export const CARD_INSTALLMENT_FEE: Record<number, number> = {
  1: 0,
  2: 0.1138, 3: 0.1299, 4: 0.1326, 5: 0.1599, 6: 0.1619,
  7: 0.1898, 8: 0.2056, 9: 0.2499, 10: 0.2699, 11: 0.2899, 12: 0.3189,
};
export const CARD_FIXED_FEE_CENTS = 299; // R$ 2,99 fixo por transação parcelada

export type InstallmentFees = { rates: Record<number, number>; fixedCents: number };

/** Config padrão de parcelamento (fallback quando a loja não configurou). */
export function defaultInstallmentFees(): InstallmentFees {
  return { rates: { ...CARD_INSTALLMENT_FEE }, fixedCents: CARD_FIXED_FEE_CENTS };
}

/**
 * Tabela de juros do gateway que vai cobrar o cartão: a própria dele, se o
 * lojista configurou, senão a geral da loja (`installmentFees`).
 */
export function feesDoGateway(cfg: CheckoutPayment | null | undefined, gateway: string | null | undefined): InstallmentFees | undefined {
  return (gateway ? cfg?.installmentFeesByGateway?.[gateway] : undefined) ?? cfg?.installmentFees;
}

/**
 * Total (em centavos) a cobrar no cartão para netar `baseCents` em N parcelas.
 * Recebe a tabela do GATEWAY que vai cobrar (rates + fixo); sem ela, usa o
 * padrão. A MESMA função roda no cliente (exibição) e no servidor (cobrança) —
 * regra de ouro.
 */
export function cardChargeCents(baseCents: number, installments: number, fees?: InstallmentFees): number {
  const n = Math.max(1, Math.min(12, Math.round(installments) || 1));
  const rates = fees?.rates ?? CARD_INSTALLMENT_FEE;
  const fixedCents = fees?.fixedCents ?? CARD_FIXED_FEE_CENTS;
  const rate = rates[n] ?? 0;
  if (rate <= 0 || rate >= 1) return Math.round(baseCents); // 1x/sem taxa: preço cheio
  return Math.round((baseCents + fixedCents) / (1 - rate));
}

export type CheckoutReview = { id: string; name: string; stars: number; text: string; photoUrl: string | null };
export type CheckoutBump = { id: string; productId: string; title: string; description: string | null; priceCents: number; imageUrl: string | null };
export type CheckoutPayment = { pixEnabled: boolean; cardEnabled: boolean; mpPublicKey: string; hypercashPublicKey?: string; fintpagPublicKey?: string; hylexpayPublicKey?: string; beehivePublicKey?: string; pagouPublicKey?: string; pagouSandbox?: boolean; cardProvider?: "mercadopago" | "appmax" | "freepay" | "hypercash" | "fintpag" | "hylexpay" | "beehive" | "pagniv" | "blackcat" | "pagarme" | "veopag" | "mangofy" | "nuvra" | "bluevision" | "pagou" | "wappi" | null; /** Smart Routing do cartão: o navegador escolhe o gateway (pela % ou pelo valor). */ cardRoute?: RotaCartao; /** Tabela geral da loja (fallback). */ installmentFees?: InstallmentFees; /** Tabelas próprias de cada gateway de cartão — têm prioridade sobre a geral. */ installmentFeesByGateway?: Record<string, InstallmentFees> };
export type CheckoutItem = { id: string; name: string; priceCents: number; imageUrl: string | null; quantity: number };
export type CheckoutPrefill = {
  name?: string; email?: string; cpf?: string; phone?: string;
  address?: { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
};
export type PixResult = { orderId: string; qrCode: string; qrCodeUrl: string | null; expiresAt: string | null; amountCents: number };

// Fallback (preview do editor / sem produto no banco): mantém o checkout renderizável.
export const DEMO_ITEMS: CheckoutItem[] = [{ id: "demo-product", name: "Produto", priceCents: 1000, imageUrl: null, quantity: 1 }];

// ── Passo do funil do checkout ──
//
// Vale o PREENCHIMENTO, não a tela aberta. Antes, os dois templates começavam
// reportando 1, então quem só abria o checkout e ia embora já era contado em
// "Dados pessoais" — inflando a etapa e escondendo o abandono logo na entrada.
//
//   0 = chegou no checkout   só abriu, não digitou nada
//   1 = dados pessoais       digitou algo em nome/e-mail/CPF/telefone
//   2 = endereço             informou ao menos o CEP completo
//   3 = pagamento            chegou na etapa (aqui não se exige preenchimento)
//   4 = comprou              gerou o Pix / enviou o cartão
export function checkoutFunnelStep(input: {
  contact: { name?: string; email?: string; cpf?: string; phone?: string };
  cep?: string;
  /** Cliente já está na etapa de pagamento. */
  atPayment: boolean;
  /** Já gerou a cobrança (Pix/cartão). */
  purchased?: boolean;
}): number {
  if (input.purchased) return 4;
  if (input.atPayment) return 3;
  if ((input.cep || "").replace(/\D/g, "").length >= 8) return 2;
  const c = input.contact;
  const digitou = [c.name, c.email, c.cpf, c.phone].some((v) => (v || "").trim().length > 0);
  return digitou ? 1 : 0;
}

// ── Captura de carrinho abandonado (lead) ──
// sid estável por aba (mesmo id usado no "beat" de presença ao vivo).
export function getCheckoutSid(): string {
  try {
    let sid = sessionStorage.getItem("vox_sid") || "";
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem("vox_sid", sid);
    }
    return sid;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/**
 * Avisa o servidor que o cliente SAIU do checkout.
 *
 * A batida de presença só diz que ele está aqui; a ausência dela é um silêncio,
 * e silêncio precisa de cronômetro para virar conclusão. Este aviso é o evento
 * de saída em si — fechou a aba, voltou para a loja, trocou de app —, e é o que
 * permite marcar o abandono na hora em vez de esperar 15 minutos.
 *
 * `sendBeacon` é o único envio que o navegador garante durante o descarregamento
 * da página; `fetch`/`Image` costumam ser cancelados no meio. O Image fica como
 * reserva para quem não tem sendBeacon.
 */
export function avisarSaidaDoCheckout(sid: string): void {
  const url = `/api/live/beat?sid=${encodeURIComponent(sid)}&scope=checkout&exit=1&t=${Date.now()}`;
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(url);
      return;
    }
  } catch {
    /* cai no reserva */
  }
  try {
    new Image().src = url;
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rascunho do checkout: guarda o que o cliente já digitou para ele não perder
// tudo ao voltar (ex.: cartão recusado → "Revisar dados").
//
// ⚠️ NUNCA guarda dados de cartão (número, CVV, validade, titular). Isso é
// proibido por PCI-DSS e não entra aqui em hipótese alguma. Só contato, endereço
// e escolhas do pedido.
//
// sessionStorage (não localStorage): morre ao fechar a aba, então os dados do
// cliente não ficam no dispositivo depois que ele sai.
// ─────────────────────────────────────────────────────────────────────────────

const DRAFT_KEY = "vox_checkout_draft";

export type CheckoutDraft = {
  form?: { name?: string; email?: string; cpf?: string; phone?: string };
  addr?: Record<string, string | undefined>;
  shippingOptionId?: string;
  coupon?: string;
  installments?: number;
};

export function saveCheckoutDraft(d: CheckoutDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* aba anônima/sem storage: segue sem rascunho */
  }
}

export function loadCheckoutDraft(): CheckoutDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as CheckoutDraft) : null;
  } catch {
    return null;
  }
}

/**
 * Devolve só os campos do rascunho cujo destino está VAZIO. Assim o prefill de
 * um link de recuperação nunca é sobrescrito pelo rascunho.
 */
export function pickEmpty<T extends Record<string, string>>(
  current: T,
  draft: Record<string, string | undefined>,
): Partial<T> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (!v) continue;
    const cur = current[k as keyof T];
    if (typeof cur === "string" && cur.trim() === "") out[k] = v;
  }
  return out as Partial<T>;
}

/** Limpa o rascunho — chamado quando a compra conclui. */
export function clearCheckoutDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

// Captura o Google Click ID (para atribuição de conversão no Google Ads):
// da URL (?gclid / ?gbraid / ?wbraid) ou do cookie de 1ª parte _gcl_aw
// (formato "GCL.<timestamp>.<gclid>"). É gravado no pedido para o envio da
// conversão (server-side) após o pagamento.
export function getGclid(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const direct = params.get("gclid") || params.get("gbraid") || params.get("wbraid");
    if (direct) return direct.slice(0, 512);
    const m = document.cookie.match(/(?:^|;\s*)_gcl_aw=([^;]+)/);
    if (m) {
      const parts = decodeURIComponent(m[1]).split(".");
      const g = parts[parts.length - 1];
      if (g && g.length > 6) return g.slice(0, 512);
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Captura os parâmetros de rastreio (UTMs) da URL ou do cookie de 1ª parte, para
// atribuição de venda na Utmify. Persistimos num cookie porque a compra pode
// acontecer em outra aba/sessão depois do clique no anúncio.
export type Tracking = {
  utm_source?: string; utm_medium?: string; utm_campaign?: string;
  utm_content?: string; utm_term?: string; src?: string; sck?: string;
};

const TRACK_COOKIE = "vox_utm";
const TRACK_KEYS: (keyof Tracking)[] = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "src", "sck"];

export function getTracking(): Tracking {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl: Tracking = {};
    for (const k of TRACK_KEYS) {
      const v = params.get(k);
      if (v) fromUrl[k] = v.slice(0, 255);
    }
    // Se veio UTM na URL, grava no cookie (dura 30 dias) e usa.
    if (Object.keys(fromUrl).length) {
      try {
        document.cookie = `${TRACK_COOKIE}=${encodeURIComponent(JSON.stringify(fromUrl))};path=/;max-age=${30 * 24 * 3600};samesite=lax`;
      } catch { /* ignore */ }
      return fromUrl;
    }
    // Senão, tenta recuperar do cookie salvo num clique anterior.
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${TRACK_COOKIE}=([^;]+)`));
    if (m) return JSON.parse(decodeURIComponent(m[1])) as Tracking;
  } catch {
    /* ignore */
  }
  return {};
}

// Poll do status do cartão "em análise": re-checa a cada ~3s (até ~1min). É a
// "verificação alguns segundos depois" — o navegador do cliente confirma o
// pagamento mesmo se o webhook do gateway atrasar/não chegar.
export async function pollCardStatus(
  orderId: string,
  opts?: { intervalMs?: number; maxTries?: number },
): Promise<"approved" | "rejected" | "pending"> {
  // Janela ~5 min com BACKOFF: 3s no 1º minuto (pega aprovação rápida na hora) e
  // 6s depois (cobre aprovações lentas da Appmax sem martelar a API). Se o chamador
  // passar intervalMs, usa fixo (ex.: desafio 3DS). 20×3s + 40×6s ≈ 5 min.
  const fixedInterval = opts?.intervalMs;
  const maxTries = opts?.maxTries ?? 60;
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, fixedInterval ?? (i < 20 ? 3000 : 6000)));
    try {
      const res = await fetch(`/api/checkout/card/status?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (data?.status === "PAID") return "approved";
      if (data?.status === "CANCELLED") return "rejected";
    } catch {
      /* mantém tentando */
    }
  }
  return "pending";
}

export type LeadPayload = {
  sessionId: string;
  name?: string;
  email?: string;
  cpf?: string;
  phone?: string;
  step?: number;
  address?: Record<string, string | undefined>;
  items?: { productId: string; quantity: number }[];
};

// Envia o lead ao servidor (best-effort). keepalive garante o envio mesmo se a
// aba estiver fechando.
export function postLead(data: LeadPayload): void {
  try {
    fetch("/api/checkout/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

// ── Pixels de marketing: disparo da conversão (compra paga) ──
export type ActivePixel = {
  type: "meta" | "google" | "ga4" | "tiktok" | "taboola" | "kwai" | "pinterest";
  pixelId: string;
  conversionLabel?: string;
  paidOnly?: boolean;
  /**
   * A compra também sai do servidor. Google Analytics: só de lá, o navegador pula.
   * Meta: dos dois, e ela descarta a repetição pelo id do pedido.
   */
  compraNoServidor?: boolean;
};

type ItemGa4 = { id: string; name: string; priceCents: number; quantity: number };

/** Itens no formato do Google Analytics: é deles que saem os relatórios de produto. */
export function itensGa4(itens: ItemGa4[]) {
  return itens.map((i) => ({ item_id: i.id, item_name: i.name, price: i.priceCents / 100, quantity: i.quantity }));
}

/**
 * Evento do funil no Google Analytics (begin_checkout, add_shipping_info,
 * add_payment_info). Espera o gtag como o firePurchase: o primeiro evento sai de
 * um efeito do React, que pode rodar antes do script `afterInteractive`. Com
 * vários IDs, vai para cada um pelo send_to. Best-effort, nunca derruba o checkout.
 */
export function eventoGa4(pixels: ActivePixel[] | undefined, nome: string, params: Record<string, unknown>): void {
  const ids = (pixels ?? []).filter((p) => p.type === "ga4" && p.pixelId).map((p) => p.pixelId);
  if (ids.length === 0) return;
  const w = window as unknown as JanelaPixels;
  let tentativas = 0;
  const enviar = () => {
    if (typeof w.gtag !== "function") {
      if (tentativas++ < 20) setTimeout(enviar, 200);
      return;
    }
    try {
      for (const id of ids) w.gtag("event", nome, { ...params, send_to: id });
    } catch {
      /* pixels não podem derrubar o checkout */
    }
  };
  enviar();
}

// Quem é este visitante no Google Analytics, para a compra enviada pelo servidor
// cair na mesma visita, com a origem da campanha (ver lib/ga4-compra).
const visitaGa4: Record<string, string> = {};

/** Pede ao gtag o client_id e o session_id. Só nas lojas com a compra no servidor. */
export function capturarVisitaGa4(pixels: ActivePixel[] | undefined): void {
  const ids = (pixels ?? []).filter((p) => p.type === "ga4" && p.pixelId && p.compraNoServidor).map((p) => p.pixelId);
  if (ids.length === 0) return;
  const w = window as unknown as JanelaPixels;
  let tentativas = 0;
  const pedir = () => {
    if (typeof w.gtag !== "function") {
      if (tentativas++ < 20) setTimeout(pedir, 200);
      return;
    }
    try {
      for (const id of ids) {
        w.gtag("get", id, "client_id", (v: unknown) => {
          if (v) visitaGa4.ga_cid = String(v);
        });
        w.gtag("get", id, "session_id", (v: unknown) => {
          if (v) visitaGa4[`ga_sid_${id}`] = String(v);
        });
      }
    } catch {
      /* pixels não podem derrubar o checkout */
    }
  };
  pedir();
}

/** O que vai junto com o pedido. Vazio: bloqueador de anúncio ou loja sem a chave. */
export function visitaGa4DoPedido(): Record<string, string> | undefined {
  return Object.keys(visitaGa4).length ? { ...visitaGa4 } : undefined;
}

/**
 * Cookies do pixel e navegador, para a compra enviada à Meta pelo servidor (ver
 * lib/meta-compra). Lidos na hora do pedido: o `_fbp` pode ainda não existir ao abrir
 * o checkout. Sem o cookie `_fbc`, monta pelo `fbclid` da URL, no formato da Meta.
 */
export function visitaMetaDoPedido(pixels: ActivePixel[] | undefined): { ua: string; fbp?: string; fbc?: string } | undefined {
  if (!(pixels ?? []).some((p) => p.type === "meta" && p.pixelId && p.compraNoServidor)) return undefined;
  try {
    const cookie = (nome: string) => document.cookie.match(new RegExp(`(?:^|;\\s*)${nome}=([^;]+)`))?.[1];
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    const fbp = cookie("_fbp");
    const fbc = cookie("_fbc") ?? (fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined);
    return {
      ua: navigator.userAgent.slice(0, 255),
      ...(fbp ? { fbp } : {}),
      // Cortar um clique longo o tornaria inválido: melhor ir sem ele.
      ...(fbc && fbc.length <= 255 ? { fbc } : {}),
    };
  } catch {
    return undefined;
  }
}

// Dispara o evento de compra nos pixels já inicializados pelo PixelScripts.
// Meta: fbq('track','Purchase'). Google Ads (AW- + label): gtag('event','conversion').
// Google Analytics: gtag('event','purchase') com itens e frete, a não ser que a
// loja tenha a chave: aí quem envia é o servidor (lib/ga4-compra). TikTok:
// ttq.instance(id).track('CompletePayment') — o evento de compra padrão deles.
// Kwai: kwaiq.instance(id).track('EVENT_PURCHASE'). Pinterest: pintrk('track',
// 'checkout'). Taboola: _tfa.push({ name: 'make_purchase' }). Best-effort —
// nunca derruba o checkout.
export function firePurchase(
  pixels: ActivePixel[] | undefined,
  data: { value: number; currency?: string; transactionId?: string; items?: ItemGa4[]; shippingCents?: number },
): void {
  if (!pixels || pixels.length === 0) return;
  const currency = data.currency || "BRL";
  const txn = data.transactionId;
  const key = txn ? `vox_purchase_${txn}` : null;

  // DEDUPE: a mesma compra nunca conta duas vezes, mesmo se o cliente recarregar
  // a página de sucesso, voltar pelo histórico ou reabrir o link de retorno.
  // Sem isso, um F5 na tela de "pagamento aprovado" gerava outra conversão.
  if (key) {
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      /* storage indisponível (aba anônima): segue o disparo */
    }
  }

  const w = window as unknown as JanelaPixels;

  // ESPERA os scripts dos pixels. Na página de obrigado, este disparo roda no
  // primeiro efeito do React, que pode vir ANTES dos scripts `afterInteractive`
  // criarem fbq/gtag/ttq. Antes, a compra era marcada como enviada mesmo sem
  // nenhum pixel pronto — e a conversão se perdia. Agora: tenta por ~4 s e só
  // marca como enviada quando de fato disparou. (A Taboola não entra na espera:
  // `_tfa` é uma fila que o script deles processa quando carregar.)
  const precisa = new Set(pixels.filter((p) => p.pixelId).map((p) => p.type));
  const pronto = () =>
    (!precisa.has("meta") || typeof w.fbq === "function") &&
    (!precisa.has("google") || typeof w.gtag === "function") &&
    (!precisa.has("ga4") || typeof w.gtag === "function") &&
    (!precisa.has("tiktok") || typeof w.ttq?.instance === "function") &&
    (!precisa.has("kwai") || typeof w.kwaiq?.instance === "function") &&
    (!precisa.has("pinterest") || typeof w.pintrk === "function");
  let tentativas = 0;
  const disparar = () => {
    if (!pronto() && tentativas++ < 20) {
      setTimeout(disparar, 200);
      return;
    }
    if (key) {
      try {
        if (localStorage.getItem(key)) return; // outra aba/efeito já enviou
        localStorage.setItem(key, "1");
      } catch {
        /* sem storage: dispara mesmo assim */
      }
    }
    enviarCompra(w, pixels, { value: data.value, currency, txn, transactionId: data.transactionId, items: data.items, shippingCents: data.shippingCents });
  };
  disparar();
}

type JanelaPixels = {
  fbq?: (...a: unknown[]) => void;
  gtag?: (...a: unknown[]) => void;
  ttq?: { instance?: (id: string) => { track?: (...a: unknown[]) => void } };
  kwaiq?: { instance?: (id: string) => { track?: (...a: unknown[]) => void } };
  pintrk?: (...a: unknown[]) => void;
  /** Tags do Pinterest já carregadas nesta página (ver PixelScripts). */
  __voxPin?: Record<string, number>;
  _tfa?: unknown[];
};

function enviarCompra(
  w: JanelaPixels,
  pixels: ActivePixel[],
  data: { value: number; currency: string; txn?: string; transactionId?: string; items?: ItemGa4[]; shippingCents?: number },
): void {
  const { currency, txn } = data;
  try {
    if (typeof w.fbq === "function") {
      // trackSingle: dispara no pixel certo (com vários pixels, `track` dispara
      // em todos). eventID permite a dedupe com a Conversions API.
      for (const p of pixels) {
        if (p.type !== "meta" || !p.pixelId) continue;
        w.fbq("trackSingle", p.pixelId, "Purchase", { value: data.value, currency }, txn ? { eventID: txn } : undefined);
      }
    }
    if (typeof w.gtag === "function") {
      for (const p of pixels) {
        if (p.type === "ga4" && p.pixelId) {
          if (p.compraNoServidor) continue;
          w.gtag("event", "purchase", {
            send_to: p.pixelId,
            transaction_id: data.transactionId,
            value: data.value,
            currency,
            ...(data.shippingCents !== undefined ? { shipping: data.shippingCents / 100 } : {}),
            ...(data.items?.length ? { items: itensGa4(data.items) } : {}),
          });
          continue;
        }
        if (p.type !== "google" || !p.pixelId) continue;
        if (p.conversionLabel) {
          w.gtag("event", "conversion", {
            send_to: `${p.pixelId}/${p.conversionLabel}`,
            value: data.value,
            currency,
            transaction_id: data.transactionId,
          });
        } else {
          w.gtag("event", "purchase", {
            send_to: p.pixelId,
            value: data.value,
            currency,
            transaction_id: data.transactionId,
          });
        }
      }
    }
    if (typeof w.ttq?.instance === "function") {
      // instance(id): dispara no pixel certo — com vários pixels do TikTok,
      // `ttq.track` dispararia em todos. event_id deduplica com a Events API.
      for (const p of pixels) {
        if (p.type !== "tiktok" || !p.pixelId) continue;
        w.ttq.instance(p.pixelId)?.track?.(
          "CompletePayment",
          { value: data.value, currency, content_type: "product" },
          txn ? { event_id: txn } : undefined,
        );
      }
    }
    if (typeof w.kwaiq?.instance === "function") {
      // instance(id): só no pixel certo, como no TikTok.
      for (const p of pixels) {
        if (p.type !== "kwai" || !p.pixelId) continue;
        w.kwaiq.instance(p.pixelId)?.track?.("EVENT_PURCHASE", { value: data.value, currency, content_type: "product" });
      }
    }
    const pins = pixels.filter((p) => p.type === "pinterest" && p.pixelId);
    if (pins.length && typeof w.pintrk === "function") {
      // O Pinterest não dispara por tag: o `track` vai para todas as carregadas.
      // A tag "só vendas pagas" não é carregada na página do checkout (para não
      // receber o pagevisit), então entra aqui, antes da compra.
      w.__voxPin = w.__voxPin || {};
      for (const p of pins) {
        if (!w.__voxPin[p.pixelId]) {
          w.pintrk("load", p.pixelId);
          w.__voxPin[p.pixelId] = 1;
        }
      }
      // `checkout` é o evento de compra no vocabulário do Pinterest.
      w.pintrk("track", "checkout", {
        value: data.value,
        currency,
        order_quantity: 1,
        ...(data.transactionId ? { order_id: data.transactionId, event_id: data.transactionId } : {}),
      });
    }
    const taboola = pixels.filter((p) => p.type === "taboola" && /^\d+$/.test(p.pixelId));
    if (taboola.length) {
      // Fila: se o tfa.js ainda não carregou, ele processa ao chegar.
      w._tfa = w._tfa || [];
      for (const p of taboola) {
        w._tfa.push({
          notify: "event",
          name: "make_purchase",
          id: Number(p.pixelId),
          revenue: data.value,
          currency,
          ...(data.transactionId ? { orderid: data.transactionId } : {}),
        });
      }
    }
  } catch {
    /* pixels não podem derrubar o checkout */
  }
}

export const DEFAULT_REVIEWS: CheckoutReview[] = [
  { id: "d1", name: "Cliente Satisfeita", stars: 5, text: "Atendimento excelente e compra rápida. Gostei muito do resultado!", photoUrl: null },
  { id: "d2", name: "Cliente Verificada", stars: 4, text: "Produto chegou no prazo e a experiência foi incrível.", photoUrl: null },
];
