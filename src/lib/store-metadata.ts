import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { resolveStoreByHost } from "./stores";
import { getStoreName, getCheckoutTheme } from "./settings";
import { mergeTheme } from "./checkout-theme";

/**
 * Título, descrição e favicon das páginas do CLIENTE (checkout, Pix, pedido,
 * rastreio): a marca da LOJA, e NADA da plataforma.
 *
 * O comprador não pode ver a Vox em lugar nenhum — nem na aba do navegador,
 * nem na pré-visualização do link quando ele manda o rastreio para alguém no
 * WhatsApp. Ali apareciam "VOX — checkout seguro" e o logo da Vox, porque:
 *
 *   • a descrição era herdada do layout raiz (que serve ao painel), e
 *   • o `icon.png` na raiz de `app/` vale para TODAS as rotas.
 *
 * O ícone foi movido para `app/painel`, `app/admin` e `app/login` — as rotas
 * da plataforma —, então as páginas de loja não herdam mais nada. Loja sem
 * favicon próprio fica sem favicon, que é o certo: melhor nenhuma marca que a
 * marca errada.
 */
export async function storeMetadata(): Promise<Metadata> {
  // `null` REMOVE o que veio do layout raiz. Omitir não serve: o campo
  // ausente é herdado, e era assim que "VOX — checkout seguro" chegava até a
  // página de rastreio da loja.
  const semPlataforma: Metadata = { description: null };

  try {
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return semPlataforma;

    const [rawTheme, storeName] = await Promise.all([getCheckoutTheme(store.id), getStoreName(store.id)]);
    const theme = mergeTheme(rawTheme);
    const title = theme.seo.title || storeName;
    const favicon = theme.seo.faviconUrl?.trim();

    return {
      ...semPlataforma,
      ...(title ? { title } : {}),
      // O `apple` entra junto porque é dele que o WhatsApp tira a miniatura do
      // link quando não há og:image. Só o `icon` deixaria a prévia sem imagem
      // no navegador e com a imagem errada no aplicativo.
      ...(favicon ? { icons: { icon: favicon, apple: favicon } } : {}),
    };
  } catch {
    // Nunca derruba a página por causa do título.
    return semPlataforma;
  }
}
