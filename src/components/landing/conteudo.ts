// Conteúdo da landing. Tudo aqui é VERDADE sobre a VOX — a página pública é
// propaganda, e propaganda com número inventado é enganosa (CDC, art. 37).

/** Cadastro: a tela de login já abre na aba de criar conta com este parâmetro. */
export const CADASTRO_HREF = "/login?cadastro=1";

/**
 * Canal de contato comercial ("Falar com o time", no fechamento). Enquanto for
 * null, o botão não aparece: a VOX ainda não tem um canal público definido, e
 * um botão que não leva a lugar nenhum é pior do que nenhum botão.
 */
export const CONTATO_HREF: string | null = null;

/**
 * Como o cartão é processado em cada gateway — conferido em
 * lib/settings.ts → gatewayCanCard:
 *  - transparente: o comprador digita o cartão no nosso checkout e a cobrança
 *    sai direto para o gateway (Appmax, Freepay, FintPag, HylexPay);
 *  - token: o cartão vira um código seguro no navegador do comprador, pelo SDK
 *    do gateway, antes de sair do aparelho (HyperCash, Beehive, PagNiv, MP);
 *  - iframe: o campo do cartão é do próprio gateway, embutido no checkout (Pagou).
 */
export type TipoCartao = "transparente" | "token" | "iframe";

/**
 * Gateways integrados e o que cada um processa no checkout da VOX — os mesmos
 * de `PaymentProvider` em lib/settings.ts. InfinitePay e Transfyre saíram do
 * produto em 02/10/2026. Gateway novo entra aqui e o número da página acompanha.
 */
export const GATEWAYS: { id: string; nome: string; logo: string; pix: true; cartao: TipoCartao | null }[] = [
  { id: "appmax", nome: "Appmax", logo: "/gateways/appmax.webp", pix: true, cartao: "transparente" },
  { id: "beehive", nome: "Beehive", logo: "/gateways/beehive.webp", pix: true, cartao: "token" },
  { id: "blackcat", nome: "BlackCat", logo: "/gateways/blackcat.png", pix: true, cartao: "transparente" },
  { id: "fintpag", nome: "FintPag", logo: "/gateways/fintpag.webp", pix: true, cartao: "transparente" },
  { id: "freepay", nome: "Freepay", logo: "/gateways/freepay.webp", pix: true, cartao: "transparente" },
  { id: "hylexpay", nome: "HylexPay", logo: "/gateways/hylexpay.webp", pix: true, cartao: "transparente" },
  { id: "hypercash", nome: "HyperCash", logo: "/gateways/hypercash.webp", pix: true, cartao: "token" },
  { id: "mangofy", nome: "MangoFy", logo: "/gateways/mangofy.png", pix: true, cartao: "transparente" },
  { id: "mercadopago", nome: "Mercado Pago", logo: "/gateways/mercadopago.webp", pix: true, cartao: "token" },
  { id: "mushpag", nome: "MushPag", logo: "/gateways/mushpag.png", pix: true, cartao: null },
  { id: "pagarme", nome: "Pagar.me", logo: "/gateways/pagarme.png", pix: true, cartao: "transparente" },
  { id: "pagniv", nome: "PagNiv", logo: "/gateways/pagniv.svg", pix: true, cartao: "token" },
  { id: "pagou", nome: "Pagou.ai", logo: "/gateways/pagou.webp", pix: true, cartao: "iframe" },
  { id: "pinpay", nome: "PinPay", logo: "/gateways/pinpay.webp", pix: true, cartao: null },
  { id: "pixgo", nome: "PixGo", logo: "/gateways/pixgo.webp", pix: true, cartao: null },
  { id: "pushinpay", nome: "PushinPay", logo: "/gateways/pushinpay.webp", pix: true, cartao: null },
  { id: "veopag", nome: "VeoPag", logo: "/gateways/veopag.png", pix: true, cartao: "transparente" },
  { id: "vext", nome: "Vext", logo: "/gateways/vext.webp", pix: true, cartao: null },
  { id: "wappi", nome: "Wappi", logo: "/gateways/wappi.webp", pix: true, cartao: "transparente" },
];

/**
 * Volume total da VOX, informado pelo dono em 06/10/2026: inclui a versão
 * anterior da plataforma, que rodava em outro banco (o banco atual só tem as
 * vendas desde 02/07/2026 — R$ 252 mil em 1.271 pedidos em 02/10/2026).
 * `pedidos` é ESTIMATIVA: R$ 50 milhões ÷ ticket médio de R$ 200, por isso
 * arredondado. Troque pela contagem real quando o dono tiver o número.
 * `gateways` sai da lista acima (antes estava escrito "13" à mão e ficou para
 * trás quando entraram BlackCat, Pagar.me, VeoPag e MangoFy).
 */
export const NUMEROS = {
  processado: "R$ 50M",
  pedidos: "250 mil",
  gateways: String(GATEWAYS.length),
};

/**
 * Perguntas frequentes (as cinco da versão do dono). Cada resposta descreve o
 * sistema como ele é hoje — cobrança (lib/payments.ts, lib/platform-fees.ts),
 * Smart Routing (lib/smart-routing.ts: Pix e cartão separados, distribuição
 * entre 2 e 4 gateways, condicional por valor), domínio (DomainManager: CNAME
 * com SSL automático), troca de gateway (manual, no painel) e pixels.
 */
export const PERGUNTAS: { p: string; r: string }[] = [
  {
    p: "A VOX recebe o dinheiro das minhas vendas?",
    r: "Não. Cada cobrança é criada com a credencial da sua loja, na sua conta do gateway, e o valor cai lá. Prazo de liberação e saque seguem as regras do seu gateway. A taxa da VOX é cobrada à parte, por Pix, a partir do extrato do painel.",
  },
  {
    p: "Posso usar gateways diferentes para Pix e cartão?",
    r: "Sim. Pix e cartão são configurados separados no painel, cada um no gateway que você escolher. Com o Smart Routing, você também divide os pedidos entre até 4 gateways na porcentagem que quiser, ou manda os pedidos acima de um valor para outro gateway.",
  },
  {
    p: "O checkout pode usar o domínio da minha loja?",
    r: "Sim. Você aponta um subdomínio da loja (como checkout.sualoja.com.br) com um único registro CNAME, e o certificado HTTPS é emitido sozinho. O comprador paga sem sair da sua marca.",
  },
  {
    p: "Preciso reconstruir tudo para trocar de gateway?",
    r: "Não. Você cadastra o outro gateway e troca o Pix ou o cartão no painel. Domínio, produtos e configurações continuam os mesmos. A troca é feita por você, não automaticamente.",
  },
  {
    p: "A VOX integra com tracking e mídia?",
    r: "Sim. Você configura no painel os pixels da Meta, do TikTok e do Google, e conecta a Utmify para acompanhar a origem de cada venda.",
  },
];
