import Link from "next/link";
import { configuracoes } from "@/components/painel/menu";

// Configurações: a grade aberta pelo botão "Configurações" da sidebar. Um
// cartão por opção, com ícone, nome e o que se faz lá. As opções vêm da mesma
// lista do menu (components/painel/menu.tsx), então não há como esta tela e a
// sidebar mostrarem coisas diferentes.
export default function Configuracoes() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">Configurações</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {configuracoes.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group flex flex-col rounded-2xl bg-card p-5 ring-1 ring-inset ring-line transition-[box-shadow,background-color] duration-150 hover:shadow-panel-hover hover:ring-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-soft text-mid ring-1 ring-inset ring-line transition group-hover:text-hi">
                {c.icon}
              </span>
              <span className="text-[15px] font-semibold text-hi">{c.label}</span>
            </span>
            <span className="mt-4 text-[13px] leading-relaxed text-low">{c.descricao}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
