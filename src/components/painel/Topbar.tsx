"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/painel/ThemeToggle";
import type { Premiacao } from "@/lib/premiacao";

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

export default function Topbar({
  userName,
  userEmail,
  premiacao,
}: {
  userName?: string | null;
  userEmail?: string | null;
  premiacao?: Premiacao | null;
}) {
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
      <div className="flex h-14 items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <nav aria-label="Trilha" className="flex min-w-0 shrink-0 items-center gap-1.5 text-[13px]">
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

        {premiacao && <BarraPremiacao p={premiacao} />}

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

const brlCurto = (cents: number) => {
  const r = cents / 100;
  if (r >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (r >= 1_000) return `R$ ${(r / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(r).toLocaleString("pt-BR")}`;
};

/** Barra de progresso até o próximo marco de faturamento (premiação). */
function BarraPremiacao({ p }: { p: Premiacao }) {
  const pct = Math.round(p.progresso * 100);
  const alvo = p.proximo ?? p.atual;
  const dica = p.proximo
    ? `Faturamento pago de todas as suas lojas, desde o início. Próxima premiação: ${p.proximo.label}. ${p.conquistados} de ${p.totalMarcos} conquistadas.`
    : `Você conquistou todas as ${p.totalMarcos} premiações.`;
  return (
    <div className="hidden min-w-0 flex-1 items-center justify-center md:flex">
      <div className="flex w-full max-w-[460px] items-center gap-3 rounded-full border border-line bg-hover py-1.5 pl-3 pr-4" title={dica}>
        <span className="flex shrink-0 items-center gap-1.5 text-[12.5px] font-medium text-hi">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-amber-400">
            <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
          </svg>
          Prêmios
          <span aria-hidden className="text-[11px] text-dim">ⓘ</span>
        </span>
        <div
          role="progressbar"
          aria-label={p.proximo ? `Progresso até a premiação de ${p.proximo.label}` : "Todas as premiações conquistadas"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="relative h-2 min-w-[60px] flex-1 overflow-hidden rounded-full bg-soft ring-1 ring-line"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-700"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-mid">
          <span className="font-semibold text-hi">{brlCurto(p.totalCents)}</span>
          {alvo && <span className="text-low"> / {brlCurto(alvo.cents)}</span>}
        </span>
      </div>
    </div>
  );
}
