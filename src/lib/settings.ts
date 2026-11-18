import "server-only";
import crypto from "crypto";
import { query, execute, newId } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { defaultInstallmentFees, CARD_FIXED_FEE_CENTS, type InstallmentFees } from "./checkout-helpers";
import { WEBHOOK_EVENTS, type WebhookEvent } from "./webhook-events";
import { lerSmartRouting, sortearFatia, gatewaysDaRota, gatewaysDoRoteamento, type SmartRouting, type RotaCartao } from "./smart-routing";
import { lerTempos, TEMPOS_PADRAO, type KindTempo } from "./email-tempos";

// Lê a config de parcelamento da loja (rates JSON + fixo). Só sobrescreve as
// taxas que a loja definiu; o resto continua no padrão. Sem config = padrão.
function parseInstallmentFees(s: SettingsRow | null): InstallmentFees {
  const def = defaultInstallmentFees();
  if (!s) return def;
  const rates = { ...def.rates };
  if (s.cardInstallmentFeesJson) {
    try {
      const raw = JSON.parse(s.cardInstallmentFeesJson) as Record<string, number>;
      for (let n = 2; n <= 12; n++) {
        const v = raw[String(n)];
        if (typeof v === "number" && isFinite(v) && v >= 0 && v < 1) rates[n] = v;
      }
    } catch {
      /* JSON inválido -> mantém o padrão */
    }
  }
  const fixedCents = typeof s.cardInstallmentFixedCents === "number" ? Math.max(0, s.cardInstallmentFixedCents) : CARD_FIXED_FEE_CENTS;
  return { rates, fixedCents };
}

/**
 * Tabelas de juros POR GATEWAY (`cardInstallmentFeesByGatewayJson`):
 * `{ "<gateway>": { rates: { "1": 0, ..., "12": 0.31 }, fixedCents: 299 } }`.
 * Só entram os gateways que o lojista configurou; o resto cai na tabela geral.
 * Aqui 1x conta (na tabela geral antiga começava em 2x).
 */
function parseFeesByGateway(s: SettingsRow | null): Record<string, InstallmentFees> {
  const out: Record<string, InstallmentFees> = {};
  if (!s?.cardInstallmentFeesByGatewayJson) return out;
  try {
    const raw = JSON.parse(s.cardInstallmentFeesByGatewayJson) as Record<string, { rates?: Record<string, number>; fixedCents?: number }>;
    for (const [g, cfg] of Object.entries(raw ?? {})) {
      if (!cfg || typeof cfg !== "object") continue;
      const rates: Record<number, number> = {};
      for (let n = 1; n <= 12; n++) {
        const v = cfg.rates?.[String(n)];
        rates[n] = typeof v === "number" && isFinite(v) && v >= 0 && v < 1 ? v : 0;
      }
      const fixedCents = typeof cfg.fixedCents === "number" && isFinite(cfg.fixedCents) ? Math.max(0, Math.round(cfg.fixedCents)) : CARD_FIXED_FEE_CENTS;
      out[g] = { rates, fixedCents };
    }
  } catch {
    /* JSON inválido -> nenhum gateway com tabela própria */
  }
  return out;
}

/**
 * Juros que o cartão deste pedido usa: a tabela do GATEWAY que vai cobrar, se
 * houver; senão a geral da loja (ou o padrão). O mesmo critério do checkout
 * (feesDoGateway) — a regra de ouro recalcula aqui.
 */
export async function getInstallmentFees(storeId: string, gateway?: string | null): Promise<InstallmentFees> {
  const s = await readSettings(storeId);
  return (gateway ? parseFeesByGateway(s)[gateway] : undefined) ?? parseInstallmentFees(s);
}

// Configurações POR LOJA (1:1 com `stores`, chave = storeId). Segredos guardados
// CRIPTOGRAFADOS (AES-256-GCM); nunca em texto puro. O nome da loja vive em
// `stores.name` (fonte única). Todas as funções recebem o storeId do chamador
// (resolvido pela loja ativa do painel ou pelo domínio no checkout público).

interface SettingsRow {
  storeId: string;
  storeName: string;
  shopifyStoreDomain: string | null;
  shopifyOrderSyncEnabled: number;
  shopifyAdminTokenEnc: string | null;
  shopifyWebhookSecretEnc: string | null;
  shopifyApiKeyEnc: string | null;
  shopifyApiSecretEnc: string | null;
  mpAccessTokenEnc: string | null;
  mpPublicKey: string | null;
  paymentProvider: string | null;
  mpPixEnabled: number;
  mpCardEnabled: number;
  pinpaySecretEnc: string | null;
  pinpayPublicKey: string | null;
  pinpayPixEnabled: number;
  resendApiKeyEnc: string | null;
  resendFromEmail: string | null;
  resendEnabled: number;
  emailPixEnabled: number;
  emailPaidEnabled: number;
  emailSeparationEnabled: number;
  emailTrackingEnabled: number;
  emailRecoveryEnabled: number;
  emailRecoveryEnabledAt: string | Date | null;
  emailPixRecoveryEnabled: number;
  emailPixRecoveryEnabledAt: string | Date | null;
  appmaxClientIdEnc: string | null;
  appmaxClientSecretEnc: string | null;
  appmaxMerchantClientIdEnc: string | null;
  appmaxMerchantClientSecretEnc: string | null;
  appmaxExternalId: string | null;
  appmaxAppId: string | null;
  appmaxPartnerClientId: string | null;
  appmaxPartnerClientSecretEnc: string | null;
  appmaxPixEnabled: number;
  appmaxCardEnabled: number;
  appmaxSandbox: number;
  utmifyApiTokenEnc: string | null;
  utmifyEnabled: number;
  freepayPublicKeyEnc: string | null;
  freepaySecretKeyEnc: string | null;
  freepayCompanyId: string | null;
  freepayPixEnabled: number;
  freepayCardEnabled: number;
  hypercashSecretKeyEnc: string | null;
  hypercashPublicKey: string | null;
  hypercashPixEnabled: number;
  hypercashCardEnabled: number;
  fintpagSecretKeyEnc: string | null;
  fintpagPublicKey: string | null;
  fintpagPixEnabled: number;
  fintpagCardEnabled: number;
  hylexpaySecretKeyEnc: string | null;
  hylexpayPublicKey: string | null;
  hylexpayPixEnabled: number;
  hylexpayCardEnabled: number;
  beehiveSecretKeyEnc: string | null;
  beehivePublicKey: string | null;
  beehivePixEnabled: number;
  beehiveCardEnabled: number;
  pagnivApiKeyEnc: string | null;
  pagnivWebhookSecretEnc: string | null;
  pagnivPixEnabled: number;
  pagnivCardEnabled: number;
  vextApiKeyEnc: string | null;
  vextWebhookSecretEnc: string | null;
  vextPixEnabled: number;
  blackcatApiKeyEnc: string | null;
  blackcatPixEnabled: number;
  blackcatCardEnabled: number;
  pagarmeSecretKeyEnc: string | null;
  pagarmePixEnabled: number;
  pagarmeCardEnabled: number;
  veopagClientIdEnc: string | null;
  veopagClientSecretEnc: string | null;
  veopagWebhookSecretEnc: string | null;
  veopagPixEnabled: number;
  veopagCardEnabled: number;
  mangofyApiKeyEnc: string | null;
  mangofyStoreCode: string | null;
  mangofyPixEnabled: number;
  mangofyCardEnabled: number;
  pixgoApiKeyEnc: string | null;
  pixgoWebhookSecretEnc: string | null;
  pixgoPixEnabled: number;
  mushpagApiKeyEnc: string | null;
  mushpagWebhookSecretEnc: string | null;
  mushpagPixEnabled: number;
  pagouApiTokenEnc: string | null;
  pagouSandbox: number;
  pagouPixEnabled: number;
  pagouPublicKey: string | null;
  pagouCardEnabled: number;
  pushinpayTokenEnc: string | null;
  pushinpayWebhookTokenEnc: string | null;
  pushinpayPixEnabled: number;
  nuvraApiKeyEnc: string | null;
  nuvraWebhookSecretEnc: string | null;
  nuvraPixEnabled: number;
  nuvraCardEnabled: number;
  bluevisionSecretKeyEnc: string | null;
  bluevisionWebhookSecretEnc: string | null;
  bluevisionPixEnabled: number;
  bluevisionCardEnabled: number;
  wappiPublicKeyEnc: string | null;
  wappiSecretKeyEnc: string | null;
  wappiCompanyId: string | null;
  wappiPixEnabled: number;
  wappiCardEnabled: number;
  cardInstallmentFeesJson: string | null;
  cardInstallmentFixedCents: number | null;
  cardInstallmentFeesByGatewayJson: string | null;
  splitEnabled: number;
  splitGatewayA: string | null;
  splitGatewayB: string | null;
  splitPercentA: number;
  pixHighValueEnabled: number;
  pixHighValueProvider: string | null;
  pixHighValueMinCents: number | null;
  smartRoutingJson: string | null;
  waPhoneNumberId: string | null;
  waAccessTokenEnc: string | null;
  waBusinessAccountId: string | null;
  waDisplayPhone: string | null;
  waEnabled: number;
}

async function readSettings(storeId: string): Promise<SettingsRow | null> {
  const rows = await query<SettingsRow>(
    `SELECT ss.storeId, s.name AS storeName,
            ss.shopifyStoreDomain, ss.shopifyOrderSyncEnabled,
            ss.shopifyAdminTokenEnc, ss.shopifyWebhookSecretEnc,
            ss.shopifyApiKeyEnc, ss.shopifyApiSecretEnc,
            ss.mpAccessTokenEnc, ss.mpPublicKey, ss.paymentProvider,
            ss.mpPixEnabled, ss.mpCardEnabled,
            ss.pinpaySecretEnc, ss.pinpayPublicKey, ss.pinpayPixEnabled,
            ss.resendApiKeyEnc, ss.resendFromEmail, ss.resendEnabled,
            ss.emailPixEnabled, ss.emailPaidEnabled, ss.emailSeparationEnabled, ss.emailTrackingEnabled,
            ss.emailRecoveryEnabled, ss.emailRecoveryEnabledAt,
            ss.emailPixRecoveryEnabled, ss.emailPixRecoveryEnabledAt,
            ss.appmaxClientIdEnc, ss.appmaxClientSecretEnc,
            ss.appmaxMerchantClientIdEnc, ss.appmaxMerchantClientSecretEnc, ss.appmaxExternalId,
            ss.appmaxAppId, ss.appmaxPartnerClientId, ss.appmaxPartnerClientSecretEnc,
            ss.appmaxPixEnabled, ss.appmaxCardEnabled, ss.appmaxSandbox,
            ss.utmifyApiTokenEnc, ss.utmifyEnabled,
            ss.freepayPublicKeyEnc, ss.freepaySecretKeyEnc, ss.freepayCompanyId,
            ss.freepayPixEnabled, ss.freepayCardEnabled,
            ss.hypercashSecretKeyEnc, ss.hypercashPublicKey, ss.hypercashPixEnabled, ss.hypercashCardEnabled,
            ss.fintpagSecretKeyEnc, ss.fintpagPublicKey, ss.fintpagPixEnabled, ss.fintpagCardEnabled,
            ss.hylexpaySecretKeyEnc, ss.hylexpayPublicKey, ss.hylexpayPixEnabled, ss.hylexpayCardEnabled,
            ss.beehiveSecretKeyEnc, ss.beehivePublicKey, ss.beehivePixEnabled, ss.beehiveCardEnabled,
            ss.pagnivApiKeyEnc, ss.pagnivWebhookSecretEnc, ss.pagnivPixEnabled, ss.pagnivCardEnabled,
            ss.vextApiKeyEnc, ss.vextWebhookSecretEnc, ss.vextPixEnabled,
            ss.blackcatApiKeyEnc, ss.blackcatPixEnabled, ss.blackcatCardEnabled,
            ss.pagarmeSecretKeyEnc, ss.pagarmePixEnabled, ss.pagarmeCardEnabled,
            ss.veopagClientIdEnc, ss.veopagClientSecretEnc, ss.veopagWebhookSecretEnc, ss.veopagPixEnabled, ss.veopagCardEnabled,
            ss.mangofyApiKeyEnc, ss.mangofyStoreCode, ss.mangofyPixEnabled, ss.mangofyCardEnabled,
            ss.pixgoApiKeyEnc, ss.pixgoWebhookSecretEnc, ss.pixgoPixEnabled,
            ss.mushpagApiKeyEnc, ss.mushpagWebhookSecretEnc, ss.mushpagPixEnabled,
            ss.pagouApiTokenEnc, ss.pagouSandbox, ss.pagouPixEnabled,
            ss.pagouPublicKey, ss.pagouCardEnabled,
            ss.pushinpayTokenEnc, ss.pushinpayWebhookTokenEnc, ss.pushinpayPixEnabled,
            ss.nuvraApiKeyEnc, ss.nuvraWebhookSecretEnc, ss.nuvraPixEnabled, ss.nuvraCardEnabled,
            ss.bluevisionSecretKeyEnc, ss.bluevisionWebhookSecretEnc, ss.bluevisionPixEnabled, ss.bluevisionCardEnabled,
            ss.wappiPublicKeyEnc, ss.wappiSecretKeyEnc, ss.wappiCompanyId, ss.wappiPixEnabled, ss.wappiCardEnabled,
            ss.cardInstallmentFeesJson, ss.cardInstallmentFixedCents, ss.cardInstallmentFeesByGatewayJson,
            ss.splitEnabled, ss.splitGatewayA, ss.splitGatewayB, ss.splitPercentA,
            ss.pixHighValueEnabled, ss.pixHighValueProvider, ss.pixHighValueMinCents, ss.smartRoutingJson,
            ss.waPhoneNumberId, ss.waAccessTokenEnc, ss.waBusinessAccountId, ss.waDisplayPhone, ss.waEnabled
     FROM store_settings ss JOIN stores s ON s.id = ss.storeId
     WHERE ss.storeId = ? LIMIT 1`,
    [storeId],
  );
  return rows[0] ?? null;
}

// Transfyre e InfinitePay foram removidas (02/10/2026, decisão do dono). As
// colunas continuam no banco, só não são mais lidas.
export type PaymentProvider = "mercadopago" | "pinpay" | "appmax" | "freepay" | "hypercash" | "fintpag" | "hylexpay" | "beehive" | "pagniv" | "vext" | "blackcat" | "pagarme" | "veopag" | "mangofy" | "nuvra" | "bluevision" | "pixgo" | "mushpag" | "pagou" | "pushinpay" | "wappi";
export type CardProvider = "mercadopago" | "appmax" | "freepay" | "hypercash" | "fintpag" | "hylexpay" | "beehive" | "pagniv" | "blackcat" | "pagarme" | "veopag" | "mangofy" | "nuvra" | "bluevision" | "pagou" | "wappi";

/**
 * Roteamento de pagamento por MÉTODO, conforme os toggles da loja:
 *  - pixProvider: qual gateway processa o Pix (ordem fixa de prioridade abaixo).
 *  - cardProvider: quem processa o CARTÃO (todos transparentes/tokenizados).
 */
export async function getPaymentRouting(storeId: string): Promise<{ pixProvider: PaymentProvider | null; cardEnabled: boolean; cardProvider: CardProvider | null }> {
  const s = await readSettings(storeId);
  const mpPix = (s?.mpPixEnabled ?? 0) === 1 && !!s?.mpAccessTokenEnc;
  const pinpayPix = (s?.pinpayPixEnabled ?? 0) === 1 && !!s?.pinpaySecretEnc;
  // App PARCEIRO ou integração direta — a regra mora em `appmaxCredPar`.
  const appmaxOk = appmaxCredPar(s) !== null;
  const appmaxPix = (s?.appmaxPixEnabled ?? 0) === 1 && appmaxOk;
  const freepayOk = !!s?.freepayPublicKeyEnc && !!s?.freepaySecretKeyEnc;
  const freepayPix = (s?.freepayPixEnabled ?? 0) === 1 && freepayOk;
  const hypercashOk = !!s?.hypercashSecretKeyEnc;
  const hypercashPix = (s?.hypercashPixEnabled ?? 0) === 1 && hypercashOk;
  const fintpagOk = !!s?.fintpagSecretKeyEnc;
  const fintpagPix = (s?.fintpagPixEnabled ?? 0) === 1 && fintpagOk;
  const hylexpayOk = !!s?.hylexpaySecretKeyEnc;
  const hylexpayPix = (s?.hylexpayPixEnabled ?? 0) === 1 && hylexpayOk;
  const beehiveOk = !!s?.beehiveSecretKeyEnc;
  const beehivePix = (s?.beehivePixEnabled ?? 0) === 1 && beehiveOk;
  const pagnivOk = !!s?.pagnivApiKeyEnc;
  const pagnivPix = (s?.pagnivPixEnabled ?? 0) === 1 && pagnivOk;
  // Vext é só Pix — não existe toggle de cartão.
  const vextPix = (s?.vextPixEnabled ?? 0) === 1 && !!s?.vextApiKeyEnc;
  const blackcatOk = !!s?.blackcatApiKeyEnc;
  const blackcatPix = (s?.blackcatPixEnabled ?? 0) === 1 && blackcatOk;
  const pagarmeOk = !!s?.pagarmeSecretKeyEnc;
  const pagarmePix = (s?.pagarmePixEnabled ?? 0) === 1 && pagarmeOk;
  const veopagOk = !!s?.veopagClientIdEnc && !!s?.veopagClientSecretEnc;
  const veopagPix = (s?.veopagPixEnabled ?? 0) === 1 && veopagOk;
  const mangofyOk = !!s?.mangofyApiKeyEnc && !!s?.mangofyStoreCode;
  const mangofyPix = (s?.mangofyPixEnabled ?? 0) === 1 && mangofyOk;
  const nuvraOk = !!s?.nuvraApiKeyEnc;
  const nuvraPix = (s?.nuvraPixEnabled ?? 0) === 1 && nuvraOk;
  const bluevisionOk = !!s?.bluevisionSecretKeyEnc;
  const bluevisionPix = (s?.bluevisionPixEnabled ?? 0) === 1 && bluevisionOk;
  const pixgoPix = (s?.pixgoPixEnabled ?? 0) === 1 && !!s?.pixgoApiKeyEnc;
  // MushPag é só Pix — não existe toggle de cartão.
  const mushpagPix = (s?.mushpagPixEnabled ?? 0) === 1 && !!s?.mushpagApiKeyEnc;
  const pagouPix = (s?.pagouPixEnabled ?? 0) === 1 && !!s?.pagouApiTokenEnc;
  const pushinpayPix = (s?.pushinpayPixEnabled ?? 0) === 1 && !!s?.pushinpayTokenEnc;
  const wappiOk = !!s?.wappiPublicKeyEnc && !!s?.wappiSecretKeyEnc;
  const wappiPix = (s?.wappiPixEnabled ?? 0) === 1 && wappiOk;
  const wappiCard = (s?.wappiCardEnabled ?? 0) === 1 && wappiOk; // cartão raw (transparente)
  // Cartão na Pagou exige a PUBLIC KEY: quem tokeniza é o Payment Element, no
  // navegador. Sem ela o checkout não tem como montar o campo do cartão.
  const pagouCard = (s?.pagouCardEnabled ?? 0) === 1 && !!s?.pagouApiTokenEnc && !!s?.pagouPublicKey;
  const mpCard = (s?.mpCardEnabled ?? 0) === 1 && !!s?.mpAccessTokenEnc && !!s?.mpPublicKey;
  const appmaxCard = (s?.appmaxCardEnabled ?? 0) === 1 && appmaxOk;
  const freepayCard = (s?.freepayCardEnabled ?? 0) === 1 && freepayOk;
  // Cartão HyperCash exige a public key (tokenização no navegador).
  const hypercashCard = (s?.hypercashCardEnabled ?? 0) === 1 && hypercashOk && !!s?.hypercashPublicKey;
  const fintpagCard = (s?.fintpagCardEnabled ?? 0) === 1 && fintpagOk; // cartão raw (transparente)
  const hylexpayCard = (s?.hylexpayCardEnabled ?? 0) === 1 && hylexpayOk; // cartão raw (transparente)
  // Cartão Beehive exige a chave PÚBLICA: é com ela que o navegador tokeniza em
  // /v1/card-token. Sem ela não há token, e sem token a API recusa a cobrança.
  const beehiveCard = (s?.beehiveCardEnabled ?? 0) === 1 && beehiveOk && !!s?.beehivePublicKey;
  // Cartão PagNiv NÃO tem coluna de public key: a chave e a URL de tokenização
  // vêm da API deles (/charges/card-config), por exigência da doc.
  const pagnivCard = (s?.pagnivCardEnabled ?? 0) === 1 && pagnivOk;
  const blackcatCard = (s?.blackcatCardEnabled ?? 0) === 1 && blackcatOk; // cartão raw (direto)
  const pagarmeCard = (s?.pagarmeCardEnabled ?? 0) === 1 && pagarmeOk; // cartão raw (direto)
  const veopagCard = (s?.veopagCardEnabled ?? 0) === 1 && veopagOk; // cartão raw (direto)
  const mangofyCard = (s?.mangofyCardEnabled ?? 0) === 1 && mangofyOk; // cartão raw (direto)
  // Cartão Nuvra: token (navegador). Como na PagNiv, a chave e a URL de
  // tokenização vêm da API deles (/card-tokenization), sem coluna própria.
  const nuvraCard = (s?.nuvraCardEnabled ?? 0) === 1 && nuvraOk;
  const bluevisionCard = (s?.bluevisionCardEnabled ?? 0) === 1 && bluevisionOk; // cartão raw (tokenizado no servidor)
  // Cartão: Appmax > Freepay > FintPag > HylexPay > HyperCash > Beehive > PagNiv > BlackCat > Pagar.me > VeoPag > MangoFy > Nuvra > Blue Vision > Pagou > Wappi > Mercado Pago.
  const cardProvider: CardProvider | null =
    appmaxCard ? "appmax" : freepayCard ? "freepay" : fintpagCard ? "fintpag" : hylexpayCard ? "hylexpay" : hypercashCard ? "hypercash" : beehiveCard ? "beehive" : pagnivCard ? "pagniv" : blackcatCard ? "blackcat" : pagarmeCard ? "pagarme" : veopagCard ? "veopag" : mangofyCard ? "mangofy" : nuvraCard ? "nuvra" : bluevisionCard ? "bluevision" : pagouCard ? "pagou" : wappiCard ? "wappi" : mpCard ? "mercadopago" : null;
  return {
    pixProvider: mpPix ? "mercadopago" : pinpayPix ? "pinpay" : appmaxPix ? "appmax" : freepayPix ? "freepay" : hypercashPix ? "hypercash" : fintpagPix ? "fintpag" : hylexpayPix ? "hylexpay" : beehivePix ? "beehive" : pagnivPix ? "pagniv" : vextPix ? "vext" : blackcatPix ? "blackcat" : pagarmePix ? "pagarme" : veopagPix ? "veopag" : mangofyPix ? "mangofy" : nuvraPix ? "nuvra" : bluevisionPix ? "bluevision" : pixgoPix ? "pixgo" : mushpagPix ? "mushpag" : pagouPix ? "pagou" : pushinpayPix ? "pushinpay" : wappiPix ? "wappi" : null,
    cardEnabled: cardProvider !== null,
    cardProvider,
  };
}

/** A loja tem credencial configurada para este gateway? (não valida capacidade). */
/**
 * O PAR de credenciais da Appmax gravado nesta loja — ou null.
 *
 * A Appmax entra por dois caminhos: instalação do app PARCEIRO (grava as
 * colunas `appmaxMerchant*`) ou integração DIRETA, mais antiga (colunas
 * `appmaxClient*`). Quatro trechos respondiam "tem credencial?" com quatro
 * regras diferentes, e a do painel olhava só as colunas da integração direta —
 * então uma loja conectada pelo app parceiro cobrava normalmente mas aparecia
 * como "não configurada" na tela. Agora a resposta vem daqui, e só daqui.
 *
 * Devolve o par COMPLETO de uma mesma origem: id de uma fonte com secret da
 * outra não autentica, e passaria batido numa checagem campo a campo.
 */
function appmaxCredPar(s: SettingsRow | null): { idEnc: string; secretEnc: string } | null {
  if (!s) return null;
  if (s.appmaxMerchantClientIdEnc && s.appmaxMerchantClientSecretEnc) {
    return { idEnc: s.appmaxMerchantClientIdEnc, secretEnc: s.appmaxMerchantClientSecretEnc };
  }
  if (s.appmaxClientIdEnc && s.appmaxClientSecretEnc) {
    return { idEnc: s.appmaxClientIdEnc, secretEnc: s.appmaxClientSecretEnc };
  }
  return null;
}

function gatewayHasCreds(s: SettingsRow | null, g: string | null): boolean {
  if (!s || !g) return false;
  switch (g) {
    case "appmax": return appmaxCredPar(s) !== null;
    case "freepay": return !!(s.freepayPublicKeyEnc && s.freepaySecretKeyEnc);
    case "hypercash": return !!s.hypercashSecretKeyEnc;
    case "fintpag": return !!s.fintpagSecretKeyEnc;
    case "hylexpay": return !!s.hylexpaySecretKeyEnc;
    case "beehive": return !!s.beehiveSecretKeyEnc;
    case "pagniv": return !!s.pagnivApiKeyEnc;
    case "vext": return !!s.vextApiKeyEnc;
    case "blackcat": return !!s.blackcatApiKeyEnc;
    case "pagarme": return !!s.pagarmeSecretKeyEnc;
    case "veopag": return !!(s.veopagClientIdEnc && s.veopagClientSecretEnc);
    case "mangofy": return !!(s.mangofyApiKeyEnc && s.mangofyStoreCode);
    case "nuvra": return !!s.nuvraApiKeyEnc;
    case "bluevision": return !!s.bluevisionSecretKeyEnc;
    case "pixgo": return !!s.pixgoApiKeyEnc;
    case "mushpag": return !!s.mushpagApiKeyEnc;
    case "pagou": return !!s.pagouApiTokenEnc;
    case "pushinpay": return !!s.pushinpayTokenEnc;
    case "wappi": return !!(s.wappiPublicKeyEnc && s.wappiSecretKeyEnc);
    case "mercadopago": return !!s.mpAccessTokenEnc;
    case "pinpay": return !!s.pinpaySecretEnc;
    // Removidos (transfyre, infinitepay) caem aqui: um split ou regra de ticket
    // alto que ainda aponte para eles é ignorado e segue o roteamento normal.
    default: return false;
  }
}

/** O gateway consegue processar CARTÃO inline (transparente/tokenizado)? */
function gatewayCanCard(s: SettingsRow | null, g: string | null): boolean {
  if (!s || !g) return false;
  switch (g) {
    case "appmax": return gatewayHasCreds(s, "appmax"); // raw
    case "freepay": return gatewayHasCreds(s, "freepay"); // raw
    case "fintpag": return !!s.fintpagSecretKeyEnc; // raw
    case "hylexpay": return !!s.hylexpaySecretKeyEnc; // raw
    case "hypercash": return !!s.hypercashSecretKeyEnc && !!s.hypercashPublicKey; // token (browser)
    case "beehive": return !!s.beehiveSecretKeyEnc && !!s.beehivePublicKey; // token (browser)
    case "pagniv": return !!s.pagnivApiKeyEnc; // token (browser); a chave pública vem da API deles
    case "blackcat": return !!s.blackcatApiKeyEnc; // raw
    case "pagarme": return !!s.pagarmeSecretKeyEnc; // raw
    case "veopag": return gatewayHasCreds(s, "veopag"); // raw
    case "mangofy": return gatewayHasCreds(s, "mangofy"); // raw
    case "nuvra": return !!s.nuvraApiKeyEnc; // token (browser); a config de tokenização vem da API deles
    case "bluevision": return !!s.bluevisionSecretKeyEnc; // raw (tokenizado no servidor)
    case "wappi": return gatewayHasCreds(s, "wappi"); // raw
    case "mercadopago": return !!s.mpAccessTokenEnc && !!s.mpPublicKey; // token (browser)
    // Pagou fica de FORA do split de cartão de propósito: o cartão dela vive num
    // iframe montado (Payment Element), e o split sorteia o gateway a cada
    // transação — teria de montar/desmontar o iframe no meio do checkout. O Pix
    // dela entra no split normalmente; só o cartão não.
    case "pagou": return false;
    default: return false; // pinpay e os só-Pix não fazem cartão inline
  }
}

/**
 * ESTE gateway está ATIVO na loja — ou seja, tem credencial E algum meio ligado
 * (Pix OU cartão). Usado para BLOQUEAR webhooks: um postback de gateway sem nada
 * ativo é ignorado (defesa contra abuso do endpoint, mesmo com credencial salva).
 *
 * Gateway usado no Smart Routing conta como ativo mesmo com os interruptores da
 * página dele desligados: ele recebe pedidos, e ignorar o aviso deixaria um Pix pago
 * sem confirmar até a próxima conciliação.
 */
export async function isGatewayActive(storeId: string, gateway: string): Promise<boolean> {
  const s = await readSettings(storeId);
  if (!s || !gatewayHasCreds(s, gateway)) return false;
  if (gatewaysDoRoteamento(smartRoutingDe(s)).includes(gateway)) return true;
  const on = (v: number | undefined | null) => (v ?? 0) === 1;
  switch (gateway) {
    case "appmax": return on(s.appmaxPixEnabled) || on(s.appmaxCardEnabled);
    case "freepay": return on(s.freepayPixEnabled) || on(s.freepayCardEnabled);
    case "hypercash": return on(s.hypercashPixEnabled) || on(s.hypercashCardEnabled);
    case "fintpag": return on(s.fintpagPixEnabled) || on(s.fintpagCardEnabled);
    case "hylexpay": return on(s.hylexpayPixEnabled) || on(s.hylexpayCardEnabled);
    case "beehive": return on(s.beehivePixEnabled) || on(s.beehiveCardEnabled);
    case "pagniv": return on(s.pagnivPixEnabled) || on(s.pagnivCardEnabled);
    case "vext": return on(s.vextPixEnabled); // Vext só faz Pix
    case "blackcat": return on(s.blackcatPixEnabled) || on(s.blackcatCardEnabled);
    case "pagarme": return on(s.pagarmePixEnabled) || on(s.pagarmeCardEnabled);
    case "veopag": return on(s.veopagPixEnabled) || on(s.veopagCardEnabled);
    case "mangofy": return on(s.mangofyPixEnabled) || on(s.mangofyCardEnabled);
    case "nuvra": return on(s.nuvraPixEnabled) || on(s.nuvraCardEnabled);
    case "bluevision": return on(s.bluevisionPixEnabled) || on(s.bluevisionCardEnabled);
    case "pixgo": return on(s.pixgoPixEnabled); // PixGo só faz Pix
    case "mushpag": return on(s.mushpagPixEnabled); // MushPag só faz Pix
    case "pagou": return on(s.pagouPixEnabled) || on(s.pagouCardEnabled);
    case "pushinpay": return on(s.pushinpayPixEnabled); // PushinPay só faz Pix
    case "wappi": return on(s.wappiPixEnabled) || on(s.wappiCardEnabled);
    case "mercadopago": return on(s.mpPixEnabled) || on(s.mpCardEnabled);
    case "pinpay": return on(s.pinpayPixEnabled); // PinPay só faz Pix
    default: return false;
  }
}

/** Smart Routing da loja (JSON novo ou, se ainda não salvo, colunas antigas). */
export function smartRoutingDe(s: SettingsRow | null): SmartRouting {
  return lerSmartRouting(s?.smartRoutingJson, s ?? {});
}

/**
 * Rota de CARTÃO que o checkout aplica no navegador (o cartão é tokenizado lá,
 * com o SDK do gateway escolhido). Só entram gateways que fazem cartão inline;
 * a Pagou fica de fora (iframe montado — ver gatewayCanCard).
 *  - distribuição com 2+ gateways válidos → sorteio no navegador;
 *  - distribuição com 1 válido → ele vira o provedor (a base);
 *  - condicional (tem prioridade a partir do valor) → precisa de uma base de
 *    cartão inline: a distribuição ou um gateway principal que não seja Pagou.
 */
function rotaCartaoDe(s: SettingsRow | null, baseRoteamento: string | null): { rota?: RotaCartao; unico?: string } {
  const r = smartRoutingDe(s).cartao;
  const fatias = r.distribuicao.ativo ? r.distribuicao.fatias.filter((f) => gatewayCanCard(s, f.g)) : [];
  const unico = fatias.length === 1 ? fatias[0].g : undefined;
  const base = unico ?? (fatias.length >= 2 ? null : baseRoteamento);

  const { ativo, minCents, gateway } = r.condicional;
  const temBase = fatias.length >= 2 || (!!base && base !== "pagou");
  const condicional =
    ativo && minCents > 0 && gateway && gateway !== base && gatewayCanCard(s, gateway) && temBase ? { minCents, gateway } : undefined;

  if (fatias.length >= 2) return { rota: { fatias, condicional, base: null } };
  if (condicional) return { rota: { condicional, base }, unico };
  return { unico };
}

/**
 * Decide QUAL gateway processa este pedido, pelas regras do Smart Routing do
 * método (Pix e cartão são separados). Os dois modos podem estar ligados:
 *
 * 1. Condicional (PRIORIDADE): a partir do valor, o gateway da regra — se ele
 *    estiver sem credencial, a regra é ignorada. (Nasceu da Beehive, que não
 *    gera Pix acima de R$ 500: deixar o sorteio cair nela perderia a venda.)
 * 2. Distribuição: sorteio DETERMINÍSTICO pelo `seed` (o orderId), para todas
 *    as chamadas do mesmo pedido concordarem. Gateway sem credencial sai do
 *    sorteio; se nenhum sobrar, vale o roteamento normal.
 *
 * Nunca derruba a cobrança por configuração incompleta.
 */
export async function resolveOrderGateway(
  storeId: string,
  capability: "pix" | "card",
  seed: string,
  amountCents?: number,
): Promise<string | null> {
  const s = await readSettings(storeId);
  const routing = await getPaymentRouting(storeId);
  const base = capability === "pix" ? routing.pixProvider : routing.cardProvider;
  const r = smartRoutingDe(s)[capability === "pix" ? "pix" : "cartao"];
  const pode = (g: string) => (capability === "pix" ? gatewayHasCreds(s, g) : gatewayCanCard(s, g));

  if (r.condicional.ativo) {
    const { minCents, gateway } = r.condicional;
    if (amountCents !== undefined && minCents > 0 && amountCents >= minCents && gateway && pode(gateway)) return gateway;
  }
  if (r.distribuicao.ativo) {
    const ok = r.distribuicao.fatias.filter((f) => pode(f.g));
    if (!ok.length) return base;
    const sorteio = crypto.createHash("sha1").update(`${capability}:${seed}`).digest().readUInt32BE(0) / 2 ** 32;
    return sortearFatia(ok, sorteio) ?? base;
  }
  return base;
}

/**
 * Reservas para quando o Pix não gerar no gateway do pedido, na ordem do lojista.
 * Quem ficou sem credencial sai da lista, como nas outras regras do Smart Routing.
 */
export async function getPixRetentativa(storeId: string, primeiro: string | null): Promise<string[]> {
  const s = await readSettings(storeId);
  const r = smartRoutingDe(s).pix.retentativa;
  if (!r?.ativo) return [];
  return [...new Set(r.gateways)].filter((g) => g && g !== primeiro && gatewayHasCreds(s, g));
}

/**
 * Gateways de cartão que o navegador PODE ter escolhido para esta loja. A rota
 * do cartão confere a escolha contra esta lista; fora dela, o servidor decide.
 */
export async function getCardRouteGateways(storeId: string): Promise<string[]> {
  const s = await readSettings(storeId);
  const routing = await getPaymentRouting(storeId);
  return gatewaysDaRota(rotaCartaoDe(s, routing.cardProvider).rota);
}

/** Config de pagamento para o CHECKOUT (público): o que exibir/habilitar. */
export async function getCheckoutPaymentConfig(storeId: string): Promise<{ pixEnabled: boolean; cardEnabled: boolean; mpPublicKey: string; hypercashPublicKey: string; fintpagPublicKey: string; hylexpayPublicKey: string; beehivePublicKey: string; pagouPublicKey: string; pagouSandbox: boolean; cardProvider: CardProvider | null; cardRoute?: RotaCartao; installmentFees: InstallmentFees; installmentFeesByGateway: Record<string, InstallmentFees> }> {
  const s = await readSettings(storeId);
  const routing = await getPaymentRouting(storeId);
  const sr = smartRoutingDe(s);
  let pixEnabled = routing.pixProvider !== null;
  let cardEnabled = routing.cardEnabled;
  let cardProvider: CardProvider | null = routing.cardProvider;

  // Pix distribuído: o Pix aparece se ALGUM gateway da distribuição pode gerar
  // (o resolvedor tira do sorteio quem está sem credencial).
  if (sr.pix.distribuicao.ativo && sr.pix.distribuicao.fatias.some((f) => gatewayHasCreds(s, f.g))) pixEnabled = true;

  // Cartão com Smart Routing: o NAVEGADOR escolhe o gateway (pelo valor ou pela
  // %) e tokeniza com o SDK dele; o servidor confere a escolha.
  const { rota: cardRoute, unico } = rotaCartaoDe(s, routing.cardProvider);
  if (cardRoute?.fatias) {
    cardEnabled = true;
    cardProvider = null; // o checkout usa cardRoute
  } else if (unico) {
    cardEnabled = true;
    cardProvider = unico as CardProvider;
  }

  return {
    pixEnabled,
    cardEnabled,
    mpPublicKey: s?.mpPublicKey ?? "",
    // Public key da HyperCash (tokenização de cartão no navegador via SDK FastSoft).
    hypercashPublicKey: s?.hypercashPublicKey ?? "",
    // Public key da FintPag (tokenização + fingerprint no navegador via SDK /v1/js).
    fintpagPublicKey: s?.fintpagPublicKey ?? "",
    // Public key da HylexPay (mesmo SDK Shield /v1/js).
    hylexpayPublicKey: s?.hylexpayPublicKey ?? "",
    // Public key da Beehive (script /v1/js: encrypt + 3DS no navegador).
    beehivePublicKey: s?.beehivePublicKey ?? "",
    // Pagou: public key do Payment Element + ambiente (o SDK precisa saber se é
    // sandbox ou produção para falar com a API certa).
    pagouPublicKey: s?.pagouPublicKey ?? "",
    pagouSandbox: (s?.pagouSandbox ?? 0) === 1,
    cardProvider,
    cardRoute,
    // Juros de parcelamento: a tabela de cada gateway (quando configurada) e a
    // geral da loja como reserva. O checkout usa a do gateway que vai cobrar.
    installmentFees: parseInstallmentFees(s),
    installmentFeesByGateway: parseFeesByGateway(s),
  };
}


/** Server-only: credenciais da FintPag (chave secreta decifrada) — ou null. */
export async function getFintpagCredentials(storeId: string): Promise<{ secretKey: string; publicKey: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.fintpagSecretKeyEnc) return null;
  try {
    return { secretKey: decryptSecret(s.fintpagSecretKeyEnc), publicKey: s.fintpagPublicKey || null };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da Pagou.ai — ou null.
 * `sandbox` decide a base URL (api.sandbox.pagou.ai x api.pagou.ai); a doc pede
 * tokens separados por ambiente, então o token e o ambiente andam juntos.
 */
export async function getPagouCredentials(
  storeId: string,
): Promise<{ apiToken: string; sandbox: boolean; publicKey: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.pagouApiTokenEnc) return null;
  try {
    return {
      apiToken: decryptSecret(s.pagouApiTokenEnc),
      sandbox: (s.pagouSandbox ?? 0) === 1,
      publicKey: s.pagouPublicKey ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da PushinPay — ou null.
 * `webhookToken` é o valor que a conta deles envia no header `x-pushinpay-token`
 * (opcional: só existe se o lojista configurou lá). Quando existe, é o que
 * autentica o webhook; sem ele, o webhook precisa ser confirmado na API.
 */
export async function getPushinpayCredentials(
  storeId: string,
): Promise<{ token: string; webhookToken: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.pushinpayTokenEnc) return null;
  try {
    return {
      token: decryptSecret(s.pushinpayTokenEnc),
      webhookToken: s.pushinpayWebhookTokenEnc ? decryptSecret(s.pushinpayWebhookTokenEnc) : null,
    };
  } catch {
    return null;
  }
}

/** Server-only: credenciais da PixGo (API key + webhook secret decifrados) — ou null. */
export async function getPixgoCredentials(storeId: string): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.pixgoApiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(s.pixgoApiKeyEnc),
      webhookSecret: s.pixgoWebhookSecretEnc ? decryptSecret(s.pixgoWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da MushPag — ou null.
 *
 * `apiKey` é o par inteiro `{prefixo}.{segredo}`, que vai no Bearer.
 * `webhookSecret` (whsec_…) NÃO é digitado pelo lojista: a MushPag só cadastra
 * webhook pela API, e o segredo volta uma única vez, na criação. Quem grava é
 * `salvarSegredoWebhookMushpag`. Sem ele o pagamento confirma do mesmo jeito
 * (re-consultamos a API antes de liquidar); só a assinatura deixa de ser checada.
 */
export async function getMushpagCredentials(storeId: string): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.mushpagApiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(s.mushpagApiKeyEnc),
      webhookSecret: s.mushpagWebhookSecretEnc ? decryptSecret(s.mushpagWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/** Grava o segredo do webhook que a MushPag devolveu ao cadastrar o endpoint. */
export async function salvarSegredoWebhookMushpag(storeId: string, secret: string): Promise<void> {
  await execute(`UPDATE store_settings SET mushpagWebhookSecretEnc = ? WHERE storeId = ?`, [
    encryptSecret(secret),
    storeId,
  ]);
}

/** Server-only: credenciais da HylexPay (chave secreta decifrada) — ou null. */
export async function getHylexpayCredentials(storeId: string): Promise<{ secretKey: string; publicKey: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.hylexpaySecretKeyEnc) return null;
  try {
    return { secretKey: decryptSecret(s.hylexpaySecretKeyEnc), publicKey: s.hylexpayPublicKey || null };
  } catch {
    return null;
  }
}

/** Server-only: credenciais da HyperCash (chave secreta decifrada) — ou null. */
export async function getHypercashCredentials(storeId: string): Promise<{ secretKey: string; publicKey: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.hypercashSecretKeyEnc) return null;
  try {
    return { secretKey: decryptSecret(s.hypercashSecretKeyEnc), publicKey: s.hypercashPublicKey || null };
  } catch {
    return null;
  }
}

/** Server-only: credenciais da Beehive (chave secreta decifrada) — ou null. */
export async function getBeehiveCredentials(storeId: string): Promise<{ secretKey: string; publicKey: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.beehiveSecretKeyEnc) return null;
  try {
    return { secretKey: decryptSecret(s.beehiveSecretKeyEnc), publicKey: s.beehivePublicKey || null };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da Vext — ou null.
 * `webhookSecret` é opcional: sem ele o pagamento ainda confirma (re-consultamos
 * a API antes de liquidar), mas o postback deixa de ser autenticado.
 */
export async function getVextCredentials(storeId: string): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.vextApiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(s.vextApiKeyEnc),
      webhookSecret: s.vextWebhookSecretEnc ? decryptSecret(s.vextWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da BlackCat — ou null.
 * Só a API Key: a BlackCat não assina o webhook, então não há segredo para ele
 * (o status é sempre confirmado na API antes de liquidar).
 */
export async function getBlackcatCredentials(storeId: string): Promise<{ apiKey: string } | null> {
  const s = await readSettings(storeId);
  if (!s?.blackcatApiKeyEnc) return null;
  try {
    return { apiKey: decryptSecret(s.blackcatApiKeyEnc) };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da Pagar.me — ou null.
 * Só a chave secreta (sk_live_/sk_test_): o cartão vai cru pelo servidor, então
 * a public key (tokenização no navegador) não é usada.
 */
export async function getPagarmeCredentials(storeId: string): Promise<{ secretKey: string } | null> {
  const s = await readSettings(storeId);
  if (!s?.pagarmeSecretKeyEnc) return null;
  try {
    return { secretKey: decryptSecret(s.pagarmeSecretKeyEnc) };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da VeoPag — ou null.
 * `webhookSecret` é a "Webhook Signature" do painel deles (opcional): sem ela o
 * pagamento ainda confirma, porque re-consultamos a API antes de liquidar.
 */
export async function getVeopagCredentials(
  storeId: string,
): Promise<{ clientId: string; clientSecret: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.veopagClientIdEnc || !s.veopagClientSecretEnc) return null;
  try {
    return {
      clientId: decryptSecret(s.veopagClientIdEnc),
      clientSecret: decryptSecret(s.veopagClientSecretEnc),
      webhookSecret: s.veopagWebhookSecretEnc ? decryptSecret(s.veopagWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da MangoFy — ou null.
 * `storeCode` não é segredo (identifica a loja no header `Store-Code`), por
 * isso fica em texto puro, como as public keys dos outros gateways.
 */
export async function getMangofyCredentials(storeId: string): Promise<{ apiKey: string; storeCode: string } | null> {
  const s = await readSettings(storeId);
  if (!s?.mangofyApiKeyEnc || !s.mangofyStoreCode) return null;
  try {
    return { apiKey: decryptSecret(s.mangofyApiKeyEnc), storeCode: s.mangofyStoreCode };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da Blue Vision — ou null.
 * `webhookSecret` é opcional: vem do painel deles (Configurações → Webhooks)
 * e só existe aqui se o lojista o copiou para o nosso painel.
 */
export async function getBluevisionCredentials(storeId: string): Promise<{ secretKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.bluevisionSecretKeyEnc) return null;
  try {
    return {
      secretKey: decryptSecret(s.bluevisionSecretKeyEnc),
      webhookSecret: s.bluevisionWebhookSecretEnc ? decryptSecret(s.bluevisionWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da Nuvra — ou null.
 * `webhookSecret` é opcional: o webhook é cadastrado no painel da Nuvra, e o
 * segredo só existe aqui se o lojista o copiou para o nosso painel.
 */
export async function getNuvraCredentials(storeId: string): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.nuvraApiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(s.nuvraApiKeyEnc),
      webhookSecret: s.nuvraWebhookSecretEnc ? decryptSecret(s.nuvraWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: credenciais da PagNiv — ou null.
 * `webhookSecret` é opcional: só existe se a loja cadastrou o webhook e salvou o
 * secret (a PagNiv só o exibe uma vez, na criação).
 */
export async function getPagnivCredentials(storeId: string): Promise<{ apiKey: string; webhookSecret: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.pagnivApiKeyEnc) return null;
  try {
    return {
      apiKey: decryptSecret(s.pagnivApiKeyEnc),
      webhookSecret: s.pagnivWebhookSecretEnc ? decryptSecret(s.pagnivWebhookSecretEnc) : null,
    };
  } catch {
    return null;
  }
}

/** Server-only: credenciais da Freepay (decifradas) — ou null. */
export async function getFreepayCredentials(storeId: string): Promise<{ publicKey: string; secretKey: string; companyId: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.freepayPublicKeyEnc || !s.freepaySecretKeyEnc) return null;
  try {
    return {
      publicKey: decryptSecret(s.freepayPublicKeyEnc),
      secretKey: decryptSecret(s.freepaySecretKeyEnc),
      companyId: s.freepayCompanyId || null,
    };
  } catch {
    return null;
  }
}

/** Grava o company_id que a própria Freepay informou para as chaves da loja. */
export async function salvarFreepayCompanyId(storeId: string, companyId: string): Promise<void> {
  await execute(`UPDATE store_settings SET freepayCompanyId = ? WHERE storeId = ?`, [companyId, storeId]);
}

/** Server-only: credenciais da Wappi (decifradas) — ou null. */
export async function getWappiCredentials(storeId: string): Promise<{ publicKey: string; secretKey: string; companyId: string | null } | null> {
  const s = await readSettings(storeId);
  if (!s?.wappiPublicKeyEnc || !s.wappiSecretKeyEnc) return null;
  try {
    return {
      publicKey: decryptSecret(s.wappiPublicKeyEnc),
      secretKey: decryptSecret(s.wappiSecretKeyEnc),
      companyId: s.wappiCompanyId || null,
    };
  } catch {
    return null;
  }
}

/** Grava o company_id que a própria Wappi informou para as chaves da loja. */
export async function salvarWappiCompanyId(storeId: string, companyId: string): Promise<void> {
  await execute(`UPDATE store_settings SET wappiCompanyId = ? WHERE storeId = ?`, [companyId, storeId]);
}

/** Server-only: token da Utmify da loja (para enviar vendas). Null se desligada. */
export async function getUtmifyToken(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  if (!s || (s.utmifyEnabled ?? 0) !== 1 || !s.utmifyApiTokenEnc) return null;
  try {
    return decryptSecret(s.utmifyApiTokenEnc);
  } catch {
    return null;
  }
}

/** Server-only: credenciais do merchant na Appmax (decifradas) — ou null. */
export async function getAppmaxCredentials(
  storeId: string,
): Promise<{ clientId: string; clientSecret: string; externalId: string | null; sandbox: boolean } | null> {
  const s = await readSettings(storeId);
  // Credenciais do MERCHANT (instalação do app parceiro) ou, como reserva, as
  // da integração direta. Sempre o par completo de uma mesma origem.
  const par = appmaxCredPar(s);
  if (!par) return null;
  try {
    return {
      clientId: decryptSecret(par.idEnc),
      clientSecret: decryptSecret(par.secretEnc),
      externalId: s?.appmaxExternalId ?? null,
      sandbox: (s?.appmaxSandbox ?? 0) === 1,
    };
  } catch {
    return null;
  }
}

/**
 * Server-only: config do Resend da loja (para enviar e-mail). Retorna null se
 * desligado ou incompleto (falta API key ou remetente).
 */
/** Um e-mail transacional que o lojista pode ligar/desligar sozinho. */
export type EmailKind = "pix" | "paid" | "separation" | "tracking" | "recovery" | "pixrecovery";

const EMAIL_COLUNA: Record<EmailKind, keyof SettingsRow> = {
  pix: "emailPixEnabled",
  paid: "emailPaidEnabled",
  separation: "emailSeparationEnabled",
  tracking: "emailTrackingEnabled",
  recovery: "emailRecoveryEnabled",
  pixrecovery: "emailPixRecoveryEnabled",
};

/**
 * O que vale quando a coluna ainda não existe no banco (migração pendente).
 *
 * Os quatro de pós-venda assumem LIGADO: são confirmações que o cliente espera,
 * e falhar para o lado de não enviar quebraria a experiência de compra.
 * Recuperação assume DESLIGADO: é marketing para quem não comprou, e ninguém
 * deve começar a disparar isso por acidente de migração.
 */
const EMAIL_PADRAO: Record<EmailKind, 0 | 1> = {
  pix: 1,
  paid: 1,
  separation: 1,
  tracking: 1,
  recovery: 0,
  pixrecovery: 0,
};

/** Este e-mail está ligado nesta loja? */
export async function isEmailKindEnabled(storeId: string, kind: EmailKind): Promise<boolean> {
  const s = await readSettings(storeId);
  return (s?.[EMAIL_COLUNA[kind]] ?? EMAIL_PADRAO[kind]) === 1;
}

/**
 * Minutos de espera de cada e-mail nesta loja. Consulta própria, e não em
 * readSettings, de propósito: aquela leitura sustenta o checkout, e uma coluna
 * que ainda não exista no banco a derrubaria. Aqui, o pior caso é valer o padrão.
 */
export async function getEmailTempos(storeId: string): Promise<Record<KindTempo, number>> {
  try {
    const [linha] = await query<{ emailDelaysJson: string | null }>(`SELECT emailDelaysJson FROM store_settings WHERE storeId = ? LIMIT 1`, [storeId]);
    return lerTempos(linha?.emailDelaysJson);
  } catch {
    return { ...TEMPOS_PADRAO };
  }
}

/**
 * Server-only: config do Resend da loja (para enviar e-mail). Retorna null se
 * desligado ou incompleto (falta API key ou remetente).
 *
 * Com `kind`, também devolve null quando AQUELE e-mail está desligado. A trava
 * mora aqui de propósito: é o portão único por onde todo envio passa, então
 * nenhum caminho novo pode esquecer de conferir o interruptor.
 */
export async function getResendConfig(
  storeId: string,
  kind?: EmailKind,
): Promise<{ apiKey: string; fromEmail: string; storeName: string } | null> {
  const s = await readSettings(storeId);
  if (!s || (s.resendEnabled ?? 0) !== 1 || !s.resendApiKeyEnc || !s.resendFromEmail) return null;
  if (kind && (s[EMAIL_COLUNA[kind]] ?? EMAIL_PADRAO[kind]) !== 1) return null;
  try {
    return { apiKey: decryptSecret(s.resendApiKeyEnc), fromEmail: s.resendFromEmail, storeName: s.storeName || "Loja" };
  } catch {
    return null;
  }
}

/** Server-only: API key do Resend decifrada (independe do toggle de envio) — null se ausente.
 *  Usada pelo webhook de inbound para buscar o CONTEÚDO do e-mail recebido. */
export async function getResendApiKey(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  if (!s?.resendApiKeyEnc) return null;
  try {
    return decryptSecret(s.resendApiKeyEnc);
  } catch {
    return null;
  }
}

/** Public key do Mercado Pago (pública — usada na tokenização do cartão no browser). */
export async function getMercadoPagoPublicKey(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  return s?.mpPublicKey || null;
}

/** Server-only: secret key (sk_) da PinPay decifrada (ou null). */
export async function getPinPaySecret(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  if (!s?.pinpaySecretEnc) return null;
  try {
    return decryptSecret(s.pinpaySecretEnc);
  } catch {
    return null;
  }
}

/** Server-only: access token do Mercado Pago decifrado (ou null). */
export async function getMercadoPagoAccessToken(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  if (!s?.mpAccessTokenEnc) return null;
  try {
    return decryptSecret(s.mpAccessTokenEnc);
  } catch {
    return null;
  }
}

/** Para o painel: NUNCA devolve segredos em texto, só se estão configurados. */
export async function getSettingsForAdmin(storeId: string) {
  const s = await readSettings(storeId);
  // Quem REALMENTE processa agora. Com dois gateways ligados no mesmo método,
  // vence o primeiro de uma ordem fixa — e nada no painel dizia isso: o lojista
  // ligava a Beehive, via o Pix sair pela HyperCash e concluía que a integração
  // estava quebrada. Vem do getPaymentRouting para não duplicar a ordem aqui.
  const routing = await getPaymentRouting(storeId).catch(() => ({ pixProvider: null, cardProvider: null, cardEnabled: false }));
  // Valores decifrados para o dono da loja ver/editar (só o merchant da loja
  // acessa esta rota). Se um dia quiser mascarar, troque por os *Configured.
  const dec = (enc: string | null | undefined) => {
    if (!enc) return "";
    try {
      return decryptSecret(enc);
    } catch {
      return "";
    }
  };
  return {
    /** Gateway que está processando o Pix AGORA (null = nenhum ativo). */
    activePixProvider: routing.pixProvider,
    /** Gateway que está processando o cartão AGORA (null = nenhum, ou split). */
    activeCardProvider: routing.cardProvider,
    /**
     * Gateways com credencial salva — os únicos que o Smart Routing consegue
     * usar (resolveOrderGateway ignora quem não tem). O painel marca os demais.
     */
    gatewaysComCredencial: [
      "appmax", "freepay", "hypercash", "fintpag", "hylexpay", "beehive", "pagniv",
      "vext", "blackcat", "pagarme", "veopag", "mangofy", "nuvra", "bluevision", "pixgo", "mushpag", "pagou", "pushinpay", "wappi", "mercadopago", "pinpay",
    ].filter((g) => gatewayHasCreds(s, g)),
    storeName: s?.storeName ?? "Minha loja",
    shopifyStoreDomain: s?.shopifyStoreDomain ?? "",
    shopifyOrderSyncEnabled: (s?.shopifyOrderSyncEnabled ?? 1) === 1,
    // O token Admin e o Secret da Shopify NÃO voltam ao navegador (desde
    // 26/10/2026): a tela mostra só que estão salvos. O Client ID não é segredo.
    shopifyApiKey: dec(s?.shopifyApiKeyEnc),
    adminTokenConfigured: Boolean(s?.shopifyAdminTokenEnc),
    webhookSecretConfigured: Boolean(s?.shopifyWebhookSecretEnc),
    shopifyApiKeyConfigured: Boolean(s?.shopifyApiKeyEnc),
    shopifyApiSecretConfigured: Boolean(s?.shopifyApiSecretEnc),
    mpAccessTokenConfigured: Boolean(s?.mpAccessTokenEnc),
    mpPublicKey: s?.mpPublicKey ?? "",
    mpPixEnabled: (s?.mpPixEnabled ?? 0) === 1,
    mpCardEnabled: (s?.mpCardEnabled ?? 0) === 1,
    pinpaySecretConfigured: Boolean(s?.pinpaySecretEnc),
    pinpayPublicKey: s?.pinpayPublicKey ?? "",
    pinpayPixEnabled: (s?.pinpayPixEnabled ?? 0) === 1,
    resendConfigured: Boolean(s?.resendApiKeyEnc),
    resendFromEmail: s?.resendFromEmail ?? "",
    resendEnabled: (s?.resendEnabled ?? 0) === 1,
    emailPixEnabled: (s?.emailPixEnabled ?? 1) === 1,
    emailPaidEnabled: (s?.emailPaidEnabled ?? 1) === 1,
    emailSeparationEnabled: (s?.emailSeparationEnabled ?? 1) === 1,
    emailTrackingEnabled: (s?.emailTrackingEnabled ?? 1) === 1,
    emailRecoveryEnabled: (s?.emailRecoveryEnabled ?? 0) === 1,
    emailPixRecoveryEnabled: (s?.emailPixRecoveryEnabled ?? 0) === 1,
    emailTempos: await getEmailTempos(storeId),
    // Mesma regra que o checkout usa para cobrar — antes olhava só as colunas
    // da integração direta e dizia "não configurada" para quem conectou pelo
    // app parceiro, mesmo com as vendas saindo normalmente.
    appmaxConfigured: appmaxCredPar(s) !== null,
    // Conectado = credenciais do MERCHANT obtidas via instalação do app parceiro.
    appmaxConnected: Boolean(s?.appmaxMerchantClientIdEnc && s?.appmaxMerchantClientSecretEnc),
    // App PARCEIRO desta loja (App ID + UUID público não são secretos; o secret sim).
    appmaxAppId: s?.appmaxAppId ?? "",
    appmaxPartnerClientId: s?.appmaxPartnerClientId ?? "",
    appmaxPartnerConfigured: Boolean(s?.appmaxAppId && s?.appmaxPartnerClientId && s?.appmaxPartnerClientSecretEnc),
    appmaxPixEnabled: (s?.appmaxPixEnabled ?? 0) === 1,
    appmaxCardEnabled: (s?.appmaxCardEnabled ?? 0) === 1,
    appmaxSandbox: (s?.appmaxSandbox ?? 0) === 1,
    utmifyConfigured: Boolean(s?.utmifyApiTokenEnc),
    utmifyEnabled: (s?.utmifyEnabled ?? 0) === 1,
    freepayConfigured: Boolean(s?.freepayPublicKeyEnc && s?.freepaySecretKeyEnc),
    freepayCompanyId: s?.freepayCompanyId ?? "",
    freepayPixEnabled: (s?.freepayPixEnabled ?? 0) === 1,
    freepayCardEnabled: (s?.freepayCardEnabled ?? 0) === 1,
    wappiConfigured: Boolean(s?.wappiPublicKeyEnc && s?.wappiSecretKeyEnc),
    wappiPixEnabled: (s?.wappiPixEnabled ?? 0) === 1,
    wappiCardEnabled: (s?.wappiCardEnabled ?? 0) === 1,
    hypercashConfigured: Boolean(s?.hypercashSecretKeyEnc),
    hypercashPublicKey: s?.hypercashPublicKey ?? "",
    hypercashPixEnabled: (s?.hypercashPixEnabled ?? 0) === 1,
    hypercashCardEnabled: (s?.hypercashCardEnabled ?? 0) === 1,
    fintpagConfigured: Boolean(s?.fintpagSecretKeyEnc),
    fintpagPublicKey: s?.fintpagPublicKey ?? "",
    fintpagPixEnabled: (s?.fintpagPixEnabled ?? 0) === 1,
    fintpagCardEnabled: (s?.fintpagCardEnabled ?? 0) === 1,
    hylexpayConfigured: Boolean(s?.hylexpaySecretKeyEnc),
    hylexpayPublicKey: s?.hylexpayPublicKey ?? "",
    hylexpayPixEnabled: (s?.hylexpayPixEnabled ?? 0) === 1,
    hylexpayCardEnabled: (s?.hylexpayCardEnabled ?? 0) === 1,
    beehiveConfigured: Boolean(s?.beehiveSecretKeyEnc),
    beehivePublicKey: s?.beehivePublicKey ?? "",
    beehivePixEnabled: (s?.beehivePixEnabled ?? 0) === 1,
    beehiveCardEnabled: (s?.beehiveCardEnabled ?? 0) === 1,
    pagnivConfigured: Boolean(s?.pagnivApiKeyEnc),
    pagnivWebhookConfigured: Boolean(s?.pagnivWebhookSecretEnc),
    pagnivPixEnabled: (s?.pagnivPixEnabled ?? 0) === 1,
    pagnivCardEnabled: (s?.pagnivCardEnabled ?? 0) === 1,
    vextConfigured: Boolean(s?.vextApiKeyEnc),
    vextWebhookConfigured: Boolean(s?.vextWebhookSecretEnc),
    vextPixEnabled: (s?.vextPixEnabled ?? 0) === 1,
    blackcatConfigured: Boolean(s?.blackcatApiKeyEnc),
    blackcatPixEnabled: (s?.blackcatPixEnabled ?? 0) === 1,
    blackcatCardEnabled: (s?.blackcatCardEnabled ?? 0) === 1,
    pagarmeConfigured: Boolean(s?.pagarmeSecretKeyEnc),
    pagarmePixEnabled: (s?.pagarmePixEnabled ?? 0) === 1,
    pagarmeCardEnabled: (s?.pagarmeCardEnabled ?? 0) === 1,
    veopagConfigured: Boolean(s?.veopagClientIdEnc && s?.veopagClientSecretEnc),
    veopagWebhookConfigured: Boolean(s?.veopagWebhookSecretEnc),
    veopagPixEnabled: (s?.veopagPixEnabled ?? 0) === 1,
    veopagCardEnabled: (s?.veopagCardEnabled ?? 0) === 1,
    mangofyConfigured: Boolean(s?.mangofyApiKeyEnc && s?.mangofyStoreCode),
    mangofyStoreCode: s?.mangofyStoreCode ?? "",
    mangofyPixEnabled: (s?.mangofyPixEnabled ?? 0) === 1,
    mangofyCardEnabled: (s?.mangofyCardEnabled ?? 0) === 1,
    nuvraConfigured: Boolean(s?.nuvraApiKeyEnc),
    nuvraWebhookConfigured: Boolean(s?.nuvraWebhookSecretEnc),
    nuvraPixEnabled: (s?.nuvraPixEnabled ?? 0) === 1,
    nuvraCardEnabled: (s?.nuvraCardEnabled ?? 0) === 1,
    bluevisionConfigured: Boolean(s?.bluevisionSecretKeyEnc),
    bluevisionWebhookConfigured: Boolean(s?.bluevisionWebhookSecretEnc),
    bluevisionPixEnabled: (s?.bluevisionPixEnabled ?? 0) === 1,
    bluevisionCardEnabled: (s?.bluevisionCardEnabled ?? 0) === 1,
    pixgoConfigured: Boolean(s?.pixgoApiKeyEnc),
    pixgoWebhookConfigured: Boolean(s?.pixgoWebhookSecretEnc),
    pixgoPixEnabled: (s?.pixgoPixEnabled ?? 0) === 1,
    mushpagConfigured: Boolean(s?.mushpagApiKeyEnc),
    mushpagWebhookConfigured: Boolean(s?.mushpagWebhookSecretEnc),
    mushpagPixEnabled: (s?.mushpagPixEnabled ?? 0) === 1,
    pagouConfigured: Boolean(s?.pagouApiTokenEnc),
    pagouSandbox: (s?.pagouSandbox ?? 0) === 1,
    pagouPixEnabled: (s?.pagouPixEnabled ?? 0) === 1,
    pagouPublicKey: s?.pagouPublicKey ?? "",
    pagouCardEnabled: (s?.pagouCardEnabled ?? 0) === 1,
    pushinpayConfigured: Boolean(s?.pushinpayTokenEnc),
    pushinpayWebhookConfigured: Boolean(s?.pushinpayWebhookTokenEnc),
    pushinpayPixEnabled: (s?.pushinpayPixEnabled ?? 0) === 1,
    // Taxas de parcelamento (efetivas: as da loja OU o padrão). rates em decimal.
    cardInstallmentFees: parseInstallmentFees(s).rates,
    cardInstallmentFixedCents: parseInstallmentFees(s).fixedCents,
    cardInstallmentCustom: Boolean(s?.cardInstallmentFeesJson || s?.cardInstallmentFixedCents != null),
    /** Tabelas próprias por gateway (só as configuradas; rates em decimal, 1x a 12x). */
    cardInstallmentFeesByGateway: parseFeesByGateway(s),
    pixHighValueEnabled: (s?.pixHighValueEnabled ?? 0) === 1,
    pixHighValueProvider: s?.pixHighValueProvider ?? "",
    pixHighValueMinCents: s?.pixHighValueMinCents ?? 0,
    splitEnabled: (s?.splitEnabled ?? 0) === 1,
    splitGatewayA: s?.splitGatewayA ?? "",
    splitGatewayB: s?.splitGatewayB ?? "",
    splitPercentA: s?.splitPercentA ?? 50,
    /** Regras do Smart Routing (Pix e cartão separados), já normalizadas. */
    smartRouting: smartRoutingDe(s),
    waPhoneNumberId: s?.waPhoneNumberId ?? "",
    waBusinessAccountId: s?.waBusinessAccountId ?? "",
    waDisplayPhone: s?.waDisplayPhone ?? "",
    waTokenConfigured: Boolean(s?.waAccessTokenEnc),
    waEnabled: (s?.waEnabled ?? 0) === 1,
  };
}

/** Server-only: credenciais OAuth (app da Shopify) da loja — decifradas ou null. */
export async function getShopifyOAuthCredentials(storeId: string) {
  const s = await readSettings(storeId);
  if (!s?.shopifyApiKeyEnc || !s.shopifyApiSecretEnc) return null;
  return {
    apiKey: decryptSecret(s.shopifyApiKeyEnc),
    apiSecret: decryptSecret(s.shopifyApiSecretEnc),
  };
}

/** Server-only: credenciais decifradas para chamadas internas à Shopify. */
export async function getShopifyCredentials(storeId: string) {
  const s = await readSettings(storeId);
  if (!s?.shopifyStoreDomain || !s.shopifyAdminTokenEnc) return null;
  return {
    domain: s.shopifyStoreDomain,
    adminToken: decryptSecret(s.shopifyAdminTokenEnc),
  };
}

/**
 * Credenciais para ENVIAR pedidos à Shopify (checkout). Diferente de
 * getShopifyCredentials: respeita o toggle `shopifyOrderSyncEnabled` — se o
 * lojista desligou o envio de pedidos, retorna null e o checkout não cria
 * rascunho/pedido na Shopify. (Webhooks/OAuth continuam usando getShopifyCredentials.)
 */
export async function getShopifyPushCredentials(storeId: string) {
  const s = await readSettings(storeId);
  if (!s?.shopifyStoreDomain || !s.shopifyAdminTokenEnc) return null;
  if ((s.shopifyOrderSyncEnabled ?? 1) !== 1) return null; // envio desligado
  return {
    domain: s.shopifyStoreDomain,
    adminToken: decryptSecret(s.shopifyAdminTokenEnc),
  };
}

/** Se o envio de pedidos para a Shopify está ligado (default: sim). */
export async function isShopifyOrderSyncEnabled(storeId: string): Promise<boolean> {
  const s = await readSettings(storeId);
  return (s?.shopifyOrderSyncEnabled ?? 1) === 1;
}

/** Server-only: webhook secret Shopify decifrado (ou null). */
export async function getShopifyWebhookSecret(storeId: string): Promise<string | null> {
  const s = await readSettings(storeId);
  if (!s?.shopifyWebhookSecretEnc) return null;
  return decryptSecret(s.shopifyWebhookSecretEnc);
}

/**
 * Atualiza configurações da loja. O nome vai para `stores`; segredos só são
 * sobrescritos se um valor não-vazio for enviado. Os fragmentos de SET vêm de
 * uma whitelist fixa (sem injeção); os valores vão parametrizados.
 */
export async function updateStoreSettings(
  storeId: string,
  input: {
    storeName?: string;
    shopifyStoreDomain?: string;
    shopifyOrderSyncEnabled?: boolean;
    shopifyAdminToken?: string;
    shopifyWebhookSecret?: string;
    shopifyApiKey?: string;
    shopifyApiSecret?: string;
    mpAccessToken?: string;
    mpPublicKey?: string;
    paymentProvider?: string;
    mpPixEnabled?: boolean;
    mpCardEnabled?: boolean;
    pinpaySecret?: string;
    pinpayPublicKey?: string;
    pinpayPixEnabled?: boolean;
    resendApiKey?: string;
    resendFromEmail?: string;
    resendEnabled?: boolean;
    emailPixEnabled?: boolean;
    emailPaidEnabled?: boolean;
    emailSeparationEnabled?: boolean;
    emailTrackingEnabled?: boolean;
    emailRecoveryEnabled?: boolean;
    emailPixRecoveryEnabled?: boolean;
    emailTempos?: Partial<Record<KindTempo, number>>;
    appmaxClientId?: string;
    appmaxClientSecret?: string;
    appmaxAppId?: string;
    appmaxPartnerClientId?: string;
    appmaxPartnerClientSecret?: string;
    appmaxPixEnabled?: boolean;
    appmaxCardEnabled?: boolean;
    appmaxSandbox?: boolean;
    utmifyApiToken?: string;
    utmifyEnabled?: boolean;
    freepayPublicKey?: string;
    freepaySecretKey?: string;
    freepayCompanyId?: string;
    freepayPixEnabled?: boolean;
    freepayCardEnabled?: boolean;
    wappiPublicKey?: string;
    wappiSecretKey?: string;
    wappiPixEnabled?: boolean;
    wappiCardEnabled?: boolean;
    hypercashSecretKey?: string;
    hypercashPublicKey?: string;
    hypercashPixEnabled?: boolean;
    hypercashCardEnabled?: boolean;
    fintpagSecretKey?: string;
    fintpagPublicKey?: string;
    fintpagPixEnabled?: boolean;
    fintpagCardEnabled?: boolean;
    hylexpaySecretKey?: string;
    hylexpayPublicKey?: string;
    hylexpayPixEnabled?: boolean;
    hylexpayCardEnabled?: boolean;
    beehiveSecretKey?: string;
    beehivePublicKey?: string;
    beehivePixEnabled?: boolean;
    beehiveCardEnabled?: boolean;
    pagnivApiKey?: string;
    pagnivWebhookSecret?: string;
    pagnivPixEnabled?: boolean;
    pagnivCardEnabled?: boolean;
    vextApiKey?: string;
    vextWebhookSecret?: string;
    vextPixEnabled?: boolean;
    blackcatApiKey?: string;
    blackcatPixEnabled?: boolean;
    blackcatCardEnabled?: boolean;
    pagarmeSecretKey?: string;
    pagarmePixEnabled?: boolean;
    pagarmeCardEnabled?: boolean;
    veopagClientId?: string;
    veopagClientSecret?: string;
    veopagWebhookSecret?: string;
    veopagPixEnabled?: boolean;
    veopagCardEnabled?: boolean;
    mangofyApiKey?: string;
    mangofyStoreCode?: string;
    mangofyPixEnabled?: boolean;
    mangofyCardEnabled?: boolean;
    nuvraApiKey?: string;
    nuvraWebhookSecret?: string;
    nuvraPixEnabled?: boolean;
    nuvraCardEnabled?: boolean;
    bluevisionSecretKey?: string;
    bluevisionWebhookSecret?: string;
    bluevisionPixEnabled?: boolean;
    bluevisionCardEnabled?: boolean;
    pixgoApiKey?: string;
    pixgoWebhookSecret?: string;
    pixgoPixEnabled?: boolean;
    mushpagApiKey?: string;
    mushpagPixEnabled?: boolean;
    pagouApiToken?: string;
    pagouSandbox?: boolean;
    pagouPixEnabled?: boolean;
    pagouPublicKey?: string;
    pagouCardEnabled?: boolean;
    pushinpayToken?: string;
    pushinpayWebhookToken?: string;
    pushinpayPixEnabled?: boolean;
    cardInstallmentFees?: Record<string, number>;
    cardInstallmentFixedCents?: number;
    /** Tabela de juros de UM gateway. `reset: true` apaga a dele (volta à geral). */
    cardInstallmentFeesGateway?: { gateway: string; rates?: Record<string, number>; fixedCents?: number; reset?: boolean };
    splitEnabled?: boolean;
    splitGatewayA?: string;
    splitGatewayB?: string;
    splitPercentA?: number;
    pixHighValueEnabled?: boolean;
    pixHighValueProvider?: string;
    pixHighValueMinCents?: number;
    smartRouting?: SmartRouting;
    waPhoneNumberId?: string;
    waAccessToken?: string;
    waBusinessAccountId?: string;
    waDisplayPhone?: string;
    waEnabled?: boolean;
  },
): Promise<void> {
  if (input.storeName !== undefined) {
    await execute(`UPDATE stores SET name = ? WHERE id = ?`, [input.storeName, storeId]);
  }

  const sets: string[] = [];
  const params: any[] = [];
  if (input.shopifyStoreDomain !== undefined) {
    sets.push("shopifyStoreDomain = ?");
    params.push(input.shopifyStoreDomain || null);
  }
  if (input.shopifyOrderSyncEnabled !== undefined) {
    sets.push("shopifyOrderSyncEnabled = ?");
    params.push(input.shopifyOrderSyncEnabled ? 1 : 0);
  }
  if (input.shopifyAdminToken) {
    sets.push("shopifyAdminTokenEnc = ?");
    params.push(encryptSecret(input.shopifyAdminToken));
  }
  if (input.shopifyWebhookSecret) {
    sets.push("shopifyWebhookSecretEnc = ?");
    params.push(encryptSecret(input.shopifyWebhookSecret));
  }
  if (input.shopifyApiKey) {
    sets.push("shopifyApiKeyEnc = ?");
    params.push(encryptSecret(input.shopifyApiKey));
  }
  if (input.shopifyApiSecret) {
    sets.push("shopifyApiSecretEnc = ?");
    params.push(encryptSecret(input.shopifyApiSecret));
  }
  if (input.mpAccessToken) {
    sets.push("mpAccessTokenEnc = ?");
    params.push(encryptSecret(input.mpAccessToken));
  }
  if (input.mpPublicKey !== undefined) {
    sets.push("mpPublicKey = ?");
    params.push(input.mpPublicKey || null);
  }
  if (input.paymentProvider === "mercadopago") {
    sets.push("paymentProvider = ?");
    params.push(input.paymentProvider);
  }
  if (input.mpPixEnabled !== undefined) {
    sets.push("mpPixEnabled = ?");
    params.push(input.mpPixEnabled ? 1 : 0);
  }
  if (input.mpCardEnabled !== undefined) {
    sets.push("mpCardEnabled = ?");
    params.push(input.mpCardEnabled ? 1 : 0);
  }
  if (input.pinpaySecret) {
    sets.push("pinpaySecretEnc = ?");
    params.push(encryptSecret(input.pinpaySecret));
  }
  if (input.pinpayPublicKey !== undefined) {
    sets.push("pinpayPublicKey = ?");
    params.push(input.pinpayPublicKey || null);
  }
  if (input.pinpayPixEnabled !== undefined) {
    sets.push("pinpayPixEnabled = ?");
    params.push(input.pinpayPixEnabled ? 1 : 0);
  }
  if (input.resendApiKey) {
    sets.push("resendApiKeyEnc = ?");
    params.push(encryptSecret(input.resendApiKey));
  }
  if (input.resendFromEmail !== undefined) {
    sets.push("resendFromEmail = ?");
    params.push(input.resendFromEmail || null);
  }
  if (input.resendEnabled !== undefined) {
    sets.push("resendEnabled = ?");
    params.push(input.resendEnabled ? 1 : 0);
  }
  for (const col of ["emailPixEnabled", "emailPaidEnabled", "emailSeparationEnabled", "emailTrackingEnabled"] as const) {
    if (input[col] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(input[col] ? 1 : 0);
    }
  }
  // Os de REENGAJAMENTO carimbam o instante da ativação, e só na virada de
  // desligado para ligado. É esse marco que impede o disparo retroativo: ao
  // ligar, a varredura passa a olhar só o que nasceu dali para frente.
  // O `IF(... IS NULL, NOW(3), <coluna>)` preserva o marco de quem já estava
  // ligado, para não zerar o corte a cada vez que o lojista salva a tela.
  for (const [col, marco] of [
    ["emailRecoveryEnabled", "emailRecoveryEnabledAt"],
    ["emailPixRecoveryEnabled", "emailPixRecoveryEnabledAt"],
  ] as const) {
    if (input[col] === undefined) continue;
    sets.push(`${col} = ?`);
    params.push(input[col] ? 1 : 0);
    sets.push(`${marco} = ${input[col] ? `IF(${col} = 1 AND ${marco} IS NOT NULL, ${marco}, NOW(3))` : "NULL"}`);
  }
  // Por cima do que está salvo: quem manda só um tempo não apaga os outros.
  if (input.emailTempos) {
    sets.push("emailDelaysJson = ?");
    params.push(JSON.stringify({ ...(await getEmailTempos(storeId)), ...input.emailTempos }));
  }
  if (input.appmaxClientId) {
    sets.push("appmaxClientIdEnc = ?");
    params.push(encryptSecret(input.appmaxClientId));
  }
  if (input.appmaxClientSecret) {
    sets.push("appmaxClientSecretEnc = ?");
    params.push(encryptSecret(input.appmaxClientSecret));
  }
  if (input.appmaxPixEnabled !== undefined) {
    sets.push("appmaxPixEnabled = ?");
    params.push(input.appmaxPixEnabled ? 1 : 0);
  }
  if (input.appmaxCardEnabled !== undefined) {
    sets.push("appmaxCardEnabled = ?");
    params.push(input.appmaxCardEnabled ? 1 : 0);
  }
  if (input.appmaxAppId !== undefined) {
    sets.push("appmaxAppId = ?");
    params.push(input.appmaxAppId.trim() || null);
  }
  if (input.appmaxPartnerClientId !== undefined) {
    sets.push("appmaxPartnerClientId = ?");
    params.push(input.appmaxPartnerClientId.trim() || null);
  }
  if (input.appmaxPartnerClientSecret) {
    sets.push("appmaxPartnerClientSecretEnc = ?");
    params.push(encryptSecret(input.appmaxPartnerClientSecret));
  }
  if (input.appmaxSandbox !== undefined) {
    sets.push("appmaxSandbox = ?");
    params.push(input.appmaxSandbox ? 1 : 0);
  }
  if (input.utmifyApiToken) {
    sets.push("utmifyApiTokenEnc = ?");
    params.push(encryptSecret(input.utmifyApiToken));
  }
  if (input.utmifyEnabled !== undefined) {
    sets.push("utmifyEnabled = ?");
    params.push(input.utmifyEnabled ? 1 : 0);
  }
  if (input.freepayPublicKey) {
    sets.push("freepayPublicKeyEnc = ?");
    params.push(encryptSecret(input.freepayPublicKey));
  }
  if (input.freepaySecretKey) {
    sets.push("freepaySecretKeyEnc = ?");
    params.push(encryptSecret(input.freepaySecretKey));
  }
  if (input.freepayCompanyId !== undefined) {
    sets.push("freepayCompanyId = ?");
    params.push(input.freepayCompanyId || null);
  } else if (input.freepayPublicKey || input.freepaySecretKey) {
    // Chave nova pode ser de outra conta: o company_id é descoberto de novo
    // pelas chaves na próxima cobrança (lib/freepay.ts).
    sets.push("freepayCompanyId = NULL");
  }
  if (input.freepayPixEnabled !== undefined) {
    sets.push("freepayPixEnabled = ?");
    params.push(input.freepayPixEnabled ? 1 : 0);
  }
  if (input.freepayCardEnabled !== undefined) {
    sets.push("freepayCardEnabled = ?");
    params.push(input.freepayCardEnabled ? 1 : 0);
  }
  if (input.wappiPublicKey) {
    sets.push("wappiPublicKeyEnc = ?");
    params.push(encryptSecret(input.wappiPublicKey));
  }
  if (input.wappiSecretKey) {
    sets.push("wappiSecretKeyEnc = ?");
    params.push(encryptSecret(input.wappiSecretKey));
  }
  if (input.wappiPublicKey || input.wappiSecretKey) {
    // Chave nova pode ser de outra conta: o company_id é descoberto de novo
    // pelas chaves na próxima cobrança (lib/wappi.ts).
    sets.push("wappiCompanyId = NULL");
  }
  if (input.wappiPixEnabled !== undefined) {
    sets.push("wappiPixEnabled = ?");
    params.push(input.wappiPixEnabled ? 1 : 0);
  }
  if (input.wappiCardEnabled !== undefined) {
    sets.push("wappiCardEnabled = ?");
    params.push(input.wappiCardEnabled ? 1 : 0);
  }
  if (input.hypercashSecretKey) {
    sets.push("hypercashSecretKeyEnc = ?");
    params.push(encryptSecret(input.hypercashSecretKey));
  }
  if (input.hypercashPublicKey !== undefined) {
    sets.push("hypercashPublicKey = ?");
    params.push(input.hypercashPublicKey.trim() || null);
  }
  if (input.hypercashPixEnabled !== undefined) {
    sets.push("hypercashPixEnabled = ?");
    params.push(input.hypercashPixEnabled ? 1 : 0);
  }
  if (input.hypercashCardEnabled !== undefined) {
    sets.push("hypercashCardEnabled = ?");
    params.push(input.hypercashCardEnabled ? 1 : 0);
  }
  if (input.vextApiKey) {
    sets.push("vextApiKeyEnc = ?");
    params.push(encryptSecret(input.vextApiKey));
  }
  if (input.vextWebhookSecret) {
    sets.push("vextWebhookSecretEnc = ?");
    params.push(encryptSecret(input.vextWebhookSecret));
  }
  if (input.vextPixEnabled !== undefined) {
    sets.push("vextPixEnabled = ?");
    params.push(input.vextPixEnabled ? 1 : 0);
  }
  if (input.blackcatApiKey) {
    sets.push("blackcatApiKeyEnc = ?");
    params.push(encryptSecret(input.blackcatApiKey));
  }
  if (input.blackcatPixEnabled !== undefined) {
    sets.push("blackcatPixEnabled = ?");
    params.push(input.blackcatPixEnabled ? 1 : 0);
  }
  if (input.blackcatCardEnabled !== undefined) {
    sets.push("blackcatCardEnabled = ?");
    params.push(input.blackcatCardEnabled ? 1 : 0);
  }
  if (input.pagarmeSecretKey) {
    sets.push("pagarmeSecretKeyEnc = ?");
    params.push(encryptSecret(input.pagarmeSecretKey));
  }
  if (input.pagarmePixEnabled !== undefined) {
    sets.push("pagarmePixEnabled = ?");
    params.push(input.pagarmePixEnabled ? 1 : 0);
  }
  if (input.pagarmeCardEnabled !== undefined) {
    sets.push("pagarmeCardEnabled = ?");
    params.push(input.pagarmeCardEnabled ? 1 : 0);
  }
  if (input.veopagClientId) {
    sets.push("veopagClientIdEnc = ?");
    params.push(encryptSecret(input.veopagClientId));
  }
  if (input.veopagClientSecret) {
    sets.push("veopagClientSecretEnc = ?");
    params.push(encryptSecret(input.veopagClientSecret));
  }
  if (input.veopagWebhookSecret) {
    sets.push("veopagWebhookSecretEnc = ?");
    params.push(encryptSecret(input.veopagWebhookSecret));
  }
  if (input.veopagPixEnabled !== undefined) {
    sets.push("veopagPixEnabled = ?");
    params.push(input.veopagPixEnabled ? 1 : 0);
  }
  if (input.veopagCardEnabled !== undefined) {
    sets.push("veopagCardEnabled = ?");
    params.push(input.veopagCardEnabled ? 1 : 0);
  }
  if (input.mangofyApiKey) {
    sets.push("mangofyApiKeyEnc = ?");
    params.push(encryptSecret(input.mangofyApiKey));
  }
  if (input.mangofyStoreCode !== undefined) {
    sets.push("mangofyStoreCode = ?");
    params.push(input.mangofyStoreCode.trim() || null);
  }
  if (input.mangofyPixEnabled !== undefined) {
    sets.push("mangofyPixEnabled = ?");
    params.push(input.mangofyPixEnabled ? 1 : 0);
  }
  if (input.mangofyCardEnabled !== undefined) {
    sets.push("mangofyCardEnabled = ?");
    params.push(input.mangofyCardEnabled ? 1 : 0);
  }
  if (input.pagnivApiKey) {
    sets.push("pagnivApiKeyEnc = ?");
    params.push(encryptSecret(input.pagnivApiKey));
  }
  if (input.pagnivWebhookSecret) {
    sets.push("pagnivWebhookSecretEnc = ?");
    params.push(encryptSecret(input.pagnivWebhookSecret));
  }
  if (input.pagnivPixEnabled !== undefined) {
    sets.push("pagnivPixEnabled = ?");
    params.push(input.pagnivPixEnabled ? 1 : 0);
  }
  if (input.pagnivCardEnabled !== undefined) {
    sets.push("pagnivCardEnabled = ?");
    params.push(input.pagnivCardEnabled ? 1 : 0);
  }
  if (input.beehiveSecretKey) {
    sets.push("beehiveSecretKeyEnc = ?");
    params.push(encryptSecret(input.beehiveSecretKey));
  }
  if (input.beehivePublicKey !== undefined) {
    sets.push("beehivePublicKey = ?");
    params.push(input.beehivePublicKey.trim() || null);
  }
  if (input.beehivePixEnabled !== undefined) {
    sets.push("beehivePixEnabled = ?");
    params.push(input.beehivePixEnabled ? 1 : 0);
  }
  if (input.beehiveCardEnabled !== undefined) {
    sets.push("beehiveCardEnabled = ?");
    params.push(input.beehiveCardEnabled ? 1 : 0);
  }
  if (input.fintpagSecretKey) {
    sets.push("fintpagSecretKeyEnc = ?");
    params.push(encryptSecret(input.fintpagSecretKey));
  }
  if (input.fintpagPublicKey !== undefined) {
    sets.push("fintpagPublicKey = ?");
    params.push(input.fintpagPublicKey.trim() || null);
  }
  if (input.fintpagPixEnabled !== undefined) {
    sets.push("fintpagPixEnabled = ?");
    params.push(input.fintpagPixEnabled ? 1 : 0);
  }
  if (input.fintpagCardEnabled !== undefined) {
    sets.push("fintpagCardEnabled = ?");
    params.push(input.fintpagCardEnabled ? 1 : 0);
  }
  if (input.hylexpaySecretKey) {
    sets.push("hylexpaySecretKeyEnc = ?");
    params.push(encryptSecret(input.hylexpaySecretKey));
  }
  if (input.hylexpayPublicKey !== undefined) {
    sets.push("hylexpayPublicKey = ?");
    params.push(input.hylexpayPublicKey.trim() || null);
  }
  if (input.hylexpayPixEnabled !== undefined) {
    sets.push("hylexpayPixEnabled = ?");
    params.push(input.hylexpayPixEnabled ? 1 : 0);
  }
  if (input.hylexpayCardEnabled !== undefined) {
    sets.push("hylexpayCardEnabled = ?");
    params.push(input.hylexpayCardEnabled ? 1 : 0);
  }
  if (input.pixgoApiKey) {
    sets.push("pixgoApiKeyEnc = ?");
    params.push(encryptSecret(input.pixgoApiKey));
  }
  if (input.pixgoWebhookSecret) {
    sets.push("pixgoWebhookSecretEnc = ?");
    params.push(encryptSecret(input.pixgoWebhookSecret));
  }
  if (input.pixgoPixEnabled !== undefined) {
    sets.push("pixgoPixEnabled = ?");
    params.push(input.pixgoPixEnabled ? 1 : 0);
  }
  if (input.nuvraApiKey) {
    sets.push("nuvraApiKeyEnc = ?");
    params.push(encryptSecret(input.nuvraApiKey));
  }
  if (input.nuvraWebhookSecret) {
    sets.push("nuvraWebhookSecretEnc = ?");
    params.push(encryptSecret(input.nuvraWebhookSecret));
  }
  if (input.nuvraPixEnabled !== undefined) {
    sets.push("nuvraPixEnabled = ?");
    params.push(input.nuvraPixEnabled ? 1 : 0);
  }
  if (input.nuvraCardEnabled !== undefined) {
    sets.push("nuvraCardEnabled = ?");
    params.push(input.nuvraCardEnabled ? 1 : 0);
  }
  if (input.bluevisionSecretKey) {
    sets.push("bluevisionSecretKeyEnc = ?");
    params.push(encryptSecret(input.bluevisionSecretKey));
  }
  if (input.bluevisionWebhookSecret) {
    sets.push("bluevisionWebhookSecretEnc = ?");
    params.push(encryptSecret(input.bluevisionWebhookSecret));
  }
  if (input.bluevisionPixEnabled !== undefined) {
    sets.push("bluevisionPixEnabled = ?");
    params.push(input.bluevisionPixEnabled ? 1 : 0);
  }
  if (input.bluevisionCardEnabled !== undefined) {
    sets.push("bluevisionCardEnabled = ?");
    params.push(input.bluevisionCardEnabled ? 1 : 0);
  }
  if (input.mushpagApiKey) {
    sets.push("mushpagApiKeyEnc = ?");
    params.push(encryptSecret(input.mushpagApiKey));
    // Chave nova pode ser de OUTRA conta MushPag: o segredo do webhook era da
    // conta antiga e passaria a reprovar toda entrega legítima. Zera, e o
    // teste da chave (que o painel roda logo após salvar) cadastra de novo.
    sets.push("mushpagWebhookSecretEnc = NULL");
  }
  if (input.mushpagPixEnabled !== undefined) {
    sets.push("mushpagPixEnabled = ?");
    params.push(input.mushpagPixEnabled ? 1 : 0);
  }
  if (input.pagouApiToken) {
    sets.push("pagouApiTokenEnc = ?");
    params.push(encryptSecret(input.pagouApiToken));
  }
  if (input.pagouSandbox !== undefined) {
    sets.push("pagouSandbox = ?");
    params.push(input.pagouSandbox ? 1 : 0);
  }
  if (input.pagouPixEnabled !== undefined) {
    sets.push("pagouPixEnabled = ?");
    params.push(input.pagouPixEnabled ? 1 : 0);
  }
  if (input.pagouPublicKey !== undefined) {
    // Public key não é segredo (vai para o navegador) — texto puro, como nos
    // outros gateways. Em branco limpa.
    sets.push("pagouPublicKey = ?");
    params.push(input.pagouPublicKey || null);
  }
  if (input.pagouCardEnabled !== undefined) {
    sets.push("pagouCardEnabled = ?");
    params.push(input.pagouCardEnabled ? 1 : 0);
  }
  if (input.pushinpayToken) {
    sets.push("pushinpayTokenEnc = ?");
    params.push(encryptSecret(input.pushinpayToken));
  }
  if (input.pushinpayWebhookToken !== undefined) {
    // Valor esperado no header `x-pushinpay-token`. É segredo compartilhado —
    // criptografado como os demais. Em branco limpa (a conta pode não ter um).
    sets.push("pushinpayWebhookTokenEnc = ?");
    params.push(input.pushinpayWebhookToken ? encryptSecret(input.pushinpayWebhookToken) : null);
  }
  if (input.pushinpayPixEnabled !== undefined) {
    sets.push("pushinpayPixEnabled = ?");
    params.push(input.pushinpayPixEnabled ? 1 : 0);
  }
  if (input.cardInstallmentFees !== undefined) {
    // Só guarda as taxas 2x..12x válidas (decimais 0..<1); as demais ficam no padrão.
    const clean: Record<string, number> = {};
    for (let n = 2; n <= 12; n++) {
      const v = input.cardInstallmentFees[String(n)];
      if (typeof v === "number" && isFinite(v) && v >= 0 && v < 1) clean[String(n)] = Math.round(v * 1e6) / 1e6;
    }
    sets.push("cardInstallmentFeesJson = ?");
    params.push(Object.keys(clean).length ? JSON.stringify(clean) : null);
  }
  if (input.cardInstallmentFixedCents !== undefined) {
    sets.push("cardInstallmentFixedCents = ?");
    params.push(Math.max(0, Math.round(input.cardInstallmentFixedCents)));
  }
  if (input.cardInstallmentFeesGateway) {
    // Lê-modifica-grava o JSON: mexe SÓ no gateway informado, as tabelas dos
    // outros ficam como estão. 1x a 12x, decimais 0..<1; o resto vira 0.
    const { gateway, rates, fixedCents, reset } = input.cardInstallmentFeesGateway;
    let atual: Record<string, unknown> = {};
    try {
      atual = JSON.parse((await readSettings(storeId))?.cardInstallmentFeesByGatewayJson || "{}") ?? {};
    } catch {
      atual = {};
    }
    if (reset) {
      delete atual[gateway];
    } else {
      const limpo: Record<string, number> = {};
      for (let n = 1; n <= 12; n++) {
        const v = rates?.[String(n)];
        limpo[String(n)] = typeof v === "number" && isFinite(v) && v >= 0 && v < 1 ? Math.round(v * 1e6) / 1e6 : 0;
      }
      atual[gateway] = { rates: limpo, fixedCents: Math.max(0, Math.round(fixedCents ?? CARD_FIXED_FEE_CENTS)) };
    }
    sets.push("cardInstallmentFeesByGatewayJson = ?");
    params.push(Object.keys(atual).length ? JSON.stringify(atual) : null);
  }
  if (input.pixHighValueEnabled !== undefined) {
    sets.push("pixHighValueEnabled = ?");
    params.push(input.pixHighValueEnabled ? 1 : 0);
  }
  if (input.pixHighValueProvider !== undefined) {
    sets.push("pixHighValueProvider = ?");
    params.push(input.pixHighValueProvider || null);
  }
  if (input.pixHighValueMinCents !== undefined) {
    // 0 = sem regra. O teto de R$ 1.000.000 evita que um dedo escorregado no
    // painel desative a regra na prática (valor que nenhum pedido alcança).
    const v = Math.round(input.pixHighValueMinCents);
    sets.push("pixHighValueMinCents = ?");
    params.push(Number.isFinite(v) ? Math.max(0, Math.min(100_000_000, v)) : null);
  }
  if (input.splitEnabled !== undefined) {
    sets.push("splitEnabled = ?");
    params.push(input.splitEnabled ? 1 : 0);
  }
  if (input.splitGatewayA !== undefined) {
    sets.push("splitGatewayA = ?");
    params.push(input.splitGatewayA || null);
  }
  if (input.splitGatewayB !== undefined) {
    sets.push("splitGatewayB = ?");
    params.push(input.splitGatewayB || null);
  }
  if (input.splitPercentA !== undefined) {
    sets.push("splitPercentA = ?");
    params.push(Math.max(0, Math.min(100, Math.round(input.splitPercentA))));
  }
  if (input.smartRouting !== undefined) {
    // Grava o JSON novo; a partir daí as colunas antigas (split*, pixHighValue*)
    // deixam de ser lidas por esta loja — ver lerSmartRouting.
    sets.push("smartRoutingJson = ?");
    params.push(JSON.stringify(input.smartRouting));
  }
  if (input.waPhoneNumberId !== undefined) {
    sets.push("waPhoneNumberId = ?");
    params.push(input.waPhoneNumberId.replace(/\D/g, "") || null);
  }
  if (input.waAccessToken) {
    sets.push("waAccessTokenEnc = ?");
    params.push(encryptSecret(input.waAccessToken));
  }
  if (input.waBusinessAccountId !== undefined) {
    sets.push("waBusinessAccountId = ?");
    params.push(input.waBusinessAccountId.replace(/\D/g, "") || null);
  }
  if (input.waDisplayPhone !== undefined) {
    sets.push("waDisplayPhone = ?");
    params.push(input.waDisplayPhone || null);
  }
  if (input.waEnabled !== undefined) {
    sets.push("waEnabled = ?");
    params.push(input.waEnabled ? 1 : 0);
  }

  // Exclusividade POR CAPACIDADE: ao LIGAR o Pix de um gateway, desliga o Pix dos
  // demais; idem para Cartão. Garante 1 gateway de Pix + 1 de cartão ativos (sem
  // prioridade escondida). As chaves batem com os nomes das colunas; só as dos
  // OUTROS gateways (ausentes neste payload) são zeradas — a que está sendo
  // ligada já foi setada acima. Lista fixa (não é input do usuário → sem SQLi).
  const PIX_KEYS = ["mpPixEnabled", "pinpayPixEnabled", "appmaxPixEnabled", "freepayPixEnabled", "hypercashPixEnabled", "fintpagPixEnabled", "hylexpayPixEnabled", "beehivePixEnabled", "pagnivPixEnabled", "vextPixEnabled", "blackcatPixEnabled", "pagarmePixEnabled", "veopagPixEnabled", "mangofyPixEnabled", "nuvraPixEnabled", "bluevisionPixEnabled", "pixgoPixEnabled", "mushpagPixEnabled", "pagouPixEnabled", "pushinpayPixEnabled", "wappiPixEnabled"] as const;
  const CARD_KEYS = ["mpCardEnabled", "appmaxCardEnabled", "freepayCardEnabled", "hypercashCardEnabled", "fintpagCardEnabled", "hylexpayCardEnabled", "beehiveCardEnabled", "pagnivCardEnabled", "blackcatCardEnabled", "pagarmeCardEnabled", "veopagCardEnabled", "mangofyCardEnabled", "nuvraCardEnabled", "bluevisionCardEnabled", "pagouCardEnabled", "wappiCardEnabled"] as const;
  const turnOffOthers = (keys: readonly string[]) => {
    const enabling = keys.some((k) => (input as Record<string, unknown>)[k] === true);
    if (!enabling) return;
    for (const k of keys) {
      if ((input as Record<string, unknown>)[k] === undefined) sets.push(`${k} = 0`);
    }
  };
  turnOffOthers(PIX_KEYS);
  turnOffOthers(CARD_KEYS);

  // TRAVA DE ESQUECIMENTO — o build quebra se um gateway novo ficar de fora.
  //
  // Estas listas eram mantidas à mão e silenciaram três vezes: Beehive, PagNiv e
  // Vext entraram sem serem acrescentadas, e o efeito não era erro nenhum — era
  // dois gateways de Pix ligados ao mesmo tempo, com um vencendo por ordem
  // escondida. O lojista ligava um e a venda saía por outro.
  //
  // Se `Exclude` sobrar alguma chave, ela não é `never` e o `AssertNever` falha
  // nomeando a coluna que faltou.
  // `email*` fica de fora: `emailPixEnabled` é o interruptor do E-MAIL "Pix
  // gerado", não de um gateway. (A trava já pegou isso na primeira execução.)
  type AssertNever<T extends never> = T;
  type _PixCobertas = AssertNever<
    Exclude<Exclude<Extract<keyof SettingsRow, `${string}PixEnabled`>, `email${string}`>, (typeof PIX_KEYS)[number]>
  >;
  type _CardCobertas = AssertNever<
    Exclude<Exclude<Extract<keyof SettingsRow, `${string}CardEnabled`>, `email${string}`>, (typeof CARD_KEYS)[number]>
  >;

  if (sets.length) {
    params.push(storeId);
    await execute(
      `UPDATE store_settings SET ${sets.join(", ")} WHERE storeId = ?`,
      params,
    );
  }
}

/** Lê o tema de personalização do checkout (JSON) — ou null. */
export async function getCheckoutTheme(storeId: string): Promise<unknown | null> {
  const rows = await query<{ checkoutTheme: string | null }>(
    `SELECT checkoutTheme FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const raw = rows[0]?.checkoutTheme;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Salva o tema de personalização do checkout (JSON). */
export async function setCheckoutTheme(storeId: string, theme: unknown): Promise<void> {
  await execute(
    `UPDATE store_settings SET checkoutTheme = ? WHERE storeId = ?`,
    [JSON.stringify(theme), storeId],
  );
}

// ── Webhooks da loja. Genéricos: qualquer URL que aceite um POST JSON. ──
// Cada webhook tem nome, URL, um token (para o destino confirmar a origem) e a
// lista de eventos que quer receber.
// O tipo/lista/rótulos vivem em webhook-events.ts (sem "server-only") para o
// painel poder usá-los; reexportados aqui por conveniência do lado servidor.
export { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABEL, type WebhookEvent } from "./webhook-events";

export type StoredWebhook = {
  id: string;
  name: string;
  url: string;
  /** Enviado no header X-Webhook-Token para o destino validar a origem. */
  token: string;
  events: WebhookEvent[];
  enabled: boolean;
};

/** Token opaco novo (só letras/números, fácil de copiar). */
export function newWebhookToken(): string {
  return Array.from({ length: 32 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)]).join("");
}

/**
 * Lista de webhooks da loja. Converte na leitura os dois formatos antigos:
 * o webhook único (salesWebhookUrl) e o formato de um evento por linha
 * ({ event: "paid" | "pending" }) — assim ninguém perde notificação ao migrar.
 */
export async function getWebhooks(storeId: string): Promise<StoredWebhook[]> {
  const rows = await query<{ webhooks: string | null; salesWebhookUrl: string | null }>(
    `SELECT webhooks, salesWebhookUrl FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const raw = rows[0]?.webhooks;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .filter((w) => w && typeof w.url === "string" && w.url)
          .map((w): StoredWebhook => {
            // Formato antigo: um evento por linha, sem nome nem token.
            const legacyEvent =
              w.event === "paid" ? "order_paid" : w.event === "pending" ? "order_created" : null;
            const events: WebhookEvent[] = Array.isArray(w.events)
              ? w.events.filter((e: unknown): e is WebhookEvent => WEBHOOK_EVENTS.includes(e as WebhookEvent))
              : legacyEvent
                ? [legacyEvent]
                : [];
            return {
              id: String(w.id ?? newWebhookToken().slice(0, 12)),
              name: String(w.name ?? (legacyEvent === "order_paid" ? "Venda aprovada" : "Webhook")),
              url: String(w.url),
              token: String(w.token ?? newWebhookToken()),
              events,
              enabled: w.enabled !== false,
            };
          });
      }
    } catch {
      /* cai no fallback */
    }
  }
  // Retrocompat: o webhook único antigo notificava venda aprovada.
  const legacy = rows[0]?.salesWebhookUrl;
  if (legacy) {
    return [
      { id: "legacy", name: "Venda aprovada", url: legacy, token: newWebhookToken(), events: ["order_paid"], enabled: true },
    ];
  }
  return [];
}

export async function setWebhooks(storeId: string, list: StoredWebhook[]): Promise<void> {
  // Ao salvar a lista, limpa a coluna antiga (já migrada).
  await execute(
    `UPDATE store_settings SET webhooks = ?, salesWebhookUrl = NULL WHERE storeId = ?`,
    [JSON.stringify(list), storeId],
  );
}

/** Webhooks ATIVOS inscritos em um evento. */
export async function getWebhooksForEvent(storeId: string, event: WebhookEvent): Promise<StoredWebhook[]> {
  const list = await getWebhooks(storeId);
  return list.filter((w) => w.enabled && w.url && w.events.includes(event));
}

/** Nome da loja para exibição (público — usado no checkout). */
export async function getStoreName(storeId: string): Promise<string> {
  const rows = await query<{ name: string }>(
    `SELECT name FROM stores WHERE id = ? LIMIT 1`,
    [storeId],
  );
  return rows[0]?.name || "Minha loja";
}

// ── Pixels de marketing (Meta/Google Ads/Google Analytics/TikTok/Taboola). Token da CAPI é criptografado. ──
interface StoredPixel {
  id: string;
  type: "meta" | "google" | "ga4" | "tiktok" | "taboola" | "kwai" | "pinterest";
  name: string;
  pixelId: string;
  conversionLabel: string;
  accessTokenEnc: string | null;
  paidOnly: boolean;
  enabled: boolean;
}

async function readPixels(storeId: string): Promise<StoredPixel[]> {
  const rows = await query<{ pixels: string | null }>(
    `SELECT pixels FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const raw = rows[0]?.pixels;
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Painel: lista de pixels SEM o token (só indica se está configurado). */
export async function getPixelsForMerchant(storeId: string) {
  const list = await readPixels(storeId);
  return list.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    pixelId: p.pixelId,
    conversionLabel: p.conversionLabel ?? "",
    paidOnly: Boolean(p.paidOnly),
    enabled: p.enabled !== false,
    accessTokenConfigured: Boolean(p.accessTokenEnc),
  }));
}

/** Público (checkout): pixels ativos, só dados não-sensíveis para disparo. */
export async function getActivePixels(storeId: string) {
  const list = await readPixels(storeId);
  return list
    .filter((p) => p.enabled !== false && p.pixelId)
    .map((p) => ({
      type: p.type,
      pixelId: p.pixelId,
      conversionLabel: p.conversionLabel ?? "",
      paidOnly: Boolean(p.paidOnly),
      // Só o aviso de que a chave existe: ela nunca sai do servidor.
      compraNoServidor: (p.type === "ga4" || p.type === "meta") && Boolean(p.accessTokenEnc),
    }));
}

/** Server-only: pixels da Meta ativos da loja com token, para enviar a compra. */
export async function getMetaComToken(storeId: string): Promise<{ pixelId: string; token: string }[]> {
  const saida: { pixelId: string; token: string }[] = [];
  for (const p of await readPixels(storeId)) {
    if (p.type !== "meta" || p.enabled === false || !p.pixelId || !p.accessTokenEnc) continue;
    try {
      saida.push({ pixelId: p.pixelId, token: decryptSecret(p.accessTokenEnc) });
    } catch {
      console.error("[meta-compra] token ilegível na loja", storeId);
    }
  }
  return saida;
}

/** Server-only: Google Analytics ativos da loja com chave, para enviar a compra. */
export async function getGa4ComChave(storeId: string): Promise<{ idMetrica: string; chave: string }[]> {
  const saida: { idMetrica: string; chave: string }[] = [];
  for (const p of await readPixels(storeId)) {
    if (p.type !== "ga4" || p.enabled === false || !p.pixelId || !p.accessTokenEnc) continue;
    try {
      saida.push({ idMetrica: p.pixelId, chave: decryptSecret(p.accessTokenEnc) });
    } catch {
      console.error("[ga4-compra] chave ilegível na loja", storeId);
    }
  }
  return saida;
}

export type IncomingPixel = {
  id?: string;
  type: "meta" | "google" | "ga4" | "tiktok" | "taboola" | "kwai" | "pinterest";
  name: string;
  pixelId: string;
  conversionLabel?: string;
  accessToken?: string;
  paidOnly: boolean;
  enabled: boolean;
};

/** Salva a lista de pixels. Token (Meta CAPI) é criptografado; em branco mantém. */
export async function setPixels(storeId: string, incoming: IncomingPixel[]): Promise<void> {
  const existing = await readPixels(storeId);
  const byId = new Map(existing.map((p) => [p.id, p]));

  const next: StoredPixel[] = incoming.map((p) => {
    const id = p.id && byId.has(p.id) ? p.id : newId();
    const prev = byId.get(id);
    let accessTokenEnc: string | null = prev?.accessTokenEnc ?? null;
    if (typeof p.accessToken === "string" && p.accessToken.trim()) {
      accessTokenEnc = encryptSecret(p.accessToken.trim());
    }
    return {
      id,
      type: p.type,
      name: p.name,
      pixelId: p.pixelId,
      conversionLabel: p.conversionLabel ?? "",
      accessTokenEnc,
      paidOnly: Boolean(p.paidOnly),
      enabled: p.enabled !== false,
    };
  });

  await execute(`UPDATE store_settings SET pixels = ? WHERE storeId = ?`, [
    JSON.stringify(next),
    storeId,
  ]);
}

// ── Domínio próprio ──
export type DomainConfig = {
  customDomain: string | null;
  domainToken: string | null;
  domainVerified: boolean;
  domainVerifiedAt: string | null;
};

export async function getDomainConfig(storeId: string): Promise<DomainConfig> {
  const rows = await query<{
    customDomain: string | null;
    domainToken: string | null;
    domainVerified: number;
    domainVerifiedAt: string | null;
  }>(
    `SELECT customDomain, domainToken, domainVerified, domainVerifiedAt
     FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const r = rows[0];
  return {
    customDomain: r?.customDomain ?? null,
    domainToken: r?.domainToken ?? null,
    domainVerified: !!r?.domainVerified,
    domainVerifiedAt: r?.domainVerifiedAt ?? null,
  };
}

/** Salva o domínio + token de verificação e reseta o status. Vazio = limpa. */
export async function setCustomDomain(
  storeId: string,
  domain: string | null,
  token: string | null,
): Promise<void> {
  await execute(
    `UPDATE store_settings
     SET customDomain = ?, domainToken = ?, domainVerified = 0, domainVerifiedAt = NULL
     WHERE storeId = ?`,
    [domain, token, storeId],
  );
}

// ── Estado da instalação do checkout na Shopify ──────────────────────────────
// Registro do que foi instalado e quando. Serve ao diagnóstico do painel: com o
// `src` esperado guardado dá para dizer se o que está na loja hoje ainda aponta
// para o lugar certo — o caso silencioso que derrubava o checkout sem avisar.

export type CheckoutInstallState = {
  installed: boolean;
  src: string | null;
  status: string | null;
  checkedAt: string | null;
};

export async function getCheckoutInstallState(storeId: string): Promise<CheckoutInstallState> {
  const rows = await query<{
    shopifyCheckoutInstalled: number;
    shopifyCheckoutSrc: string | null;
    shopifyCheckoutStatus: string | null;
    shopifyCheckoutCheckedAt: string | null;
  }>(
    `SELECT shopifyCheckoutInstalled, shopifyCheckoutSrc, shopifyCheckoutStatus, shopifyCheckoutCheckedAt
     FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const r = rows[0];
  return {
    installed: (r?.shopifyCheckoutInstalled ?? 0) === 1,
    src: r?.shopifyCheckoutSrc ?? null,
    status: r?.shopifyCheckoutStatus ?? null,
    checkedAt: r?.shopifyCheckoutCheckedAt ?? null,
  };
}

/** Registra a instalação (ou a remoção). `src` é o endereço esperado do script. */
export async function setCheckoutInstalled(
  storeId: string,
  installed: boolean,
  src: string | null,
  status: string | null,
): Promise<void> {
  await execute(
    `UPDATE store_settings
     SET shopifyCheckoutInstalled = ?, shopifyCheckoutSrc = ?, shopifyCheckoutStatus = ?,
         shopifyCheckoutCheckedAt = NOW(3)
     WHERE storeId = ?`,
    [installed ? 1 : 0, src, status ? status.slice(0, 255) : null, storeId],
  );
}

export async function markDomainVerified(storeId: string): Promise<void> {
  await execute(
    `UPDATE store_settings SET domainVerified = 1, domainVerifiedAt = NOW(3) WHERE storeId = ?`,
    [storeId],
  );
}
