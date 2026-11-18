import { SkeletonBar, SkeletonList } from "@/components/painel/Skeleton";

// Esqueleto das telas do admin, mostrado enquanto a página nova renderiza no
// servidor — sem ele o clique no menu parecia não ter funcionado.
//
// Mesma regra do painel (ver PainelLoading): cada seção reexporta este
// componente no PRÓPRIO loading.tsx, e as telas que trocam de período pela URL
// (Visão geral, Transações, Clientes, Relatórios) ficam sem — no build de
// produção a troca de ?range= ficaria presa esperando o limite de
// carregamento. Elas esmaecem pela PendingArea.
export default function AdminLoading() {
  return (
    <div>
      <SkeletonBar className="h-7 w-52" />
      <SkeletonBar className="mt-2 h-3.5 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} aria-hidden className="rounded-2xl bg-card p-5">
            <SkeletonBar className="h-3.5 w-24" />
            <SkeletonBar className="mt-4 h-7 w-32 max-w-full" />
          </div>
        ))}
      </div>
      <div className="mt-4">
        <SkeletonList rows={7} />
      </div>
    </div>
  );
}
