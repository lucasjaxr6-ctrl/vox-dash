import React from "react";

// Menu do painel: seções, itens e ícones. Mora fora do Sidebar para a
// demonstração do painel na landing (components/landing/PainelDemo.tsx) mostrar
// o MESMO menu, sem uma cópia que envelheça quando um item mudar aqui.

export type Child = { label: string; href: string };
export type NavItem =
  // `relacionadas`: outras rotas em que este item também aparece como ativo
  // (o botão Configurações fica aceso dentro de Plano, Domínio etc.).
  | { label: string; href: string; icon: React.ReactNode; relacionadas?: string[] }
  | { label: string; icon: React.ReactNode; children: Child[] };
// `solto`: a seção não tem título nem abre/fecha; os itens ficam direto no menu.
export type Section = { title: string; items: NavItem[]; solto?: boolean };

/**
 * Opções de Configurações. Desde 24/10/2026 não ficam mais listadas na sidebar:
 * o menu tem um botão "Configurações" que abre /painel/configuracoes, uma grade
 * com um cartão por opção. As rotas de cada uma não mudaram.
 */
export const configuracoes: { label: string; href: string; icon: React.ReactNode; descricao: string }[] = [
  {
    label: "Plano",
    href: "/painel/plano",
    icon: <IconCrown />,
    descricao: "Veja seu plano, a taxa cobrada por venda e troque ou renove a assinatura.",
  },
  {
    label: "Domínio",
    href: "/painel/dominio",
    icon: <IconGlobe />,
    descricao: "Use um domínio próprio no checkout, como checkout.sualoja.com, e verifique o DNS.",
  },
  {
    label: "Dispositivos conectados",
    href: "/painel/seguranca",
    icon: <IconShield />,
    descricao: "Veja onde sua conta está conectada e encerre os acessos que não reconhecer.",
  },
  {
    label: "Criptografia",
    href: "/painel/criptografia",
    icon: <IconLock />,
    descricao: "Mascare o nome dos produtos enviado ao gateway. O nome real continua no painel e na Shopify.",
  },
];

// Mesmas rotas de sempre — apenas reagrupadas por contexto de uso. Nenhum link
// foi criado, renomeado ou removido.
export const sections: Section[] = [
  {
    title: "Principal",
    items: [
      // Início: passo a passo da loja e o plano. É para onde a conta vai
      // depois de escolher o plano.
      { label: "Início", href: "/painel/inicio", icon: <IconHome /> },
      { label: "Dashboard", href: "/painel", icon: <IconGauge /> },
      // Taxas fica logo abaixo do Dashboard: é dinheiro que o lojista deve, e
      // esconder isso num submenu seria cobrar sem deixar claro onde conferir.
      { label: "Taxas", href: "/painel/taxas", icon: <IconPercent /> },
      // "Dispositivos" saiu daqui: virou um cartão no Dashboard, ao lado de
      // Pendentes. A tela cheia continua em /painel/dispositivos, alcançada
      // pelo cartão — uma comparação de duas linhas não justificava uma aba.
    ],
  },
  {
    title: "Loja",
    items: [
      { label: "Vendas", href: "/painel/vendas", icon: <IconOrders /> },
      { label: "Carrinhos abandonados", href: "/painel/carrinhos", icon: <IconCartX /> },
      { label: "Produtos", href: "/painel/produtos", icon: <IconBox /> },
      { label: "Desempenho", href: "/painel/desempenho", icon: <IconRanking /> },
    ],
  },
  {
    title: "Checkout & vendas",
    items: [
      { label: "Personalizar", href: "/painel/personalizar", icon: <IconCheckout /> },
      { label: "Provas sociais", href: "/painel/provas-sociais", icon: <IconStar /> },
      // "Redirecionamento" saiu em 30/10/2026 (pedido do dono). Era só uma
      // tela "em breve", sem função; a página foi apagada junto.
      { label: "Order bump", href: "/painel/order-bump", icon: <IconPlusBox /> },
      { label: "Pagamentos", href: "/painel/pagamentos", icon: <IconCard /> },
    ],
  },
  {
    title: "Marketing",
    items: [
      { label: "Cupons", href: "/painel/cupons", icon: <IconTag /> },
      { label: "Pixels", href: "/painel/pixels", icon: <IconMega /> },
      {
        label: "E-mails",
        icon: <IconMail />,
        children: [
          { label: "Caixa de entrada", href: "/painel/emails/caixa" },
          { label: "Configuração", href: "/painel/emails" },
          // "Rastreio" saiu daqui em 24/10/2026: o código de rastreio é
          // informado só no próprio pedido (Vendas > pedido > aba Rastreio).
        ],
      },
    ],
  },
  {
    title: "Integrações",
    items: [
      { label: "Webhooks", href: "/painel/webhooks", icon: <IconWebhook /> },
      { label: "Apps", href: "/painel/apps", icon: <IconApps /> },
    ],
  },
  {
    // Um botão só: abre a grade de Configurações (lista acima, `configuracoes`).
    title: "Configurações",
    solto: true,
    items: [
      {
        label: "Configurações",
        href: "/painel/configuracoes",
        icon: <IconGear />,
        relacionadas: configuracoes.map((c) => c.href),
      },
    ],
  },
];

function IconGear() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>);
}

function IconApps() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>);
}
function IconGlobe() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></svg>);
}
function IconMail() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m2 7 10 6 10-6" /></svg>);
}
function IconWebhook() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-9.33-5" /><path d="m10.67 3-2.5 4.33" /><circle cx="6" cy="6" r="2" /><path d="M6 8a6 6 0 0 0 6 10.39" /><path d="M6.5 18h5" /><circle cx="13.5" cy="18" r="2" /><path d="M17.5 12a6 6 0 0 1-5 9.5" /><path d="m14.5 21.5-2.5-4.33" /><circle cx="18" cy="12" r="2" /></svg>);
}
function IconHome() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>);
}
function IconShield() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>);
}
function IconOrders() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-3-2V3a1 1 0 0 1 1-1Z" /><path d="M9 7h6M9 11h6" /></svg>);
}
function IconBox() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /></svg>);
}
function IconRanking() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20v-5" /><path d="M10 20V8" /><path d="M16 20v-9" /><path d="M22 20V4" /></svg>);
}
function IconLock() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>);
}
function IconCard() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>);
}
function IconMega() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 15-6v14L3 13v-2Z" /><path d="M7 13v4a2 2 0 0 0 4 0" /></svg>);
}
function IconCheckout() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m8 11 2 2 4-4" /></svg>);
}
function IconCartX() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M2 3h3l2.4 12.4a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.6L23 6H6" /></svg>);
}
function IconStar() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17.1 6.5 20l1-6.1L3 9.5l6.3-.9L12 3Z" /></svg>);
}
function IconPlusBox() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>);
}
function IconTag() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" /><circle cx="7.5" cy="7.5" r="1.2" /></svg>);
}
function IconPercent() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></svg>);
}
function IconGauge() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 17a9 9 0 1 1 17 0" /><path d="m12 13 4-5" /><circle cx="12" cy="13" r="1.2" /></svg>);
}
function IconCrown() {
  return (<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" /></svg>);
}
