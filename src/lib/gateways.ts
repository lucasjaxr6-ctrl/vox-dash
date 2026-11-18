// Catálogo dos gateways de pagamento (usado na grade e na página de cada um).
// Sem imports de servidor — pode ser usado em client components.

export type GatewayKey = "appmax" | "freepay" | "hypercash" | "fintpag" | "hylexpay" | "beehive" | "pagniv" | "vext" | "blackcat" | "pagarme" | "veopag" | "mangofy" | "nuvra" | "bluevision" | "pixgo" | "mushpag" | "pagou" | "pushinpay" | "wappi" | "mercadopago" | "pinpay";

export type GatewayMeta = {
  key: GatewayKey;
  name: string;
  desc: string;
  /** Reserva quando a logo não carrega: inicial sobre `bg`. */
  letter: string;
  bg: string;
  /** Arquivo em /public/gateways. Reduzido para 192px no maior lado. */
  logo: string;
  /** Descrição curta do que ele processa, exibida na página do gateway. */
  subtitle: string;
};

export const GATEWAYS: GatewayMeta[] = [
  {
    key: "appmax",
    name: "Appmax",
    desc: "Integre sua loja a Appmax",
    letter: "A",
    bg: "bg-gradient-to-br from-indigo-500 to-blue-500",
    logo: "/gateways/appmax.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "freepay",
    name: "Freepay",
    desc: "Integre sua loja a Freepay",
    letter: "F",
    bg: "bg-gradient-to-br from-orange-500 to-rose-500",
    logo: "/gateways/freepay.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "hypercash",
    name: "HyperCash",
    desc: "Integre sua loja a HyperCash",
    letter: "H",
    bg: "bg-gradient-to-br from-fuchsia-500 to-pink-500",
    logo: "/gateways/hypercash.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "fintpag",
    name: "FintPag",
    desc: "Integre sua loja a FintPag",
    letter: "FP",
    bg: "bg-gradient-to-br from-cyan-500 to-blue-600",
    logo: "/gateways/fintpag.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "hylexpay",
    name: "HylexPay",
    desc: "Integre sua loja a HylexPay",
    letter: "HX",
    bg: "bg-gradient-to-br from-indigo-500 to-violet-600",
    logo: "/gateways/hylexpay.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "beehive",
    name: "Beehive",
    desc: "Integre sua loja a Beehive",
    letter: "B",
    bg: "bg-gradient-to-br from-amber-400 to-yellow-600",
    logo: "/gateways/beehive.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "pagniv",
    name: "PagNiv",
    desc: "Integre sua loja a PagNiv",
    letter: "PN",
    bg: "bg-gradient-to-br from-emerald-500 to-teal-600",
    logo: "/gateways/pagniv.svg",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "vext",
    name: "Vext",
    desc: "Integre sua loja a Vext",
    letter: "V",
    bg: "bg-gradient-to-br from-slate-600 to-slate-900",
    logo: "/gateways/vext.webp",
    subtitle: "Gateway de Pix.",
  },
  {
    key: "blackcat",
    name: "BlackCat",
    desc: "Integre sua loja a BlackCat",
    letter: "BC",
    bg: "bg-gradient-to-br from-neutral-800 to-black",
    logo: "/gateways/blackcat.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "pagarme",
    name: "Pagar.me",
    desc: "Integre sua loja a Pagar.me",
    letter: "PM",
    bg: "bg-gradient-to-br from-lime-500 to-green-600",
    logo: "/gateways/pagarme.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "veopag",
    name: "VeoPag",
    desc: "Integre sua loja a VeoPag",
    letter: "VP",
    bg: "bg-gradient-to-br from-blue-600 to-indigo-700",
    logo: "/gateways/veopag.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "mangofy",
    name: "MangoFy",
    desc: "Integre sua loja a MangoFy",
    letter: "MF",
    bg: "bg-gradient-to-br from-orange-400 to-orange-600",
    logo: "/gateways/mangofy.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "nuvra",
    name: "Nuvra",
    desc: "Integre sua loja a Nuvra",
    letter: "NV",
    bg: "bg-gradient-to-br from-violet-500 to-indigo-600",
    logo: "/gateways/nuvra.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "bluevision",
    name: "Blue Vision",
    desc: "Integre sua loja a Blue Vision",
    letter: "BV",
    bg: "bg-gradient-to-br from-blue-600 to-indigo-700",
    logo: "/gateways/bluevision.png",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "pagou",
    name: "Pagou.ai",
    desc: "Integre sua loja a Pagou.ai",
    letter: "PA",
    bg: "bg-gradient-to-br from-violet-500 to-fuchsia-600",
    logo: "/gateways/pagou.webp",
    subtitle: "Gateway de Pix.",
  },
  {
    key: "pushinpay",
    name: "PushinPay",
    desc: "Integre sua loja a PushinPay",
    letter: "PP",
    bg: "bg-gradient-to-br from-emerald-500 to-green-600",
    logo: "/gateways/pushinpay.webp",
    subtitle: "Gateway de Pix.",
  },
  {
    key: "pixgo",
    name: "PixGo",
    desc: "Integre sua loja a PixGo",
    letter: "PG",
    bg: "bg-gradient-to-br from-teal-500 to-emerald-600",
    logo: "/gateways/pixgo.webp",
    subtitle: "Gateway de Pix.",
  },
  {
    key: "mushpag",
    name: "MushPag",
    desc: "Integre sua loja a MushPag",
    letter: "MU",
    bg: "bg-gradient-to-br from-pink-500 to-rose-600",
    logo: "/gateways/mushpag.png",
    subtitle: "Gateway de Pix.",
  },
  {
    key: "wappi",
    name: "Wappi",
    desc: "Integre sua loja a Wappi",
    letter: "W",
    bg: "bg-gradient-to-br from-blue-500 to-blue-700",
    logo: "/gateways/wappi.webp",
    subtitle: "Pix e cartão transparentes: o cliente paga sem sair do checkout.",
  },
  {
    key: "mercadopago",
    name: "Mercado Pago",
    desc: "Integre sua loja a Mercado Pago",
    letter: "MP",
    bg: "bg-gradient-to-br from-sky-500 to-cyan-500",
    logo: "/gateways/mercadopago.webp",
    subtitle: "Pix e cartão de crédito (tokenização no navegador).",
  },
  {
    key: "pinpay",
    name: "PinPay",
    desc: "Integre sua loja a PinPay",
    letter: "P",
    bg: "bg-gradient-to-br from-violet-500 to-purple-500",
    logo: "/gateways/pinpay.webp",
    subtitle: "Gateway de Pix.",
  },
];

/**
 * Gateways que cobram CARTÃO — os que têm tabela de juros própria no painel.
 * Mesma lista do `cardInstallmentFeesGateway` em lib/validation.ts.
 */
export const GATEWAYS_COM_CARTAO: GatewayKey[] = [
  "appmax", "freepay", "hypercash", "fintpag", "hylexpay", "beehive", "pagniv",
  "blackcat", "pagarme", "veopag", "mangofy", "nuvra", "bluevision", "pagou", "wappi", "mercadopago",
];

export function getGateway(key: string): GatewayMeta | null {
  return GATEWAYS.find((g) => g.key === key) ?? null;
}
