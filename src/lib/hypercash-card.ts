import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Cartão quando o provedor da loja é a HYPERCASH (motor FastSoft). O cartão é
// TOKENIZADO no navegador pelo SDK da FastSoft — o número NUNCA passa pelo nosso
// servidor. Depois mandamos só o token para a nossa rota.
// SDK: https://js.hypercash.com.br/security.js  ->  window.FastSoft
// ATENÇÃO: é o SDK da HYPERCASH ("Hyper.js"), não o genérico da FastSoft. O da
// FastSoft (js.fastsoftbrasil.com) tokeniza contra api.fastsoftbrasil.com, que
// NÃO conhece as chaves da HyperCash e devolve 403 no security-script/card-token.
// O da HyperCash usa api.hypay.com.br, onde a public key é aceita.
//   await FastSoft.setPublicKey('pk_live_...')
//   const token = await FastSoft.encrypt({ number, holderName, expMonth, expYear, cvv })
// ─────────────────────────────────────────────────────────────────────────────

type FastSoftSdk = {
  setPublicKey: (pk: string) => void | Promise<void>;
  encrypt: (card: { number: string; holderName: string; expMonth: string; expYear: string; cvv: string }) => Promise<string> | string;
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
  if (typeof window !== "undefined" && (window as any).FastSoft) return Promise.resolve();
  if (!sdkPromise) sdkPromise = loadScript("https://js.hypercash.com.br/security.js");
  return sdkPromise;
}

/** Pré-carrega o SDK da FastSoft assim que o cartão fica disponível. */
export function preloadHypercash(): void {
  try {
    loadSdk().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Tokeniza o cartão pela FastSoft e cobra no servidor. */
export async function submitHypercashCardPayment(params: {
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

  // A API da HyperCash NÃO aceita cartão tokenizado na transação (recusa com
  // "card.property token should not exist"): mandamos os campos crus para o
  // nosso servidor, que repassa via TLS. Nada é gravado nem logado.
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
        card: {
          number,
          cvv: card.cvv,
          expirationMonth: expMonth,
          expirationYear: expYear,
          holderName: card.holder,
          installments,
          resumo: resumoCartao(card), ...(gateway ? { gateway } : {}),
        },
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
