// Blocos de esqueleto do painel.
//
// Servem ao `loading.tsx`: sem ele o Next segura a tela ANTIGA até o servidor
// terminar de renderizar a nova, e o clique parece não ter funcionado. Com um
// esqueleto, a troca é imediata e o conteúdo entra por cima.
//
// `aria-hidden`: é enfeite de espera, não conteúdo — leitor de tela deve pular.

export function SkeletonBar({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-soft ${className}`} />;
}

/** Cartão genérico: serve para formulário, métrica ou bloco de texto. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="rounded-2xl bg-card p-5">
      <SkeletonBar className="h-4 w-1/3" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonBar key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

/** Lista/tabela: o formato mais comum do painel (vendas, carrinhos, e-mails). */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-2xl bg-card">
      <div className="px-5 py-3">
        <SkeletonBar className="h-3.5 w-40" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-3.5 w-1/3" />
              <SkeletonBar className="h-3 w-1/2" />
            </div>
            <SkeletonBar className="h-3 w-16 flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
