import { z } from "zod";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";
import { MAX_GATEWAYS, MAX_RETENTATIVA, validarRegra } from "./smart-routing";
import { TEMPOS_EMAIL, type KindTempo } from "./email-tempos";

// ─────────────────────────────────────────────────────────────────────────────
// Validação de TODO input no servidor (nunca confie no que o frontend mandou).
// Limites de tamanho protegem contra payloads gigantes (DoS).
// ─────────────────────────────────────────────────────────────────────────────

// CPF/CNPJ e celular moram em lib/documentos.ts, sem zod, para as telas usarem
// as mesmas regras. Reexportados aqui para quem já importava deste arquivo.
import { isValidCPF, isValidCNPJ, motivoDocumentoInvalido, motivoCelularInvalido, normalizarCelular } from "./documentos";
export { isValidCPF, isValidCNPJ };

const cpfSchema = z
  .string()
  .transform((v) => v.replace(/\D/g, ""))
  .refine(isValidCPF, { message: "CPF inválido" });

const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .regex(/^[\d()+\-\s]+$/, { message: "Telefone inválido" })
  .transform((v) => v.replace(/\D/g, ""));

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

// Cadastro do lojista em duas etapas, enviadas JUNTAS no fim: a conta só nasce
// com tudo preenchido (dados + loja + documento + endereço), numa transação.
export const registerSchema = z.object({
  // ── Etapa 1 ──
  name: z
    .string()
    .trim()
    .min(5, "Informe seu nome completo")
    .max(120)
    .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, { message: "Informe nome e sobrenome" }),
  // Celular com DDD que existe, começando com 9, sem número repetido ou em
  // sequência (lib/documentos.ts). Antes bastava o formato: (20) 99999-9999
  // passava.
  phone: z
    .string()
    .transform(normalizarCelular)
    .superRefine((v, ctx) => {
      const motivo = motivoCelularInvalido(v);
      if (motivo) ctx.addIssue({ code: "custom", message: motivo });
    }),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(254),
  // Mínimo de 8, com letra e número. A política anterior (12 + maiúscula +
  // minúscula + número) foi aliviada a pedido do dono; continua valendo só
  // para cadastros novos — login não valida política.
  password: z
    .string()
    .min(8, "A senha precisa ter no mínimo 8 caracteres")
    .max(200)
    .regex(/[A-Za-z]/, "A senha precisa ter pelo menos uma letra")
    .regex(/\d/, "A senha precisa ter pelo menos um número"),
  storeName: z.string().trim().min(2, "Informe o nome da loja").max(80),
  // ── Etapa 2 ──
  // Dígito verificador E fora da lista de exemplos/sequências: 123.456.789-09
  // passa no cálculo e chegou a ser usado em conta que vendia de verdade.
  document: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .superRefine((v, ctx) => {
      const motivo = motivoDocumentoInvalido(v);
      if (motivo) ctx.addIssue({ code: "custom", message: motivo });
    }),
  cep: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 8, { message: "CEP inválido" }),
  street: z.string().trim().min(2, "Informe a rua").max(191),
  number: z.string().trim().min(1, "Informe o número").max(20),
  complement: z.string().trim().max(120).optional().default(""),
  neighborhood: z.string().trim().min(2, "Informe o bairro").max(120),
  city: z.string().trim().min(2, "Informe a cidade").max(120),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => (UFS as readonly string[]).includes(v), { message: "UF inválida" }),
});

/**
 * Completar o cadastro de conta criada antes do KYC: as mesmas regras do
 * cadastro novo para celular, documento e endereço. Sem userId — a conta vem
 * da sessão.
 */
export const completarCadastroSchema = registerSchema.pick({
  phone: true,
  document: true,
  cep: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
});

/** Campos da 1ª etapa do cadastro — a tela volta para ela quando o erro é aqui. */
export const REGISTER_STEP1_FIELDS = ["name", "phone", "email", "password", "storeName"] as const;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

// IMPORTANTE: NÃO existe campo userId/ownerId aqui.
// A identidade vem da sessão. Mesmo que o cliente envie userId, é ignorado.
export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  cpf: cpfSchema.optional(),
  phone: phoneSchema.optional(),
});

// Para o checkout: o cliente só pode mandar productId + quantidade.
// O PREÇO é buscado no banco no servidor. Nunca aceite preço do frontend.
export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
});

// Schemas de produto (painel admin). priceCents é inteiro (centavos).
export const createProductSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  priceCents: z.number().int().min(1).max(100_000_000),
  imageUrl: z.string().trim().url().max(2000).optional(),
  active: z.boolean().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// Configurações da loja (painel admin). Segredos opcionais: em branco = manter.
const gatewaySR = z.string().trim().max(20);
const regraSmartRouting = z.object({
  condicional: z.object({
    ativo: z.boolean(),
    minCents: z.number().int().min(0).max(100_000_000),
    gateway: z.union([gatewaySR, z.literal("")]),
  }),
  distribuicao: z.object({
    ativo: z.boolean(),
    fatias: z.array(z.object({ g: gatewaySR, p: z.number().int().min(0).max(100) })).max(MAX_GATEWAYS),
  }),
  retentativa: z.object({ ativo: z.boolean(), gateways: z.array(gatewaySR).max(MAX_RETENTATIVA) }).optional(),
});

const tempoEmail = (k: KindTempo) => z.number().int().min(TEMPOS_EMAIL[k].min).max(TEMPOS_EMAIL[k].max).optional();

export const updateSettingsSchema = z.object({
  storeName: z.string().trim().min(1).max(100).optional(),
  shopifyStoreDomain: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/, {
          message: "Domínio Shopify inválido (ex.: sua-loja.myshopify.com)",
        }),
    ])
    .optional(),
  shopifyOrderSyncEnabled: z.boolean().optional(),
  shopifyAdminToken: z.string().trim().max(500).optional(),
  shopifyWebhookSecret: z.string().trim().max(500).optional(),
  shopifyApiKey: z.string().trim().max(200).optional(),
  shopifyApiSecret: z.string().trim().max(200).optional(),
  mpAccessToken: z.string().trim().max(500).optional(),
  mpPublicKey: z.string().trim().max(255).optional(),
  paymentProvider: z.enum(["mercadopago"]).optional(),
  mpPixEnabled: z.boolean().optional(),
  mpCardEnabled: z.boolean().optional(),
  pinpaySecret: z.string().trim().max(500).optional(),
  pinpayPublicKey: z.string().trim().max(255).optional(),
  pinpayPixEnabled: z.boolean().optional(),
  appmaxClientId: z.string().trim().max(500).optional(),
  appmaxClientSecret: z.string().trim().max(500).optional(),
  appmaxAppId: z.string().trim().max(191).optional(),
  appmaxPartnerClientId: z.string().trim().max(191).optional(),
  appmaxPartnerClientSecret: z.string().trim().max(500).optional(),
  appmaxPixEnabled: z.boolean().optional(),
  appmaxCardEnabled: z.boolean().optional(),
  appmaxSandbox: z.boolean().optional(),
  utmifyApiToken: z.string().trim().max(500).optional(),
  utmifyEnabled: z.boolean().optional(),
  freepayPublicKey: z.string().trim().max(500).optional(),
  freepaySecretKey: z.string().trim().max(500).optional(),
  freepayCompanyId: z.string().trim().max(191).optional(),
  freepayPixEnabled: z.boolean().optional(),
  freepayCardEnabled: z.boolean().optional(),
  wappiPublicKey: z.string().trim().max(500).optional(),
  wappiSecretKey: z.string().trim().max(500).optional(),
  wappiPixEnabled: z.boolean().optional(),
  wappiCardEnabled: z.boolean().optional(),
  hypercashSecretKey: z.string().trim().max(500).optional(),
  hypercashPublicKey: z.string().trim().max(255).optional(),
  hypercashPixEnabled: z.boolean().optional(),
  hypercashCardEnabled: z.boolean().optional(),
  beehiveSecretKey: z.string().trim().max(500).optional(),
  beehivePublicKey: z.string().trim().max(255).optional(),
  beehivePixEnabled: z.boolean().optional(),
  beehiveCardEnabled: z.boolean().optional(),
  // PagNiv: chave de API (X-API-Key) + secret HMAC do webhook. Não há public
  // key aqui — ela vem de GET /v1/charges/card-config, por exigência da doc.
  // Vext: chave secreta (sk_live_/sk_test_) + segredo de assinatura do webhook.
  // Só Pix — não há toggle de cartão.
  vextApiKey: z.string().trim().max(500).optional(),
  vextWebhookSecret: z.string().trim().max(500).optional(),
  vextPixEnabled: z.boolean().optional(),
  // BlackCat: só a API Key (header X-API-Key). Webhook sem assinatura, então
  // não há segredo a guardar.
  blackcatApiKey: z.string().trim().max(500).optional(),
  blackcatPixEnabled: z.boolean().optional(),
  blackcatCardEnabled: z.boolean().optional(),
  // Pagar.me: só a chave secreta (sk_live_/sk_test_). Webhook cadastrado no
  // painel deles, sem assinatura.
  pagarmeSecretKey: z.string().trim().max(500).optional(),
  pagarmePixEnabled: z.boolean().optional(),
  pagarmeCardEnabled: z.boolean().optional(),
  // VeoPag: client_id + client_secret (viram um JWT de 1h) e a Webhook
  // Signature opcional, que autentica o postback por HMAC.
  veopagClientId: z.string().trim().max(500).optional(),
  veopagClientSecret: z.string().trim().max(500).optional(),
  veopagWebhookSecret: z.string().trim().max(500).optional(),
  veopagPixEnabled: z.boolean().optional(),
  veopagCardEnabled: z.boolean().optional(),
  // MangoFy: API Key (header Authorization, sem "Bearer") + Store Code (header
  // Store-Code). Webhook sem assinatura.
  mangofyApiKey: z.string().trim().max(500).optional(),
  mangofyStoreCode: z.string().trim().max(200).optional(),
  mangofyPixEnabled: z.boolean().optional(),
  mangofyCardEnabled: z.boolean().optional(),
  // Nuvra: API Key (Bearer nvr_live_/nvr_dev_) + segredo HMAC do webhook, que é
  // cadastrado no painel deles. Sem public key: vem de /card-tokenization.
  nuvraApiKey: z.string().trim().max(500).optional(),
  nuvraWebhookSecret: z.string().trim().max(500).optional(),
  nuvraPixEnabled: z.boolean().optional(),
  nuvraCardEnabled: z.boolean().optional(),
  // Blue Vision (Wishpag): secret_key (Basic base64("sk:x")) + webhook secret do
  // HMAC, que vem do painel deles (Configurações → Webhooks).
  bluevisionSecretKey: z.string().trim().max(500).optional(),
  bluevisionWebhookSecret: z.string().trim().max(500).optional(),
  bluevisionPixEnabled: z.boolean().optional(),
  bluevisionCardEnabled: z.boolean().optional(),
  pagnivApiKey: z.string().trim().max(500).optional(),
  pagnivWebhookSecret: z.string().trim().max(500).optional(),
  pagnivPixEnabled: z.boolean().optional(),
  pagnivCardEnabled: z.boolean().optional(),
  fintpagSecretKey: z.string().trim().max(500).optional(),
  fintpagPublicKey: z.string().trim().max(255).optional(),
  fintpagPixEnabled: z.boolean().optional(),
  fintpagCardEnabled: z.boolean().optional(),
  hylexpaySecretKey: z.string().trim().max(500).optional(),
  hylexpayPublicKey: z.string().trim().max(255).optional(),
  hylexpayPixEnabled: z.boolean().optional(),
  hylexpayCardEnabled: z.boolean().optional(),
  pixgoApiKey: z.string().trim().max(255).optional(),
  pixgoWebhookSecret: z.string().trim().max(255).optional(),
  pixgoPixEnabled: z.boolean().optional(),
  // MushPag: só a chave de API, o par "{prefixo}.{segredo}" do Bearer. O segredo
  // do webhook não é digitado: o teste da chave cadastra o endpoint pela API e
  // grava o segredo que volta. Só Pix, sem toggle de cartão.
  mushpagApiKey: z.string().trim().max(500).optional(),
  mushpagPixEnabled: z.boolean().optional(),
  // Pagou.ai: token Bearer + ambiente (sandbox x produção, bases diferentes).
  pagouApiToken: z.string().trim().max(500).optional(),
  pagouSandbox: z.boolean().optional(),
  pagouPixEnabled: z.boolean().optional(),
  pagouPublicKey: z.string().trim().max(255).optional(),
  pagouCardEnabled: z.boolean().optional(),
  // PushinPay: token Bearer + o token opcional do header `x-pushinpay-token`
  // (autentica o webhook). Só Pix — a API deles não processa cartão.
  pushinpayToken: z.string().trim().max(500).optional(),
  pushinpayWebhookToken: z.string().trim().max(500).optional(),
  pushinpayPixEnabled: z.boolean().optional(),
  // Taxas de parcelamento por loja: { "2": 0.1138, ... } (decimais 0..<1) + fixo em centavos.
  cardInstallmentFees: z.record(z.string(), z.number().min(0).max(0.95)).optional(),
  cardInstallmentFixedCents: z.number().int().min(0).max(100000).optional(),
  // Juros de UM gateway (1x a 12x + fixo), editados na página dele. A chave do
  // gateway é conferida contra a lista dos que fazem cartão.
  cardInstallmentFeesGateway: z
    .object({
      gateway: z.enum(["appmax", "freepay", "hypercash", "fintpag", "hylexpay", "beehive", "pagniv", "blackcat", "pagarme", "veopag", "mangofy", "nuvra", "bluevision", "pagou", "wappi", "mercadopago"]),
      rates: z.record(z.string(), z.number().min(0).max(0.95)).optional(),
      fixedCents: z.number().int().min(0).max(100000).optional(),
      reset: z.boolean().optional(),
    })
    .optional(),
  // Pix de ticket alto: gateway alternativo acima de um valor (em centavos).
  pixHighValueEnabled: z.boolean().optional(),
  pixHighValueProvider: z.string().trim().max(20).optional(),
  pixHighValueMinCents: z.number().int().min(0).max(100_000_000).optional(),
  splitEnabled: z.boolean().optional(),
  splitGatewayA: z.string().trim().max(20).optional(),
  splitGatewayB: z.string().trim().max(20).optional(),
  splitPercentA: z.number().int().min(0).max(100).optional(),
  // Smart Routing: Pix e cartão separados, dois modos por método. As regras de
  // negócio (soma 100%, 2 a 4 gateways sem repetir) são as de validarRegra.
  smartRouting: z
    .object({ pix: regraSmartRouting, cartao: regraSmartRouting })
    .superRefine((v, ctx) => {
      const erro = validarRegra(v.pix, "Pix") ?? validarRegra(v.cartao, "Cartão");
      if (erro) ctx.addIssue({ code: z.ZodIssueCode.custom, message: erro });
    })
    .optional(),
  resendApiKey: z.string().trim().max(500).optional(),
  resendFromEmail: z.union([z.literal(""), z.string().trim().email().max(255)]).optional(),
  resendEnabled: z.boolean().optional(),
  // Interruptor de CADA e-mail transacional. Ausente = não mexe no que está
  // salvo (o servidor trata ausência como "manter", não como "desligar").
  emailPixEnabled: z.boolean().optional(),
  emailPaidEnabled: z.boolean().optional(),
  emailSeparationEnabled: z.boolean().optional(),
  emailTrackingEnabled: z.boolean().optional(),
  emailRecoveryEnabled: z.boolean().optional(),
  emailPixRecoveryEnabled: z.boolean().optional(),
  // Minutos de espera de cada e-mail; os limites moram em email-tempos.ts.
  emailTempos: z
    .object({
      pix: tempoEmail("pix"),
      paid: tempoEmail("paid"),
      separation: tempoEmail("separation"),
      tracking: tempoEmail("tracking"),
      recovery: tempoEmail("recovery"),
      pixrecovery: tempoEmail("pixrecovery"),
    })
    .optional(),
  waPhoneNumberId: z.string().trim().max(64).optional(),
  waAccessToken: z.string().trim().max(2000).optional(),
  waBusinessAccountId: z.string().trim().max(64).optional(),
  waDisplayPhone: z.string().trim().max(32).optional(),
  waEnabled: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

// Parâmetros de rastreio (UTMs) capturados no checkout — enviados à Utmify.
// Tudo opcional; o cliente pode não ter vindo de um anúncio.
export const trackingSchema = z
  .object({
    utm_source: z.string().trim().max(255).nullish(),
    utm_medium: z.string().trim().max(255).nullish(),
    utm_campaign: z.string().trim().max(255).nullish(),
    utm_content: z.string().trim().max(255).nullish(),
    utm_term: z.string().trim().max(255).nullish(),
    src: z.string().trim().max(255).nullish(),
    sck: z.string().trim().max(255).nullish(),
  })
  .optional();

// Quem é o visitante no Google Analytics: `ga_cid` (client_id) e `ga_sid_<ID>`
// (session_id de cada ID da loja). Separado do `tracking` porque aquele também
// vai para os gateways, e isto só interessa ao nosso envio da compra
// (lib/ga4-compra). `.catch`: dado de medição estranho é ignorado, nunca pode
// recusar a venda.
export const visitaGa4Schema = z
  .record(z.string().regex(/^ga_(cid|sid_G-[A-Z0-9]{4,20})$/), z.string().regex(/^[0-9.]{1,40}$/))
  .refine((v) => Object.keys(v).length <= 10)
  .optional()
  .catch(undefined);

// O mesmo para a compra na Meta pelo servidor (lib/meta-compra): os cookies do
// pixel e o navegador, que a Meta exige em evento vindo de site.
export const visitaMetaSchema = z
  .object({
    fbp: z.string().regex(/^fb\.[\w.-]{1,250}$/).optional(),
    fbc: z.string().regex(/^fb\.[\w.-]{1,250}$/).optional(),
    ua: z.string().max(255).optional(),
  })
  .optional()
  .catch(undefined);

// Cobrança Pix (checkout público de visitante). O cliente só manda productId +
// quantidade + seus dados; PREÇO e total são recalculados no servidor (regra de
// ouro). CPF é exigido pela Transfyre (customer.document) e validado de verdade.
export const pixChargeSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    cpf: cpfSchema,
    phone: phoneSchema,
  }),
  couponCode: z.string().trim().max(64).optional(),
  shippingOptionId: z.string().max(24).optional(),
  pixBoost: z.boolean().optional(),
  // Vincula a cobrança ao carrinho abandonado (para marcá-lo como convertido).
  sessionId: z.string().trim().max(191).optional(),
  // Google Click ID (atribuição de conversão do Google Ads). nullish: o front
  // pode mandar null quando o cliente não veio de um anúncio.
  gclid: z.string().trim().max(512).nullish(),
  tracking: trackingSchema,
  ga4: visitaGa4Schema,
  meta: visitaMetaSchema,
  address: z
    .object({
      cep: z.string().max(12).optional(),
      street: z.string().max(160).optional(),
      number: z.string().max(20).optional(),
      neighborhood: z.string().max(120).optional(),
      complement: z.string().max(160).optional(),
      city: z.string().max(120).optional(),
      uf: z.string().max(4).optional(),
    })
    .optional(),
});

export type PixChargeInput = z.infer<typeof pixChargeSchema>;

// Cobrança de CARTÃO (Mercado Pago). O cartão é tokenizado no navegador (SDK do
// MP); aqui só chega o token + método/parcelas — nunca o número do cartão.
export const cardChargeSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(50),
  customer: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    cpf: cpfSchema,
    phone: phoneSchema,
  }),
  couponCode: z.string().trim().max(64).optional(),
  shippingOptionId: z.string().max(24).optional(),
  sessionId: z.string().trim().max(191).optional(),
  gclid: z.string().trim().max(512).nullish(),
  tracking: trackingSchema,
  ga4: visitaGa4Schema,
  meta: visitaMetaSchema,
  address: z
    .object({
      cep: z.string().max(12).optional(),
      street: z.string().max(160).optional(),
      number: z.string().max(20).optional(),
      neighborhood: z.string().max(120).optional(),
      complement: z.string().max(160).optional(),
      city: z.string().max(120).optional(),
      uf: z.string().max(4).optional(),
    })
    .optional(),
  // O cartão chega de duas formas, conforme o provedor da loja:
  //  - Mercado Pago: token gerado no NAVEGADOR (token + paymentMethodId).
  //  - Appmax: transparente — os dados do cartão vão ao servidor e são
  //    repassados via TLS (nunca gravados/logados). Aceita `token` também,
  //    para quando a tokenização no navegador (Appmax JS) for ativada.
  card: z.object({
    // Token do cartão. A FastSoft/HyperCash devolve um blob criptografado longo
    // (bem mais que 200 chars), então o limite acompanha o do `hash`.
    token: z.string().min(1).max(10000).optional(),
    // Hash tokenizado do cartão (FintPag/Shield: SDK /v1/js). Quando presente, o
    // cartão NÃO é enviado cru — só o hash + o sessionId (fingerprint) do antifraude.
    hash: z.string().min(1).max(10000).optional(),
    // Beehive: o SDK só embute o fingerprint se ele tiver carregado. Sem esse
    // sinal, um token incompleto é indistinguível de um completo no servidor —
    // e a recusa deles ("Dados inválidos") não diz qual dos dois é.
    fingerprint: z.enum(["ok", "ausente"]).optional(),
    // Forma do retorno do `encrypt` (só nomes de campo e prefixo, nunca valor):
    // a doc promete `bhp_tok_…` e chega um blob base64, e isto diz qual dos dois
    // o SDK devolveu de verdade.
    tokenShape: z.string().max(120).optional(),
    paymentMethodId: z.string().min(1).max(40).optional(),
    issuerId: z.string().max(40).optional(),
    installments: z.number().int().min(1).max(12),
    // Impressão digital do dispositivo (antifraude do Mercado Pago) — pode ser longa.
    deviceId: z.string().max(8192).nullish(),
    // Dados brutos (Appmax). Só usados quando o provedor de cartão é a Appmax.
    number: z.string().trim().max(25).optional(),
    cvv: z.string().trim().max(5).optional(),
    expirationMonth: z.string().trim().max(2).optional(),
    expirationYear: z.string().trim().max(4).optional(),
    holderName: z.string().trim().max(120).optional(),
    // CPF do titular (Appmax). Conferido de verdade: um CPF errado aqui volta
    // do gateway como "Document number invalid" e o cliente lê como cartão
    // negado. Em branco = vale o CPF do comprador.
    holderDocument: z
      .string()
      .trim()
      .max(20)
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v === "" || isValidCPF(v), { message: "CPF do titular inválido" })
      .optional(),
    // Split de cartão: gateway escolhido pelo NAVEGADOR (validado no servidor
    // contra os 2 gateways do split da loja).
    gateway: z.string().trim().max(20).optional(),
    // Bandeira e 4 últimos dígitos, quando o SDK do gateway devolve junto com o
    // token (Payment Element da Pagou). NÃO são dados sensíveis de cartão — a
    // própria doc deles libera para "bookkeeping do seu back-end" — e são o que
    // permite ver se as recusas se concentram numa bandeira.
    brand: z.string().trim().max(30).optional(),
    last4: z.string().trim().max(4).optional(),
    // Resumo MASCARADO do cartão (lib/card-resumo.ts) — o que o painel grava
    // para reconhecer o mesmo cartão em tentativas seguidas. Nunca o número
    // inteiro nem o CVV: o formato aqui só admite 6 + 4 dígitos.
    resumo: z
      .object({
        bin: z.string().regex(/^\d{6}$/).optional(),
        last4: z.string().regex(/^\d{4}$/).optional(),
        brand: z.string().trim().max(20).optional(),
        expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/).optional(),
        expYear: z.string().regex(/^20\d{2}$/).optional(),
        holder: z.string().trim().max(120).optional(),
      })
      .optional(),
  }),
});

export type CardChargeInput = z.infer<typeof cardChargeSchema>;

// Lead / carrinho abandonado: capturado enquanto o cliente preenche o checkout.
// Tudo opcional (dados parciais); o handler exige ao menos e-mail OU telefone.
const addressSchema = z.object({
  cep: z.string().max(12).optional(),
  street: z.string().max(160).optional(),
  number: z.string().max(20).optional(),
  neighborhood: z.string().max(120).optional(),
  complement: z.string().max(160).optional(),
  city: z.string().max(120).optional(),
  uf: z.string().max(4).optional(),
});

export const leadSchema = z.object({
  sessionId: z.string().trim().min(1).max(191),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().max(254).optional(),
  cpf: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(24).optional(),
  step: z.number().int().min(1).max(4).optional(),
  address: addressSchema.optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(50)
    .optional(),
});

export type LeadInput = z.infer<typeof leadSchema>;

// Order bump: oferta de um produto extra no checkout. O preço vem do produto.
export const createOrderBumpSchema = z.object({
  productId: z.string().min(1).max(191),
  title: z.string().trim().min(2, "Informe um título").max(120),
  description: z.string().trim().max(300).optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).max(9999).optional(),
});
export const updateOrderBumpSchema = createOrderBumpSchema;

export type CreateOrderBumpInput = z.infer<typeof createOrderBumpSchema>;

// Tema de personalização do checkout (editor visual). Cores validadas como hex,
// URLs como URL, fonte de lista fechada — evita lixo/XSS no que é salvo.
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{3,8}$/, "Cor inválida")
  .max(9);

/** Cor OU vazio, para os campos em que vazio significa "herda o padrão". */
const hexColorOuVazio = z.union([z.literal(""), hexColor]);
const urlOrEmpty = z.union([z.literal(""), z.string().url().max(500)]);

export const checkoutThemeSchema = z.object({
  // Mantenha em sincronia com CHECKOUT_TEMPLATES (checkout-theme.ts): um modelo
  // que exista lá e falte aqui é aceito pelo editor e REJEITADO ao salvar.
  // Só existe o Charm. Um editor aberto antes da remoção ainda pode mandar o
  // nome de um modelo antigo: em vez de recusar o salvamento, vira "charm".
  template: z.literal("charm").catch("charm").default("charm"),
  announcementBar: z.object({
    enabled: z.boolean(),
    text: z.string().max(120),
    bg: hexColor,
    color: hexColor,
  }),
  header: z.object({
    showLogo: z.boolean(),
    logoUrl: urlOrEmpty,
    bg: hexColor,
    logoHeight: z.number().int().min(20).max(200).default(40),
    // Opcional: temas salvos antes desta opção não a têm.
    tagline: z.string().max(60).optional(),
    logoPosition: z.enum(["left", "center"]).optional(),
  }),
  banner: z.object({
    enabled: z.boolean(),
    imageUrl: urlOrEmpty,
  }),
  scarcity: z.object({
    enabled: z.boolean(),
    text: z.string().max(120),
    bg: hexColor,
    color: hexColor,
  }),
  // Opcional: temas salvos ANTES de existir esta seção não a têm, e exigi-la
  // faria toda loja antiga falhar ao salvar. mergeTheme preenche o padrão.
  urgency: z
    .object({
      enabled: z.boolean(),
      headline: z.string().max(120),
      timerEnabled: z.boolean(),
      minutes: z.number().int().min(1).max(120),
      bg: hexColor,
      color: hexColor,
    })
    .optional(),
  steps: z.object({
    identificationTitle: z.string().max(60),
    identificationSubtitle: z.string().max(160),
    ctaText: z.string().max(40),
  }),
  // Opcional pelo mesmo motivo de `urgency`: temas salvos antes desta seção não
  // a têm, e exigi-la faria toda loja antiga falhar ao salvar.
  corners: z.object({ roundness: z.number().int().min(0).max(100) }).optional(),
  // Opcional pelo mesmo motivo: temas salvos antes desta opção não a têm.
  stepBar: z.object({ mobile: z.boolean(), desktop: z.boolean() }).optional(),
  summary: z.object({
    title: z.string().max(60),
    // Opcional: temas salvos antes desta opção não a têm. `showCoupon`, que
    // vivia aqui, foi removido — o Zod ignora chaves desconhecidas, então um
    // tema antigo continua salvando sem erro.
    startOpen: z.boolean().optional(),
  }),
  seo: z.object({
    title: z.string().max(60),
    faviconUrl: urlOrEmpty,
  }),
  shipping: z.object({
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(24),
          enabled: z.boolean(),
          name: z.string().min(1).max(60),
          eta: z.string().max(60),
          priceCents: z.number().int().min(0).max(10_000_000),
          // "" = sem ícone. Precisa ser aceito aqui, senão o servidor recusa a
          // opção "Nenhum" escolhida no editor.
          carrier: z.enum(["", "correios", "sedex", "full", "transportadora", "expresso"]),
        }),
      )
      .min(1)
      .max(6),
  }),
  colors: z.object({
    primary: hexColor,
    buttonText: hexColor,
    background: hexColor,
    // Vazio é válido e significa "herda": o botão segue a cor principal e a
    // barra do topo segue o padrão do modelo. Sem aceitar "", o lojista não
    // teria como DESFAZER uma cor escolhida por engano.
    button: hexColorOuVazio.optional(),
    topBar: hexColorOuVazio.optional(),
    secureBadge: hexColorOuVazio.optional(),
  }),
  footer: z.object({
    text: z.string().max(200),
    showSecureBadge: z.boolean(),
    // Dados da empresa: opcionais e livres (só tamanho). A máscara de CNPJ e
    // de telefone é do editor; aqui vazio sempre passa.
    companyName: z.string().trim().max(120).optional(),
    cnpj: z.string().trim().max(20).optional(),
    address: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.string().trim().max(120).optional(),
  }),
  typography: z.object({
    fontFamily: z.enum(["Inter", "Roboto", "Poppins", "Montserrat", "Rubik", "system-ui"]),
  }),
  // `pix` removido: era editável e nenhuma tela lia. Como opcional, um tema
  // antigo que ainda mande o objeto continua salvando (o Zod descarta a chave).
  storefront: z.object({
    enabled: z.boolean(),
    title: z.string().max(60),
  }),
});

export type CheckoutTheme = z.infer<typeof checkoutThemeSchema>;

// ── Pixels de marketing (Meta/Google Ads/Google Analytics/TikTok/Taboola/Kwai/Pinterest) ──
const pixelSchema = z.object({
  id: z.string().max(191).optional(),
  type: z.enum(["meta", "google", "ga4", "tiktok", "taboola", "kwai", "pinterest"]),
  name: z.string().min(1, "Informe um nome").max(120),
  // Vai para dentro de um <script> no checkout (JSON.stringify protege as
  // aspas), mas um ID de pixel nunca tem espaço nem símbolo: restringir aqui
  // fecha a porta para colar lixo — ou código — no lugar do ID.
  pixelId: z
    .string()
    .trim()
    .min(1, "Informe o Pixel ID")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "O Pixel ID tem só letras, números, hífen ou sublinhado"),
  conversionLabel: z.string().max(120).optional(),
  accessToken: z.string().max(500).optional(),
  paidOnly: z.boolean(),
  enabled: z.boolean(),
}).refine((p) => p.type !== "taboola" || /^\d+$/.test(p.pixelId.trim()), {
  // O tfa.js da Taboola é carregado pelo número da conta (…/unip/<id>/tfa.js):
  // qualquer coisa que não seja número quebra o script sem erro visível.
  message: "Na Taboola, informe o número da conta (só dígitos)",
  path: ["pixelId"],
}).refine((p) => p.type !== "ga4" || /^G-[A-Z0-9]{4,20}$/i.test(p.pixelId), {
  // Colar outro ID do Google (AW- do Ads, GTM- do Tag Manager, UA- do Analytics
  // antigo, número da propriedade) não dá erro em lugar nenhum: o gtag aceita e
  // os dados simplesmente nunca chegam ao relatório.
  message: "No Google Analytics, informe o ID da métrica, que começa com G- (ex.: G-ABC123XYZ9)",
  path: ["pixelId"],
}).refine((p) => p.type !== "ga4" || !p.accessToken?.trim() || /^(?!G-)\S{8,200}$/i.test(p.accessToken.trim()), {
  // O Google responde 204 até para chave errada, então esta é a única conferência
  // possível: pega o erro mais comum, que é colar o ID da métrica no lugar dela.
  message: "Chave secreta inválida: copie o valor da coluna Chave secreta, no Google Analytics",
  path: ["accessToken"],
}).transform((p) => (p.type === "ga4" ? { ...p, pixelId: p.pixelId.toUpperCase() } : p));

export const updatePixelsSchema = z.object({
  pixels: z.array(pixelSchema).max(50),
});

// ── Webhooks de notificação. Vários por loja, cada um com seus eventos. ──
const webhookItemSchema = z.object({
  id: z.string().max(191).optional(),
  name: z.string().trim().min(1, "Informe o nome").max(100),
  url: z.string().trim().url().max(500),
  // Gerado no servidor; o painel só devolve o que recebeu.
  token: z.string().trim().max(64).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS as [WebhookEvent, ...WebhookEvent[]])).min(1, "Selecione ao menos um evento"),
  enabled: z.boolean(),
});

export const updateWebhooksSchema = z.object({
  webhooks: z.array(webhookItemSchema).max(20),
});

// Teste de um webhook: a URL e (opcional) o token que o destino vai validar.
export const testWebhookSchema = z.object({
  url: z.string().trim().url().max(500),
  token: z.string().trim().max(64).optional(),
});

// ── Cupons de desconto ──
const couponBase = z.object({
  code: z.string().trim().min(1, "Informe o código").max(64),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().int().positive(),
  active: z.boolean().default(true),
  minOrderCents: z.number().int().min(0).nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().max(32).nullable().optional(), // 'YYYY-MM-DD' ou null/''
});

export const createCouponSchema = couponBase.refine(
  (d) => d.type !== "PERCENT" || (d.value >= 1 && d.value <= 100),
  { message: "Percentual deve ser entre 1 e 100", path: ["value"] },
);
export const updateCouponSchema = createCouponSchema;

export const applyCouponSchema = z.object({
  code: z.string().min(1).max(64),
  subtotalCents: z.number().int().min(0).max(100000000),
});

// ── Avaliações (provas sociais) ──
const reviewBase = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  stars: z.number().int().min(1).max(5),
  text: z.string().trim().min(1, "Informe a mensagem").max(500),
  photoUrl: z.string().max(512).nullable().optional(),
  position: z.number().int().min(0).max(9999).default(0),
  active: z.boolean().default(true),
});
export const createReviewSchema = reviewBase;
export const updateReviewSchema = reviewBase;

// ── Domínio próprio ──
export const setDomainSchema = z.object({
  domain: z.string().max(255),
});
