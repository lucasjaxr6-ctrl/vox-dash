"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import StoreSwitcher from "@/components/painel/StoreSwitcher";
import ThemeToggle from "@/components/painel/ThemeToggle";
import { rotaPermitida, type EtapaRota } from "@/lib/onboarding-rotas";
// Seções, itens e ícones do menu: em ./menu, compartilhados com a
// demonstração do painel na landing.
import { sections } from "@/components/painel/menu";

const allItems = sections.flatMap((s) => s.items);

export default function Sidebar({ travado = false, etapas = [] }: { travado?: boolean; etapas?: EtapaRota[] }) {
  const pathname = usePathname();
  // Configuração pendente: o item continua visível (o lojista vê o que vai
  // ganhar), mas com cadeado e sem link até terminar o passo a passo.
  const livre = (href: string) => !travado || rotaPermitida(href, etapas);
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Abre por padrão a categoria que contém a rota atual.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const item of allItems) {
      if ("children" in item && item.children.some((c) => c.href === pathname)) {
        init[item.label] = true;
      }
    }
    return init;
  });

  useEffect(() => {
    setMobileOpen(false); // fecha o drawer ao navegar
    for (const item of allItems) {
      if ("children" in item && item.children.some((c) => c.href === pathname)) {
        setOpen((o) => (o[item.label] ? o : { ...o, [item.label]: true }));
      }
    }
  }, [pathname]);

  // Categorias recolhidas pelo lojista. Lembradas neste navegador: recolher
  // "Integrações" e ver tudo aberto de novo a cada clique seria inútil.
  // Começa tudo aberto (é o que o servidor desenha); o que estava recolhido
  // é aplicado depois de montar, sem animar, para não "fechar na cara".
  const [fechadas, setFechadas] = useState<Record<string, boolean>>({});
  const [animar, setAnimar] = useState(false);
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_FECHADAS) || "{}");
      if (salvo && typeof salvo === "object") setFechadas(salvo);
    } catch {
      /* storage bloqueado ou ilegível: tudo aberto */
    }
    const t = setTimeout(() => setAnimar(true), 50);
    return () => clearTimeout(t);
  }, []);

  // A categoria da página atual sempre abre ao navegar: chegar numa tela e não
  // ver onde ela está no menu desorienta.
  useEffect(() => {
    const atual = sections.find((s) => s.items.some((i) => rotaDoItem(i, pathname)));
    if (atual) setFechadas((f) => (f[atual.title] ? { ...f, [atual.title]: false } : f));
  }, [pathname]);

  function alternar(titulo: string) {
    setFechadas((f) => {
      const novo = { ...f, [titulo]: !f[titulo] };
      try {
        localStorage.setItem(CHAVE_FECHADAS, JSON.stringify(novo));
      } catch {
        /* sem storage: vale só nesta visita */
      }
      return novo;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  /** Um item do menu (link simples ou grupo com subitens, como E-mails). */
  function renderItem(item: (typeof allItems)[number]) {
    if ("href" in item) {
      const active = pathname === item.href || !!item.relacionadas?.includes(pathname);
      if (!livre(item.href)) {
        return <ItemTravado key={item.label} icon={item.icon} label={item.label} href={item.href} active={active} />;
      }
      return (
        <Link key={item.label} href={item.href} aria-current={active ? "page" : undefined} className={itemCls(active)}>
          <span className={active ? VERDE_ATIVO : "text-low transition group-hover:text-mid"}>{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </Link>
      );
    }

    const isOpen = !!open[item.label];
    const groupActive = item.children.some((c) => c.href === pathname);
    return (
      <div key={item.label}>
        <button
          onClick={() => setOpen((o) => ({ ...o, [item.label]: !o[item.label] }))}
          aria-expanded={isOpen}
          className={`${itemCls(false)} w-full ${groupActive ? "text-hi" : ""}`}
        >
          <span className={groupActive ? VERDE_ATIVO : "text-low transition group-hover:text-mid"}>{item.icon}</span>
          <span className="flex-1 truncate text-left">{item.label}</span>
          <IconChevron open={isOpen} />
        </button>

        {isOpen && (
          <div className="ml-[1.6rem] mt-[2px] space-y-[2px] border-l border-line pl-2.5">
            {item.children.map((c) => {
              const active = pathname === c.href;
              if (!livre(c.href)) {
                return (
                  <Link
                    key={c.href}
                    href={c.href}
                    title={DICA_TRAVADO}
                    className={`flex items-center justify-between gap-2 truncate rounded-md px-2.5 py-1.5 text-[12.5px] transition hover:bg-hover ${active ? "bg-hover text-mid" : "text-dim"}`}
                  >
                    {c.label}
                    <IconLockSmall />
                  </Link>
                );
              }
              return (
                <Link
                  key={c.href}
                  href={c.href}
                  aria-current={active ? "page" : undefined}
                  className={`block truncate rounded-md px-2.5 py-1.5 text-[12.5px] transition ${
                    active ? `bg-brand/[0.08] font-medium dark:bg-brand-bright/[0.12] ${VERDE_ATIVO}` : "text-low hover:bg-hover hover:text-hi"
                  }`}
                >
                  {c.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {/* Barra superior (apenas mobile) */}
      {/* Logo ABSOLUTA no centro: o botão de menu e o seletor de tema têm
          larguras diferentes, então `justify-between` deixava a marca fora do
          eixo da tela. */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-line bg-card/95 px-4 py-2 backdrop-blur lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="rounded-lg p-1.5 text-mid transition hover:bg-hover hover:text-hi"
        >
          <IconMenu />
        </button>
        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2">
          <Logo className="h-8" />
        </div>
        <ThemeToggle />
      </div>

      {/* Backdrop do drawer (mobile) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-shrink-0 flex-col bg-card transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo centralizada. O "fechar" fica ABSOLUTO à direita para não
            empurrar a marca do centro — com `justify-between` ela ficava
            centralizada no mobile e encostada à esquerda no desktop, onde o
            botão não existe. */}
        <div className="relative flex items-center justify-center px-5 pb-4 pt-5">
          <Logo className="h-9" />
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-lg p-1 text-low transition hover:bg-hover hover:text-hi lg:hidden"
          >
            <IconX />
          </button>
        </div>

        <div className="px-3 pb-2">
          <StoreSwitcher />
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          {sections.map((section, i) => {
            // A primeira seção (Início, Dashboard, Taxas) fica sempre à vista e
            // sem título, como no topo do desenho de referência: é o que se usa
            // todo dia, e recolher isso só esconderia o caminho de casa.
            if (i === 0 || section.solto) {
              // Seção "solta" (o botão Configurações): sem título, direto no menu.
              return (
                <div key={section.title} className={`space-y-[2px] ${i === 0 ? "" : "pt-3"}`}>
                  {section.items.map(renderItem)}
                </div>
              );
            }
            const aberta = !fechadas[section.title];
            const idLista = `menu-${i}`;
            return (
              <div key={section.title} className="pt-3">
                <button
                  type="button"
                  onClick={() => alternar(section.title)}
                  aria-expanded={aberta}
                  aria-controls={idLista}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-[12.5px] font-semibold text-hi transition hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                >
                  {section.title}
                  <IconChevronSecao aberta={aberta} />
                </button>
                {/* Abre e fecha pela altura (grid 0fr/1fr). Fechada vira
                    `inert`: os links somem também do Tab e do leitor de tela. */}
                <div
                  id={idLista}
                  className={`grid ${animar ? "transition-[grid-template-rows] duration-200 ease-out" : ""}`}
                  style={{ gridTemplateRows: aberta ? "1fr" : "0fr" }}
                >
                  <div className="min-h-0 overflow-hidden" inert={!aberta}>
                    <div className="space-y-[2px] pl-2.5 pt-[2px]">{section.items.map(renderItem)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium text-low transition hover:bg-hover hover:text-hi"
          >
            <IconLogout />
            Sair
          </button>
        </div>
      </aside>
    </>
  );
}

const DICA_TRAVADO = "Conclua a configuração da loja no Início para liberar";

/** Onde o navegador lembra quais categorias o lojista recolheu. */
const CHAVE_FECHADAS = "vox-menu-fechadas";

/** O item (ou um subitem dele) é a página atual? */
function rotaDoItem(item: (typeof allItems)[number], pathname: string) {
  return "href" in item
    ? item.href === pathname || !!item.relacionadas?.includes(pathname)
    : item.children.some((c) => c.href === pathname);
}

/* Item bloqueado enquanto a configuração inicial da loja não termina. Continua
   clicável: a página mostra o aviso de "conclua a configuração primeiro", que
   explica o cadeado melhor do que um clique que não faz nada. */
function ItemTravado({ icon, label, href, active }: { icon: React.ReactNode; label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      title={DICA_TRAVADO}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] transition hover:bg-hover ${active ? "bg-hover text-mid" : "text-dim"}`}
    >
      <span className="opacity-60">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <IconLockSmall />
    </Link>
  );
}

function IconLockSmall() {
  return (
    <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/* Classe base dos itens de navegação (ativo x inativo). O ativo é uma pílula
   verde com contorno fino. O tom muda com o tema: o verde claro da marca
   (#22BF9D) só lê bem no escuro; no branco ele daria ~2,4:1 de contraste, então
   lá vale o verde da marca (#1F846E, 4,6:1). */
function itemCls(active: boolean) {
  return `group relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
    active
      ? "bg-brand/[0.08] font-medium text-brand ring-1 ring-inset ring-brand/20 dark:bg-brand-bright/[0.12] dark:text-brand-bright dark:ring-brand-bright/25"
      : "text-mid hover:bg-hover hover:text-hi"
  }`;
}

/* Cor do ícone (e do subitem) ativo: mesmo critério de contraste do itemCls. */
const VERDE_ATIVO = "text-brand dark:text-brand-bright";

// Só a marca, centralizada. O texto "Vox" ao lado saiu: a logo já traz o
// símbolo, e repetir o nome em letra ao lado duplicava a mesma informação.
function Logo({ className = "h-8" }: { className?: string }) {
  return (
    <div className="flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/vox-logo.png"
        alt="VoxCheckout"
        width={59}
        height={32}
        className={`${className} w-auto shrink-0 select-none`}
        draggable={false}
      />
    </div>
  );
}

function IconMenu() {
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>);
}
function IconX() {
  return (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>);
}
function IconChevron({ open }: { open: boolean }) {
  return (
    <svg className={`text-dim transition-transform duration-200 ${open ? "rotate-90" : ""}`} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
/* Seta da categoria: para baixo aberta, para a direita recolhida. */
function IconChevronSecao({ aberta }: { aberta: boolean }) {
  return (
    <svg
      className={`text-low transition-transform duration-200 ${aberta ? "" : "-rotate-90"}`}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function IconLogout() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>);
}
