// Tipo do tema do checkout + padrões + merge. SEM "server-only": é usado por
// componentes client (editor e checkout) E pelo server component do checkout.

export const SHIPPING_CARRIERS = ["correios", "sedex", "full", "transportadora", "expresso"] as const;

/**
 * Transportadora da opção de frete — define QUAL ícone aparece.
 *
 * `""` significa NENHUM ícone. Os templates já desenham o ícone sob
 * `{carrier && ...}`, então a string vazia simplesmente não renderiza nada.
 */
export type ShippingCarrier = (typeof SHIPPING_CARRIERS)[number] | "";

/** O valor é uma transportadora conhecida ou o vazio (sem ícone)? */
export function isShippingCarrier(v: unknown): v is ShippingCarrier {
  return v === "" || (SHIPPING_CARRIERS as readonly string[]).includes(v as string);
}

export type ShippingOption = {
  id: string;
  enabled: boolean;
  name: string;
  eta: string; // prazo (ex.: "5 a 7 dias")
  priceCents: number; // 0 = grátis
  carrier: ShippingCarrier;
};

// Um modelo só: o Charm (em etapas). Zedy, Luna, Charm Único ("charmgen"),
// Charm Único Turbo ("charmturbo") e Fluxo ("fluxo") foram removidos em
// 07/10/2026. Temas salvos com qualquer um deles caem no Charm em mergeTheme —
// nada no banco precisou mudar.
export const CHECKOUT_TEMPLATES = ["charm"] as const;
export type CheckoutTemplate = (typeof CHECKOUT_TEMPLATES)[number];

export type Theme = {
  template: CheckoutTemplate;
  announcementBar: { enabled: boolean; text: string; bg: string; color: string };
  /**
   * `tagline`: assinatura curta sob o logo. Hoje aparece nos e-mails.
   * `logoPosition`: logo à esquerda ou no meio da tela, nas telas da loja.
   */
  header: { showLogo: boolean; logoUrl: string; bg: string; logoHeight: number; tagline: string; logoPosition: "left" | "center" };
  banner: { enabled: boolean; imageUrl: string };
  scarcity: { enabled: boolean; text: string; bg: string; color: string };
  /** Chamada + cronômetro regressivo do topo. */
  urgency: { enabled: boolean; headline: string; timerEnabled: boolean; minutes: number; bg: string; color: string };
  /** Barra de etapas (1 · 2 · 3), por tipo de tela. */
  stepBar: { mobile: boolean; desktop: boolean };
  steps: {
    identificationTitle: string;
    identificationSubtitle: string;
    ctaText: string;
  };
  /**
   * Arredondamento das bordas, 0 (cantos retos) a 100 (o arredondado original
   * do Charm).
   */
  corners: { roundness: number };
  /**
   * `startOpen`: o resumo já vem aberto quando o cliente chega ao checkout.
   * Desligado, ele começa recolhido (a barra mostra só o total).
   */
  summary: { title: string; startOpen: boolean };
  seo: { title: string; faviconUrl: string };
  shipping: { options: ShippingOption[] };
  /**
   * `primary` pinta botões E destaques (preço no Pix, checkbox do order bump,
   * passos, overlay de saída). `button` e `topBar` existem para soltar duas
   * peças dessa amarração sem obrigar a loja a escolher tudo de novo:
   *
   * - `button`: só o botão de compra. VAZIO = segue `primary`.
   * - `topBar`: a barra no topo (o filete abaixo do cabeçalho). VAZIA = o
   *   padrão do Charm, que era fixo no código.
   * - `secureBadge`: o "Pagamento seguro" (selo do cabeçalho e do rodapé,
   *   linha abaixo do botão de pagar e selo da página do Pix). VAZIO = os
   *   cinzas de sempre.
   *
   * O vazio como "herda" é de propósito: toda loja já publicada continua
   * idêntica até alguém escolher uma cor.
   */
  colors: { primary: string; buttonText: string; background: string; button: string; topBar: string; secureBadge: string };
  /**
   * Dados da empresa no rodapé (Personalizar → Rodapé e extras). Todos
   * opcionais: só aparece o que a loja preencher, e vazios não deixam rastro
   * na tela. O CDC pede razão social, CNPJ, endereço e contato em loja
   * virtual, e mostrar isso no checkout passa confiança.
   */
  footer: {
    text: string;
    showSecureBadge: boolean;
    companyName: string;
    cnpj: string;
    address: string;
    phone: string;
    email: string;
  };
  typography: { fontFamily: string };
  // `pix` foi REMOVIDO: os dois textos existiam só no editor e nenhuma tela de
  // checkout os lia. Oito lojas tinham valores salvos que nunca apareceram para
  // ninguém — configuração morta confunde mais do que ajuda.
  storefront: { enabled: boolean; title: string };
};

export const FONTS = ["Inter", "Roboto", "Poppins", "Montserrat", "Rubik", "system-ui"];

export const defaultTheme: Theme = {
  template: "charm",
  announcementBar: {
    enabled: false,
    text: "Frete grátis acima de R$ 199",
    bg: "#111827",
    color: "#ffffff",
  },
  header: { showLogo: false, logoUrl: "", bg: "#ffffff", logoHeight: 40, tagline: "", logoPosition: "left" },
  banner: { enabled: false, imageUrl: "" },
  scarcity: {
    enabled: false,
    text: "Oferta por tempo limitado!",
    bg: "#FEF3C7",
    color: "#92400E",
  },
  urgency: {
    enabled: true,
    headline: "Frete grátis para todo o Brasil",
    timerEnabled: true,
    minutes: 15,
    bg: "#FEE2E2",
    color: "#B91C1C",
  },
  // Mantém o comportamento atual: aparece no celular (onde o cliente vê uma
  // etapa por vez) e fica oculta no computador (onde a tela inteira é visível).
  stepBar: { mobile: true, desktop: false },
  steps: {
    identificationTitle: "Identificação",
    identificationSubtitle: "Preencha seus dados para envio do pedido.",
    ctaText: "Ir Para Entrega",
  },
  // 100 = como o Charm sempre foi. Mudar o padrão mexeria no visual de TODA
  // loja já publicada sem ninguém ter pedido.
  corners: { roundness: 100 },
  // Aberto por padrão. Quem preferir fechado desliga no editor.
  summary: { title: "Resumo do pedido", startOpen: true },
  seo: { title: "", faviconUrl: "" },
  shipping: {
    options: [
      { id: "1", enabled: true, name: "Frete Grátis", eta: "5 a 7 dias", priceCents: 0, carrier: "correios" },
      { id: "2", enabled: true, name: "Entrega Sedex", eta: "2 a 3 dias", priceCents: 1472, carrier: "sedex" },
      { id: "3", enabled: true, name: "Chegará Amanhã", eta: "Entrega garantida", priceCents: 2173, carrier: "full" },
      { id: "4", enabled: true, name: "Transportadora", eta: "5 a 12 dias úteis", priceCents: 0, carrier: "transportadora" },
      { id: "5", enabled: true, name: "Frete Expresso", eta: "5 a 10 dias úteis", priceCents: 1490, carrier: "expresso" },
    ],
  },
  colors: { primary: "#F15A22", buttonText: "#ffffff", background: "#ffffff", button: "", topBar: "", secureBadge: "" },
  footer: {
    text: "Checkout — Todos os direitos reservados",
    showSecureBadge: true,
    companyName: "",
    cnpj: "",
    address: "",
    phone: "",
    email: "",
  },
  typography: { fontFamily: "Inter" },
  storefront: { enabled: false, title: "Nossa loja" },
};

/** Mescla o cabeçalho e garante logoHeight num intervalo seguro (20–200px). */
function mergeHeader(h: any): Theme["header"] {
  const merged = { ...defaultTheme.header, ...(h || {}) };
  const n = Number(merged.logoHeight);
  merged.logoHeight = Number.isFinite(n) ? Math.min(200, Math.max(20, Math.round(n))) : defaultTheme.header.logoHeight;
  merged.tagline = String(merged.tagline ?? "").slice(0, 60);
  merged.logoPosition = merged.logoPosition === "center" ? "center" : "left";
  return merged;
}

/** Sanitiza a lista de fretes salva; se ausente/ inválida, usa os padrões. */
function mergeShipping(s: any): { options: ShippingOption[] } {
  const arr = s && Array.isArray(s.options) ? s.options : null;
  if (!arr) return { options: defaultTheme.shipping.options };
  const options: ShippingOption[] = arr.slice(0, 6).map((o: any, i: number) => ({
    id: String(o?.id ?? i + 1),
    enabled: o?.enabled !== false,
    name: String(o?.name ?? "Frete").slice(0, 60),
    eta: String(o?.eta ?? "").slice(0, 60),
    priceCents: Math.max(0, Math.round(Number(o?.priceCents) || 0)),
    // Aceita "" (sem ícone). Lixo desconhecido cai nos Correios, que era o
    // comportamento antigo — trocar isso por "" faria sumir o ícone de quem
    // nunca pediu.
    carrier: isShippingCarrier(o?.carrier) ? o.carrier : "correios",
  }));
  return { options: options.length ? options : defaultTheme.shipping.options };
}

/** Cronômetro: prende os minutos entre 1 e 120 (0 ou lixo cairia em contagem morta). */
function mergeUrgency(u: any): Theme["urgency"] {
  const merged = { ...defaultTheme.urgency, ...(u || {}) };
  const n = Number(merged.minutes);
  merged.minutes = Number.isFinite(n) ? Math.min(120, Math.max(1, Math.round(n))) : defaultTheme.urgency.minutes;
  merged.headline = String(merged.headline ?? "").slice(0, 120);
  return merged;
}

/** Arredondamento: prende entre 0 e 100 (lixo ou ausente volta ao padrão). */
function mergeCorners(c: any): Theme["corners"] {
  const n = Number(c?.roundness);
  return { roundness: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : defaultTheme.corners.roundness };
}

/**
 * Cor que a barra do topo tinha ANTES de virar configurável, como estava
 * escrita no JSX. Serve de padrão quando o lojista não escolheu. No Charm é o
 * filete de 3px abaixo do cabeçalho (era `bg-gray-900`).
 */
const BARRA_TOPO_PADRAO: Record<CheckoutTemplate, string> = {
  charm: "#111827",
};

/** Cor do botão de compra. Vazio = segue a cor principal. */
export function corDoBotao(theme: Theme): string {
  return theme.colors.button?.trim() || theme.colors.primary;
}

/** O que a barra do topo mostra quando o lojista não escolheu cor. */
export function corPadraoDaBarraTopo(template: CheckoutTemplate): string {
  return BARRA_TOPO_PADRAO[template] || "#f3f4f6";
}

/** Cor da barra no topo do checkout. Vazia = o padrão do Charm. */
export function corDaBarraTopo(theme: Theme): string {
  return theme.colors.topBar?.trim() || corPadraoDaBarraTopo(theme.template);
}

/**
 * Cor do "Pagamento seguro" quando a loja não escolheu: o cinza do cadeado
 * (gray-500), em TUDO (ícone, "PAGAMENTO" e "100% SEGURO"). Até 27/10/2026
 * eram três cinzas diferentes, e o selo parecia ter duas cores.
 */
export const COR_PADRAO_SELO_SEGURO = "#6b7280";

/** Cor escolhida para o "Pagamento seguro", ou null para manter os cinzas. */
export function corDoSeloSeguro(theme: Theme): string | null {
  return theme.colors.secureBadge?.trim() || null;
}

/** Mescla um tema parcial/antigo com os padrões (campos faltantes recebem default). */
export function mergeTheme(t: any): Theme {
  if (!t || typeof t !== "object") return defaultTheme;
  return {
    // Modelo removido (zedy, luna, charmgen, charmturbo, fluxo) cai no Charm.
    template: CHECKOUT_TEMPLATES.includes(t.template) ? t.template : defaultTheme.template,
    announcementBar: { ...defaultTheme.announcementBar, ...(t.announcementBar || {}) },
    header: mergeHeader(t.header),
    banner: { ...defaultTheme.banner, ...(t.banner || {}) },
    scarcity: { ...defaultTheme.scarcity, ...(t.scarcity || {}) },
    urgency: mergeUrgency(t.urgency),
    stepBar: {
      mobile: t.stepBar?.mobile !== false,
      desktop: t.stepBar?.desktop === true,
    },
    steps: { ...defaultTheme.steps, ...(t.steps || {}) },
    corners: mergeCorners(t.corners),
    // `showCoupon` some aqui de propósito: o spread do tema salvo traria a
    // chave antiga de volta, e ela não existe mais no tipo.
    summary: { title: t.summary?.title ?? defaultTheme.summary.title, startOpen: t.summary?.startOpen !== false },
    seo: { ...defaultTheme.seo, ...(t.seo || {}) },
    shipping: mergeShipping(t.shipping),
    colors: { ...defaultTheme.colors, ...(t.colors || {}) },
    footer: { ...defaultTheme.footer, ...(t.footer || {}) },
    typography: { ...defaultTheme.typography, ...(t.typography || {}) },
    storefront: { ...defaultTheme.storefront, ...(t.storefront || {}) },
  };
}
