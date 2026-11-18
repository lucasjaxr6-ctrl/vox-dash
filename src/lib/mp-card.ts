import { resumoCartao } from "./card-resumo";

// Cliente do Mercado Pago para CARTÃO (tokenização no navegador). O número do
// cartão é enviado direto ao MP pelo SDK; NUNCA passa pelo nosso servidor.
// Só o resumo MASCARADO (6 primeiros + 4 últimos) vai para a nossa rota.

type MpSdk = {
  getPaymentMethods: (opts: { bin: string }) => Promise<{ results?: { id: string }[] }>;
  getIssuers: (opts: { paymentMethodId: string; bin: string }) => Promise<{ id: string | number }[]>;
  createCardToken: (opts: Record<string, string>) => Promise<{ id?: string }>;
};

function loadScript(src: string, attrs?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    if (attrs) for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (typeof window !== "undefined" && (window as any).MercadoPago) return Promise.resolve();
  if (!sdkPromise) sdkPromise = loadScript("https://sdk.mercadopago.com/js/v2");
  return sdkPromise;
}

// security.js gera a impressão digital do dispositivo em window.MP_DEVICE_SESSION_ID.
// É o principal sinal antifraude do Mercado Pago (reduz recusas "high_risk").
let secPromise: Promise<void> | null = null;
function loadSecurity(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (!secPromise) {
    secPromise = loadScript("https://www.mercadopago.com/v2/security.js", { view: "checkout" }).catch(() => {
      /* não bloqueia o checkout se o antifraude não carregar */
    });
  }
  return secPromise;
}

function deviceSessionId(): string | undefined {
  const id = typeof window !== "undefined" ? (window as any).MP_DEVICE_SESSION_ID : undefined;
  return typeof id === "string" && id ? id.slice(0, 8000) : undefined;
}

// O security.js gera o MP_DEVICE_SESSION_ID de forma assíncrona. Espera ele
// ficar pronto (até ~3s) para NÃO cobrar sem o fingerprint (evita high_risk).
async function waitForDeviceId(timeoutMs = 3000): Promise<string | undefined> {
  await loadSecurity();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = deviceSessionId();
    if (id) return id;
    await new Promise((r) => setTimeout(r, 150));
  }
  return deviceSessionId();
}

// Pré-carrega SDK + antifraude assim que o cartão fica disponível, para o device
// id já estar pronto quando o cliente finalizar.
export function preloadMercadoPago(): void {
  try {
    loadSdk().catch(() => {});
    loadSecurity();
  } catch {
    /* ignore */
  }
}

export type CardFields = { number: string; holder: string; expiry: string; cvv: string; cpf: string };
// Cada `submit...CardPayment` monta o corpo campo a campo: campo novo aqui precisa
// entrar em todas elas, senão só o Pix e a Pagou o recebem.
export type CardOrder = {
  items: { productId: string; quantity: number }[];
  customer: { name: string; email: string; cpf: string; phone: string };
  address?: Record<string, string | undefined>;
  couponCode?: string;
  shippingOptionId?: string;
  sessionId?: string;
  gclid?: string | null;
  tracking?: Record<string, string | undefined>;
  ga4?: Record<string, string>;
  meta?: { ua: string; fbp?: string; fbc?: string };
};
export type CardResult = {
  ok: boolean;
  status?: "approved" | "pending" | "rejected" | "challenge";
  error?: string;
  orderId?: string;
  amountCents?: number;
  // Desafio 3DS 2.0 (só Mercado Pago): dados pra renderizar o iframe do banco.
  threeDs?: { externalResourceUrl: string; creq: string };
};

// Tokeniza o cartão e cobra no servidor. Retorna um resultado normalizado.
export async function submitCardPayment(params: {
  publicKey: string;
  card: CardFields;
  installments: number;
  order: CardOrder;
  gateway?: string;
}): Promise<CardResult> {
  const { publicKey, card, installments, order, gateway } = params;

  const number = card.number.replace(/\D/g, "");
  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const month = (mm || "").padStart(2, "0");
  const year = aa ? (aa.length === 2 ? `20${aa}` : aa) : "";
  const cpf = order.customer.cpf.replace(/\D/g, "");

  let token: string, paymentMethodId: string, issuerId: string | undefined;
  try {
    await Promise.all([loadSdk(), loadSecurity()]);
    const mp = new (window as any).MercadoPago(publicKey, { locale: "pt-BR" }) as MpSdk;
    const bin = number.slice(0, 8);

    const pm = await mp.getPaymentMethods({ bin });
    paymentMethodId = pm?.results?.[0]?.id ?? "";
    if (!paymentMethodId) return { ok: false, error: "Não reconhecemos a bandeira do cartão." };

    try {
      const issuers = await mp.getIssuers({ paymentMethodId, bin });
      if (issuers?.[0]?.id != null) issuerId = String(issuers[0].id);
    } catch {
      /* emissor é opcional */
    }

    const tk = await mp.createCardToken({
      cardNumber: number,
      cardholderName: card.holder,
      cardExpirationMonth: month,
      cardExpirationYear: year,
      securityCode: card.cvv,
      identificationType: cpf.length > 11 ? "CNPJ" : "CPF",
      identificationNumber: cpf,
    });
    token = tk?.id ?? "";
    if (!token) return { ok: false, error: "Não foi possível validar o cartão. Confira os dados." };
  } catch (e) {
    // A mensagem do SDK é técnica e em inglês: fica no console, não na tela.
    console.error("[mp-card] tokenização", e);
    return { ok: false, error: "Não foi possível validar o cartão. Confira os dados." };
  }

  // Garante o device id pronto (antifraude) antes de enviar a cobrança.
  const deviceId = await waitForDeviceId();

  try {
    const res = await fetch("/api/checkout/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: order.items,
        customer: order.customer,
        couponCode: order.couponCode,
        shippingOptionId: order.shippingOptionId,
        sessionId: order.sessionId,
        gclid: order.gclid,
        tracking: order.tracking,
        ga4: order.ga4,
        meta: order.meta,
        address: order.address,
        card: { token, paymentMethodId, issuerId, installments, deviceId, resumo: resumoCartao(card), ...(gateway ? { gateway } : {}) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return { ok: false, status: data?.status, orderId: data?.orderId, error: data?.error ?? "Não foi possível processar o cartão." };
    return { ok: true, status: data.status, orderId: data.orderId, amountCents: data.amountCents, threeDs: data.threeDs };
  } catch {
    return { ok: false, error: "Erro de rede ao processar o cartão." };
  }
}
