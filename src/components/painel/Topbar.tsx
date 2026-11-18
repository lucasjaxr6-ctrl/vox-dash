"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/painel/ThemeToggle";

// Rótulos das rotas do painel (para o breadcrumb). Rotas dinâmicas caem no
// fallback que humaniza o próprio segmento da URL.
const LABELS: Record<string, string> = {
  "/painel": "Dashboard",
  "/painel/inicio": "Início",
  "/painel/plano": "Plano",
  "/painel/dispositivos": "Dispositivos",
  "/painel/seguranca": "Dispositivos conectados",
  "/painel/vendas": "Vendas",
  "/painel/carrinhos": "Carrinhos abandonados",
  "/painel/produtos": "Produtos",
  "/painel/personalizar": "Personalizar",
  "/painel/provas-sociais": "Provas sociais",
  "/painel/order-bump": "Order bump",
  "/painel/pagamentos": "Pagamentos",
  "/painel/cupons": "Cupons",
  "/painel/pixels": "Pixels",
  "/painel/emails": "E-mails",
  "/painel/emails/caixa": "Caixa de entrada",
  "/painel/configuracoes": "Configurações",
  "/painel/webhooks": "Webhooks",
  "/painel/apps": "Apps",
  "/painel/apps/utmify": "Utmify",
  "/painel/dominio": "Domínio",
  "/painel/criptografia": "Criptografia",
  "/painel/shopify": "Shopify",
};

function humanize(seg: string) {
  const s = seg.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Trilha do breadcrumb a partir do pathname, sem inventar rotas. */
function crumbs(pathname: string): { label: string; href: string }[] {
  if (pathname === "/painel") return [{ label: "Dashboard", href: "/painel" }];
  const segs = pathname.split("/").filter(Boolean); // ["painel", ...]
  const out: { label: string; href: string }[] = [];
  let acc = "";
  for (const seg of segs) {
    acc += `/${seg}`;
    if (acc === "/painel") continue; // "Painel" é a raiz fixa
    out.push({ label: LABELS[acc] ?? humanize(seg), href: acc });
  }
  return out;
}

export default function Topbar({ userName, userEmail }: { userName?: string | null; userEmail?: string | null }) {
  const pathname = usePathname();
  const trail = crumbs(pathname || "/painel");
  const display = userName?.trim() || userEmail || "Conta";
  const initials =
    (userName?.trim() || userEmail || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-app/80 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav aria-label="Trilha" className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {/* A raiz do painel é o Início: é a tela principal (e a única
              sempre aberta enquanto a loja está sendo configurada). */}
          <Link href="/painel/inicio" className="shrink-0 text-low transition hover:text-hi">
            Painel
          </Link>
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <span key={c.href} className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 text-dim">/</span>
                {last ? (
                  <span className="truncate font-medium text-hi">{c.label}</span>
                ) : (
                  <Link href={c.href} className="truncate text-low transition hover:text-hi">
                    {c.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {/* Conta */}
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-hover py-1 pl-1 pr-3 transition hover:border-line-strong">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-bright to-brand-hover text-[11px] font-bold text-white">
              {initials}
            </span>
            <span className="hidden max-w-[180px] truncate text-[12.5px] font-medium text-mid sm:block">{display}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
