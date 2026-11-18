import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { resolveStoreByHost } from "@/lib/stores";
import { getStoreName, getCheckoutTheme } from "@/lib/settings";
import { mergeTheme, corDoBotao } from "@/lib/checkout-theme";
import { CornerStyle, CORNERS_CLASS } from "@/components/checkout/ui";
import RastreioHeader from "@/components/rastreio/RastreioHeader";

export const dynamic = "force-dynamic";
export { storeMetadata as generateMetadata } from "@/lib/store-metadata";

// Entrada do rastreio: o cliente digita o código e cai na página da encomenda.
//
// Existe porque o link do e-mail se perde, e sem esta tela a única forma de
// voltar seria achar o e-mail antigo. Um <form> com GET de propósito: funciona
// sem JavaScript e deixa a URL compartilhável.
export default async function RastreioIndex({
  searchParams,
}: {
  searchParams: Promise<{ codigo?: string }>;
}) {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) notFound();

  const { codigo } = await searchParams;
  const limpo = (codigo || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 64);
  if (limpo) redirect(`/rastreio/${encodeURIComponent(limpo)}`);

  const [storeName, temaBruto] = await Promise.all([getStoreName(store.id), getCheckoutTheme(store.id)]);
  const theme = mergeTheme(temaBruto);

  return (
    <div
      className={`${CORNERS_CLASS} flex min-h-screen flex-col`}
      style={{ background: theme.colors.background, fontFamily: theme.typography.fontFamily }}
    >
      <CornerStyle roundness={theme.corners.roundness} />
      <RastreioHeader theme={theme} storeName={storeName} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-gray-900">Rastrear pedido</h1>
        <p className="mt-1.5 text-[14px] text-gray-500">
          Acompanhe sua encomenda, da postagem até a entrega.
        </p>

        <form action="/rastreio" method="get" className="mt-7 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <label htmlFor="codigo" className="block text-[12.5px] font-semibold text-gray-500">
            Digite seu código de rastreio
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              id="codigo"
              name="codigo"
              required
              maxLength={64}
              autoComplete="off"
              placeholder="Ex.: ZA07348105601"
              className="min-w-0 flex-1 rounded-xl border border-gray-300 px-4 py-3 font-mono text-[15px] uppercase tracking-wide text-gray-900 outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-gray-400 focus:border-gray-900"
            />
            <button
              type="submit"
              className="flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-bold"
              style={{ background: corDoBotao(theme), color: theme.colors.buttonText }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              Rastrear
            </button>
          </div>
          <p className="mt-2.5 text-[12px] text-gray-400">
            O código está no e-mail que você recebeu quando o pedido foi postado.
          </p>
        </form>
      </main>
      {/* Sem rodapé: ver a nota na página da encomenda. */}
    </div>
  );
}
