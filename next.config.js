/** @type {import('next').NextConfig} */

// ─────────────────────────────────────────────────────────────────────────────
// Content-Security-Policy (CSP)
// Defesa principal contra XSS. Ajuste 'connect-src' para incluir o domínio da
// sua API Shopify/gateway. NUNCA use 'unsafe-inline' em script-src em produção
// sem necessidade. Aqui usamos 'strict-dynamic' + nonce seria o ideal; para
// simplificar o boilerplate deixamos uma política restritiva e comentada.
// ─────────────────────────────────────────────────────────────────────────────
const cspDirectives = [
  "default-src 'self'",
  "base-uri 'self'",
  // `https:` por causa do desafio 3DS do cartão (BlackCat, Mercado Pago): o
  // checkout POSTa o `creq` para o ACS do BANCO EMISSOR num iframe, e esse
  // endereço muda de banco para banco — não há lista fixa possível. Com só
  // 'self' o navegador bloqueia o envio e o cliente fica preso no desafio.
  "form-action 'self' https:",
  "frame-ancestors 'self'", // só o próprio site pode embedar (preview do editor); bloqueia cross-origin (clickjacking)
  "object-src 'none'",
  // Pagou: o campo do cartão e o desafio 3DS são iframes em *.pagou.ai
  // (collect.pagou.ai / collect.sandbox.pagou.ai).
  // Beehive: a tela de autenticação 3DS é exibida pelo SDK deles (iframe).
  // `https:` no fim: o iframe do desafio 3DS (ThreeDSChallenge) abre o ACS do
  // banco emissor, que é um domínio diferente para cada banco (ver form-action).
  "frame-src 'self' https://*.doubleclick.net https://www.googletagmanager.com https://td.doubleclick.net https://*.mercadopago.com https://*.mercadolibre.com https://api.fintpag.tech https://api.hylexpay.com https://*.online-metrix.net https://*.pagou.ai https://*.paybeehive.com.br https:",
  "img-src 'self' data: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Next.js precisa de 'unsafe-eval' (HMR no dev) e 'unsafe-inline' (scripts de
  // bootstrap/hidratação). SEM isto, a página renderiza mas NÃO fica interativa
  // (os botões não respondem). Para CSP estrita, migrar para nonces depois.
  // Domínios de pixel de marketing (Meta/Google Ads/DoubleClick) liberados.
  // FintPag (Shield): SDK /v1/js de tokenização + antifraude ThreatMetrix (*.online-metrix.net).
  // HyperCash (FastSoft): SDK security.js de tokenização de cartão (*.fastsoftbrasil.com).
  // Beehive: SDK /v1/js (BeehivePay.encrypt + 3DS). Host exato, que é o único
  // de onde carregamos script — sem ele o cartão da Beehive nem começa.
  // Beehive: o fingerprint (hopyfingerprint.js) é quem valida o token do cartão,
  // e ele carrega DUAS dependências de terceiros — crypto-js no cdnjs e o
  // antifraude da adquirente (payzu). Sem elas o fingerprint falha, o token sai
  // incompleto e a cobrança é recusada com "Dados inválidos" — sem nenhuma
  // pista de que o motivo era CSP.
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://connect.facebook.net https://*.googletagmanager.com https://www.googleadservices.com https://www.google-analytics.com https://*.doubleclick.net https://www.google.com https://*.mercadopago.com https://*.mlstatic.com https://api.fintpag.tech https://api.hylexpay.com https://*.online-metrix.net https://*.fastsoftbrasil.com https://*.hypercash.com.br https://*.hypay.com.br https://*.pagou.ai https://api.conta.paybeehive.com.br https://cdnjs.cloudflare.com https://static.payzu.io https://analytics.tiktok.com https://cdn.taboola.com https://s1.kwai.net https://s16-11187.ap4r.com https://s.pinimg.com",
  // TikTok Pixel: o script vem de analytics.tiktok.com (script-src) e os
  // eventos saem para *.tiktok.com e *.tiktokw.us (connect-src).
  // Taboola Pixel: tfa.js vem de cdn.taboola.com (script-src) e os eventos
  // saem para *.taboola.com (connect-src; os beacons de imagem já cabem em img-src).
  // Kwai Pixel: events.js e core.js vêm de s1.kwai.net (reserva: s16-11187.ap4r.com)
  // e os eventos saem para os domínios de anúncio deles — kwai.com, kwai-pro.com,
  // ksapisrv.com, mythad.com, funmora.com, adaether.com (levantados do próprio
  // core.js em 07/10/2026).
  // Pinterest tag: core.js vem de s.pinimg.com e os eventos vão para ct.pinterest.com.
  // Google Ads: a conversão também sai para o Google do país do cliente
  // (www.google.com.br/pagead/1p-conversion), que *.google.com não cobre.
  // PagNiv: a tokenização é um fetch do NAVEGADOR para a URL que a API deles
  // informa (hoje tokenize.pagniv.com). Curinga porque a doc manda ler a URL da
  // API em vez de fixá-la — se mudarem de subdomínio, continua funcionando.
  // Nuvra: mesma ideia (o navegador posta o cartão na `tokenizeUrl` que vem
  // de /card-tokenization). A doc não diz o host, que é do provedor da conta:
  // o "Testar chave" do painel mostra qual é, e ele TEM de estar aqui, senão o
  // navegador bloqueia a tokenização em silêncio. O esquema s1 é o mesmo da
  // PagNiv, já liberada acima.
  "connect-src 'self' https://nuvrapayments.com https://*.nuvrapayments.com https://*.myshopify.com https://www.facebook.com https://connect.facebook.net https://www.google-analytics.com https://region1.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.doubleclick.net https://*.google.com https://*.google.com.br https://*.googleadservices.com https://api.mercadopago.com https://*.mercadopago.com https://*.mercadolibre.com https://*.mlstatic.com https://api.fintpag.tech https://api.hylexpay.com https://*.online-metrix.net https://*.fastsoftbrasil.com https://*.hypercash.com.br https://*.hypay.com.br https://api.ipify.org https://*.pagou.ai https://*.paybeehive.com.br https://*.pagniv.com https://*.payzu.io https://ipwho.is https://*.tiktok.com https://*.tiktokw.us https://*.taboola.com https://*.kwai.com https://*.kwai.net https://*.kwai-pro.com https://*.ksapisrv.com https://*.mythad.com https://*.funmora.com https://*.adaether.com https://*.pinterest.com https://*.pinimg.com",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  // Força HTTPS por 2 anos, incluindo subdomínios. Só ative quando estiver 100% em HTTPS.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy", value: cspDirectives },
  // Impede MIME-sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Reforço anti-clickjacking (além do frame-ancestors do CSP)
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Não vaza a URL completa para sites externos
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Desabilita APIs sensíveis do browser por padrão
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Isolamento de origem (mitiga ataques de canal lateral tipo Spectre)
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // remove o header "X-Powered-By: Next.js" (não vaza stack)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
