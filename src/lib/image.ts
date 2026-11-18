// Miniatura de imagem de produto no tamanho em que ela é desenhada.
//
// As fotos vêm da Shopify no ORIGINAL — medido na Melora Home: PNGs de até
// 2 MB desenhados num quadrado de 40px. Numa lista de 143 produtos isso é baixar
// e decodificar dezenas de MB, e era o que dava as travadinhas ao trocar o
// período no Desempenho. O CDN da Shopify redimensiona pela própria URL
// (`width=`) e ainda entrega AVIF/WebP: a mesma foto cai para ~4 KB.
//
// URL que não é da Shopify volta como veio.
export function thumb(url: string, px: number): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "cdn.shopify.com" && !u.pathname.includes("/cdn/shop/")) return url;
    // 2x para telas de alta densidade.
    u.searchParams.set("width", String(Math.round(px * 2)));
    return u.toString();
  } catch {
    return url;
  }
}
