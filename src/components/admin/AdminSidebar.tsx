"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Navegação do admin da PLATAFORMA. Pedidos/Sessões saíram: pedido é a mesma
// coisa que transação, e sessão de login não é operação do dia a dia.
export const NAV = [
  { href: "/admin", label: "Visão geral", exact: true, icon: <IconHome /> },
  { href: "/admin/transacoes", label: "Transações", icon: <IconReceipt /> },
  { href: "/admin/lojas", label: "Lojas", icon: <IconStore /> },
  { href: "/admin/clientes", label: "Clientes", icon: <IconUser /> },
  { href: "/admin/produtos", label: "Produtos", icon: <IconBox /> },
  { href: "/admin/relatorios", label: "Relatórios", icon: <IconChart /> },
  { href: "/admin/taxas", label: "Taxas", icon: <IconPercent /> },
  { href: "/admin/assinaturas", label: "Assinaturas", icon: <IconCrown /> },
  { href: "/admin/emails", label: "E-mails", icon: <IconMail /> },
  { href: "/admin/usuarios", label: "Usuários", icon: <IconUsers /> },
  { href: "/admin/configuracoes", label: "Configurações", icon: <IconGear /> },
];

export default function AdminSidebar({ naoLidos = 0, mobile = false, onNavigate }: { naoLidos?: number; mobile?: boolean; onNavigate?: () => void }) {
  const path = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/") || (href === "/admin/lojas" && path.startsWith("/admin/loja/"));

  return (
    <aside className={mobile ? "flex h-full min-h-0 flex-col bg-card" : "sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r border-line bg-card lg:flex"}>
      {/* Só a marca, centralizada — igual ao painel do lojista. O nome escrito
          ao lado repetia o que a própria logo já diz. */}
      <div className="flex items-center justify-center px-5 py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vox-logo.png" alt="VoxCheckout" width={66} height={36} className="h-9 w-auto shrink-0 select-none" />
      </div>

      <nav aria-label="Navegação administrativa" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-5">
        {NAV.map((n) => {
          const active = isActive(n.href, n.exact);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                active ? "bg-brand/10 text-brand dark:text-brand-bright" : "text-mid hover:bg-hover hover:text-hi"
              }`}
            >
              <span className={active ? "text-brand dark:text-brand-bright" : "text-low"}>{n.icon}</span>
              {n.label}
              {/* Contador de não lidos, só na caixa e só quando há algo. */}
              {n.href === "/admin/emails" && naoLidos > 0 && (
                <span className="ml-auto rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {naoLidos > 99 ? "99+" : naoLidos}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <Link
          href="/painel"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold text-mid transition hover:bg-hover hover:text-hi"
        >
          <span className="text-low"><IconExit /></span>
          Ir ao painel
        </Link>
      </div>
    </aside>
  );
}

// Ícones em traço, 18px, para casar com o peso do texto do menu.
function S({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function IconHome() { return <S><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h14V10" /></S>; }
function IconReceipt() { return <S><path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21z" /><path d="M9 8h6M9 12h6" /></S>; }
function IconStore() { return <S><path d="M3 7h18v13H3z" /><path d="M3 7l2-4h14l2 4" /><path d="M9 20v-6h6v6" /></S>; }
function IconUser() { return <S><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" /></S>; }
function IconBox() { return <S><path d="M20 7 12 3 4 7v10l8 4 8-4z" /><path d="M4 7l8 4 8-4M12 11v10" /></S>; }
function IconChart() { return <S><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></S>; }
function IconMail() { return <S><path d="M3 6h18v12H3z" /><path d="m3 7 9 6 9-6" /></S>; }
function IconPercent() { return <S><path d="M19 5 5 19" /><circle cx="7.5" cy="7.5" r="2.5" /><circle cx="16.5" cy="16.5" r="2.5" /></S>; }
function IconCrown() { return <S><path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8Z" /></S>; }
function IconUsers() { return <S><circle cx="9" cy="8" r="3.5" /><path d="M2 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" /><path d="M17 4.5a3.5 3.5 0 0 1 0 7M22 20v-1a5 5 0 0 0-3-4.6" /></S>; }
function IconGear() { return <S><circle cx="12" cy="12" r="3.2" /><path d="M12 2v2.2M12 19.8V22M22 12h-2.2M4.2 12H2M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" /></S>; }
function IconExit() { return <S><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></S>; }
