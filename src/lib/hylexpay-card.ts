import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { submitAppmaxCardPayment } from "./appmax-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Cartão HylexPay (motor Shield, igual FintPag) TOKENIZADO no navegador. O SDK
// /v1/js: (1) tokeniza -> `hash` (número nunca passa pelo nosso servidor);
// (2) roda o antifraude e gera o `sessionId` (fingerprint). Se o SDK falhar em
// qualquer passo, caímos no fluxo CRU (submitAppmaxCardPayment) — nunca quebra.
// ─────────────────────────────────────────────────────────────────────────────

const SDK_SRC = "https://api.hylexpay.com/v1/js";

type HylexpaySdk = {
  setPublicKey: (pk: string) => void | Promise<void>;
  encrypt: (card: { number: string; holderName: string; expMonth: string; expYear: string; cvv: string }) => unknown;
  sessionId?: string;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (typeof window !== "undefined" && resolveSdk()) return Promise.resolve();
  if (!sdkPromise) sdkPromise = loadScript(SDK_SRC);
  return sdkPromise;
}

/** Acha o objeto global do SDK (nome ofuscado): Hylexpay/Shield ou varre o window. */
function resolveSdk(): HylexpaySdk | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const named = w.HylexPay || w.Hylexpay || w.Shield || w.ShieldSDK;
  if (named && typeof named.setPublicKey === "function" && typeof named.encrypt === "function") return named as HylexpaySdk;
  for (const k of Object.keys(w)) {
    try {
      const o = w[k];
      if (o && typeof o === "object" && typeof o.setPublicKey === "function" && typeof o.encrypt === "function") return o as HylexpaySdk;
    } catch {
      /* cross-origin getter, ignora */
    }
  }
  return null;
}

/** Pré-carrega o SDK assim que o cartão HylexPay fica disponível. */
export function preloadHylexpay(): void {
  try {
    loadSdk().catch(() => {});
  } catch {
    /* ignore */
  }
}

function extractHash(r: unknown): string {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["hash", "token", "cardHash", "encrypted", "card", "data"]) {
      const v = o[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}
function extractSession(r: unknown, sdk: HylexpaySdk): string {
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["sessionId", "session", "fingerprint", "deviceId"]) {
      const v = o[k];
      if (typeof v === "string" && v) return v;
    }
  }
  return typeof sdk.sessionId === "string" ? sdk.sessionId : "";
}

/** Tokeniza o cartão pela HylexPay e cobra no servidor; cai no cru se o SDK falhar. */
export async function submitHylexpayCardPayment(params: {
  publicKey: string;
  card: CardFields;
  installments: number;
  order: CardOrder;
  gateway?: string;
}): Promise<CardResult> {
  const { publicKey, card, installments, order, gateway } = params;

  const number = card.number.replace(/\D/g, "");
  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const expMonth = (mm || "").padStart(2, "0");
  const expYear = aa ? (aa.length === 2 ? `20${aa}` : aa) : "";

  if (number.length < 13) return { ok: false, error: "Número do cartão inválido." };
  if (!expMonth || !expYear) return { ok: false, error: "Validade do cartão inválida." };
  if (!card.cvv) return { ok: false, error: "Informe o código de segurança (CVV)." };

  let hash = "";
  let sessionId = "";
  if (publicKey) {
    try {
      await loadSdk();
      const sdk = resolveSdk();
      if (sdk) {
        await sdk.setPublicKey(publicKey);
        const r = await sdk.encrypt({ number, holderName: card.holder, expMonth, expYear, cvv: card.cvv });
        hash = extractHash(r);
        sessionId = extractSession(r, sdk);
      }
    } catch {
      hash = "";
      sessionId = "";
    }
  }

  // Sem hash -> fluxo cru (mesma rota; a lib do servidor manda os campos crus).
  if (!hash) {
    return submitAppmaxCardPayment({ card, installments, order, gateway });
  }

  try {
    const res = await fetch("/api/checkout/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: order.items,
        customer: order.customer,
        couponCode: order.couponCode,
        shippingOptionId: order.shippingOptionId,
        ...(sessionId ? { sessionId } : {}),
        gclid: order.gclid,
        tracking: order.tracking,
        ga4: order.ga4,
        meta: order.meta,
        address: order.address,
        card: { installments, hash, resumo: resumoCartao(card), ...(gateway ? { gateway } : {}) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return { ok: false, status: data?.status, orderId: data?.orderId, error: data?.error ?? "Não foi possível processar o cartão." };
    return { ok: true, status: data.status, orderId: data.orderId, amountCents: data.amountCents };
  } catch {
    return { ok: false, error: "Erro de rede ao processar o cartão." };
  }
}
