// Disco com as iniciais do cliente, usado nas listas do painel.
//
// Existia copiado em três telas — Vendas, Carrinhos e Dashboard — e as cópias
// divergiram: duas usavam `bg-gradient-to-br from-gray-100`, um cinza FIXO que
// no tema escuro virava um disco quase branco e puxava a atenção da linha
// inteira. Aqui a cor sai dos tokens do tema e só há um lugar para corrigir.

export function initials(name: string) {
  const p = (name || "").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function InitialsAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-soft text-[11px] font-bold text-low ring-1 ring-inset ring-line"
    >
      {initials(name)}
    </span>
  );
}
