// Catálogo de apps/integrações exibido em /painel/apps. Agrupado por categoria.
// Apenas o que existe de fato é clicável (href); o resto fica como "Em breve"
// para não prometer o que ainda não está pronto.

export type AppItem = {
  key: string;
  name: string;
  desc: string;
  /** Logo oficial em /public/apps. */
  logo: string;
  /** Página de configuração, se o app existe. Sem href = "Em breve". */
  href?: string;
  /** Chave usada para checar "Ativo" no servidor (ex.: "shopify"). */
  statusKey?: "shopify" | "utmify";
};

export type AppCategory = { title: string; apps: AppItem[] };

export const APP_CATEGORIES: AppCategory[] = [
  {
    title: "Plataformas",
    apps: [
      { key: "shopify", name: "Shopify", desc: "Plataforma global de e-commerce", logo: "/apps/shopify.webp", href: "/painel/shopify", statusKey: "shopify" },
    ],
  },
  {
    title: "Tracking",
    apps: [
      { key: "utmify", name: "Utmify", desc: "Rastreamento de UTMs e vendas", logo: "/apps/utmify.png", href: "/painel/apps/utmify", statusKey: "utmify" },
    ],
  },
];
