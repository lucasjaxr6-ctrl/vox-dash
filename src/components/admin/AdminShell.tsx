"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import AdminSidebar, { NAV } from "./AdminSidebar";
import ThemeToggle from "@/components/painel/ThemeToggle";
import { PeriodTransition } from "@/components/painel/dashboard/PeriodTransition";

export default function AdminShell({ children, naoLidos, userName, userEmail }: {
  children: React.ReactNode;
  naoLidos: number;
  userName: string | null;
  userEmail: string | null;
}) {
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const current = NAV.find(n => n.href === pathname || (n.href !== "/admin" && pathname.startsWith(n.href + "/")));
  const label = current?.label ?? (pathname.startsWith("/admin/loja/") ? "Lojas" : "Visão geral");
  const identity = userName || userEmail || "Administrador";
  const initials = identity.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

  function closeMenu() { drawer.current?.close(); setOpen(false); }
  useEffect(() => { drawer.current?.close(); setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const query = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (query.matches) closeMenu(); };
    query.addEventListener("change", closeOnDesktop);
    return () => { document.body.style.overflow = previous; query.removeEventListener("change", closeOnDesktop); };
  }, [open]);

  return (
    <div className="panel-root admin-root flex min-h-screen bg-app text-mid antialiased">
      <a href="#admin-content" className="sr-only fixed left-4 top-2 z-50 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white focus:not-sr-only">Ir para o conteúdo</a>
      <AdminSidebar naoLidos={naoLidos} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-card px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={() => { drawer.current?.showModal(); setOpen(true); }} aria-label="Abrir menu administrativo" aria-haspopup="dialog" aria-expanded={open} aria-controls="admin-menu" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-mid hover:bg-hover lg:hidden">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <span className="hidden text-[13px] text-low sm:inline">Administração</span>
            <span className="hidden text-dim sm:inline" aria-hidden="true">/</span>
            <span className="truncate text-[13px] font-medium text-hi">{label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ThemeToggle />
            <div className="hidden max-w-[180px] text-right sm:block"><div className="truncate text-xs font-medium text-hi">{identity}</div><div className="text-[11px] text-low">Administrador</div></div>
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-soft text-xs font-semibold text-mid">{initials}</span>
          </div>
        </header>
        <main id="admin-content" tabIndex={-1} className="min-w-0 flex-1">
          {/* Troca de período sem piscar: o RangePicker navega por aqui e as
              PendingArea das páginas esmaecem até os dados novos chegarem. */}
          <div className="mx-auto w-full max-w-[1600px] px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pt-7"><PeriodTransition>{children}</PeriodTransition></div>
        </main>
      </div>
      <dialog ref={drawer} id="admin-menu" aria-labelledby="admin-menu-title" onClose={() => setOpen(false)} onClick={event => { if (event.target === drawer.current) closeMenu(); }} className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(300px,calc(100vw-40px))] max-w-none border-0 bg-card p-0 text-mid backdrop:bg-black/60">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 pt-4"><h2 id="admin-menu-title" className="text-sm font-medium text-hi">Administração</h2><button type="button" autoFocus onClick={closeMenu} aria-label="Fechar menu" className="flex h-9 w-9 items-center justify-center rounded-lg hover:bg-hover"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
          <div className="min-h-0 flex-1"><AdminSidebar mobile naoLidos={naoLidos} onNavigate={closeMenu} /></div>
        </div>
      </dialog>
    </div>
  );
}
