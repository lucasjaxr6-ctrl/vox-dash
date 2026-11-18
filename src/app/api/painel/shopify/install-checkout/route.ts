import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import {
  getShopifyCredentials,
  getDomainConfig,
  getCheckoutInstallState,
  setCheckoutInstalled,
} from "@/lib/settings";
import {
  buildCheckoutSrc,
  installCheckoutScriptTag,
  removeCheckoutScriptTags,
  listCheckoutScriptTags,
  installCheckoutThemeSnippet,
  removeCheckoutThemeSnippet,
  checkCheckoutThemeSnippet,
  sameCheckoutSrc,
} from "@/lib/shopify";

// POST /api/painel/shopify/install-checkout
// Instala na Shopify o redirecionamento do checkout para o checkout próprio da
// loja (domínio verificado). GET diagnostica, DELETE remove.
//
// A instalação tem DOIS caminhos independentes (ScriptTag + snippet no tema).
// Basta um funcionar. O GET compara o que está na loja com o `src` esperado —
// é ele que denuncia o caso silencioso: script presente, mas apontando para um
// endereço que não responde mais (a loja cai no checkout nativo sem avisar).

/** Erro em texto curto, para guardar no status. */
function reason(e: unknown): string {
  return e instanceof Error ? e.message : "erro desconhecido";
}

export async function POST() {
  try {
    const { store } = await requireStore();

    const creds = await getShopifyCredentials(store.id);
    if (!creds) {
      return json({ error: "Conecte a Shopify (token) antes de instalar o checkout." }, 400);
    }

    const dom = await getDomainConfig(store.id);
    if (!dom.customDomain || !dom.domainVerified) {
      return json({ error: "Configure e verifique seu domínio próprio antes (aba Domínio)." }, 400);
    }

    // O src SEMPRE aponta para o domínio próprio da loja — nunca para o domínio
    // pela qual o painel está sendo acessado, que pode ser uma URL de deploy
    // temporária e derrubaria o checkout no deploy seguinte.
    const src = buildCheckoutSrc(dom.customDomain);

    let scriptTagOk = false;
    let scriptTagErr: string | null = null;
    try {
      await installCheckoutScriptTag(store.id, src);
      scriptTagOk = true;
    } catch (e) {
      scriptTagErr = reason(e);
    }

    let snippetOk = false;
    let snippetErr: string | null = null;
    try {
      await installCheckoutThemeSnippet(store.id, src);
      snippetOk = true;
    } catch (e) {
      snippetErr = reason(e);
    }

    if (!scriptTagOk && !snippetOk) {
      return json({ error: `Falha ao instalar o checkout. ScriptTag: ${scriptTagErr}. Tema: ${snippetErr}` }, 502);
    }

    await setCheckoutInstalled(
      store.id,
      true,
      src,
      `instalado (script=${scriptTagOk ? "ok" : "falhou"}, tema=${snippetOk ? "ok" : "falhou"})`,
    );

    return json({
      ok: true,
      checkoutUrl: `https://${dom.customDomain}/checkout`,
      scriptTag: scriptTagOk,
      themeSnippet: snippetOk,
      scriptTagError: scriptTagErr,
      themeSnippetError: snippetErr,
    });
  } catch (err) {
    return handleError(err);
  }
}

// GET -> diagnóstico ao vivo: o que está de fato instalado na loja agora.
export async function GET() {
  try {
    const { store } = await requireStore();
    const state = await getCheckoutInstallState(store.id);

    const creds = await getShopifyCredentials(store.id);
    const dom = await getDomainConfig(store.id);
    const expectedSrc = dom.customDomain && dom.domainVerified ? buildCheckoutSrc(dom.customDomain) : null;

    if (!creds || !expectedSrc) {
      return json({
        ...state,
        expectedSrc,
        shopifyConnected: Boolean(creds),
        domainReady: Boolean(expectedSrc),
        scriptTags: [],
        themeSnippet: { present: false, upToDate: false },
      });
    }

    const [tags, snippet] = await Promise.all([
      listCheckoutScriptTags(store.id).catch(() => []),
      checkCheckoutThemeSnippet(store.id, expectedSrc).catch(() => ({ present: false, upToDate: false })),
    ]);

    return json({
      ...state,
      expectedSrc,
      shopifyConnected: true,
      domainReady: true,
      scriptTags: tags,
      // Um ScriptTag apontando para OUTRO endereço é o caso perigoso: existe,
      // mas o script não carrega — a loja cai no checkout nativo em silêncio.
      scriptTagOk: tags.some((t) => sameCheckoutSrc(t.src, expectedSrc)),
      scriptTagStale: tags.length > 0 && !tags.some((t) => sameCheckoutSrc(t.src, expectedSrc)),
      themeSnippet: snippet,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  try {
    const { store } = await requireStore();
    const removed = await removeCheckoutScriptTags(store.id).catch(() => 0);
    const snippetRemoved = await removeCheckoutThemeSnippet(store.id).catch(() => false);
    await setCheckoutInstalled(store.id, false, null, "removido pelo lojista");
    return json({ ok: true, removed, snippetRemoved });
  } catch (err) {
    return handleError(err);
  }
}
