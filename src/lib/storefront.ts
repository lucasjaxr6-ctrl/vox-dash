import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Endereço da LOJA (vitrine) a partir do endereço do CHECKOUT.
//
// O checkout roda sempre num subdomínio que o lojista aponta por CNAME
// (checkout.loja.com, seguro.loja.com.br...). Quem analisa a operação — banco,
// adquirente, antifraude — quer ver a LOJA, não o subdomínio de pagamento.
//
// A HyperCash reclamou exatamente disso em 16/09/2026: "só está conseguindo ter
// acesso ao checkout... você acabou colocando duplicado o checkout" — mandávamos
// `site` e `checkoutUrl` apontando os dois para o mesmo lugar.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sufixos públicos: o que sobra depois de tirar um rótulo NÃO pode ser um
 * destes, senão `loja.com.br` (apex, sem subdomínio) viraria `com.br`.
 */
const SUFIXOS = new Set([
  "com", "net", "org", "app", "dev", "io", "co", "shop", "store", "site",
  "com.br", "net.br", "org.br", "app.br", "blog.br", "eco.br", "ind.br", "srv.br",
  "co.uk", "com.pt", "com.ar", "com.mx", "com.co",
]);

/**
 * Rótulos que só existem para hospedar o checkout. Só tiramos quando é um
 * deles: um subdomínio qualquer pode ser a própria loja (`loja.marca.com`), e
 * cortar às cegas mandaria a marca errada para a adquirente.
 */
const ROTULOS_DE_CHECKOUT = new Set([
  "checkout", "seguro", "secure", "pay", "pagamento", "pagar", "compra",
  "comprar", "carrinho", "cart", "pedido", "loja-segura",
]);

/**
 * Host da vitrine a partir do host do checkout. Devolve o host ORIGINAL quando
 * não dá para afirmar nada — é melhor mandar o checkout do que inventar um
 * domínio que talvez nem exista.
 */
export function storefrontHost(checkoutHost: string | null | undefined): string | null {
  const host = (checkoutHost || "").trim().toLowerCase().replace(/^www\./, "");
  if (!host || !host.includes(".")) return null;

  const partes = host.split(".");
  if (partes.length < 3) return host; // já é o apex (loja.com / loja.com.br)
  if (!ROTULOS_DE_CHECKOUT.has(partes[0])) return host;

  const resto = partes.slice(1).join(".");
  // Sobrou só um sufixo público? Então o primeiro rótulo era a própria marca.
  if (SUFIXOS.has(resto)) return host;
  return resto;
}

/** `https://<vitrine>` a partir da URL do checkout. Null se não der para saber. */
export function storefrontUrl(checkoutUrl: string | null | undefined): string | null {
  if (!checkoutUrl) return null;
  try {
    const host = storefrontHost(new URL(checkoutUrl).hostname);
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}
