import { SkeletonBar, SkeletonCard, SkeletonList } from "@/components/painel/Skeleton";

// Esqueleto padrão das páginas do painel, mostrado enquanto a página nova
// renderiza no servidor — sem ele o clique na barra lateral parecia não ter
// funcionado.
//
// Cada seção reexporta este componente no PRÓPRIO loading.tsx, em vez de um
// loading.tsx na raiz do painel.
//
// ⚠️ TELA DO PAINEL QUE NAVEGA TROCANDO SÓ A QUERY NÃO PODE TER loading.tsx: é o
// caso de ?period= na Dashboard, no Desempenho e nos Dispositivos; de ?page= e
// ?status= em Vendas; de ?page= em Carrinhos e de ?p= em Taxas. O pré-carregamento
// ignora a query, então o link do menu preenche a mesma entrada de cache de
// ?page=2, e a troca só reaproveita essa entrada quando há um loading.tsx. No
// build de produção ela fica presa para sempre: resposta completa do servidor e
// a tela sem trocar. No `next dev` não acontece, e a emulação de rede do DevTools
// também esconde: para reproduzir, o atraso tem de vir de fora do navegador
// (medido em 05/11/2026: 40 de 40 cliques presos com atraso real de 0 a 400 ms,
// 0 de 72 com o atraso emulado). Nas Assinaturas do admin, com loading.tsx e
// ?f=, a troca funciona: a causa exata além do loading.tsx não foi isolada.
//
// NEUTRO de propósito: cobre da caixa de entrada às configurações.
export default function PainelLoading() {
  return (
    <div>
      <SkeletonBar className="h-7 w-52" />
      <SkeletonBar className="mt-2 h-3.5 w-80 max-w-full" />

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonList rows={7} />
        </div>
        <div className="space-y-5">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </div>
      </div>
    </div>
  );
}
