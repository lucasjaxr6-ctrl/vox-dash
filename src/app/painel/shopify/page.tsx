// Vive em `painel/`, não em `admin/`: só esta tela o usa, e o endereço antigo
// convidava a estilizar com a paleta clara do admin — foi assim que a tela
// ficou com caixas brancas no tema escuro.
import IntegrationForm from "@/components/painel/IntegrationForm";

export default async function ShopifyPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; synced?: string }>;
}) {
  const { connected, synced } = await searchParams;
  const syncedN = Number(synced || 0);

  return (
    <div>
      <div className="flex items-center gap-3.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/apps/shopify.webp" alt="" className="h-11 w-11 flex-shrink-0 rounded-xl object-contain" />
        <div>
          <h1 className="text-2xl font-bold text-hi">Shopify</h1>
          <p className="text-sm text-low">Plataforma global de e-commerce</p>
        </div>
      </div>

      {/* Aviso de sucesso: fundo esverdeado translúcido em vez do verde-claro
          fixo, que no tema escuro virava uma faixa clara com texto quase
          invisível. O traço do ícone segue a cor do texto. */}
      {connected === "1" && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <p className="text-sm font-semibold">
            Shopify conectada com sucesso!{" "}
            {syncedN > 0
              ? `${syncedN} produto${syncedN === 1 ? "" : "s"} sincronizado${syncedN === 1 ? "" : "s"} automaticamente.`
              : "Se os produtos não aparecerem, use o botão de sincronizar."}
          </p>
        </div>
      )}

      <div className="mt-6">
        <IntegrationForm />
      </div>
    </div>
  );
}
