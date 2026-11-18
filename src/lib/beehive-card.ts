import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Cartão Beehive — tokenizado pelo SDK deles (/v1/js).
//
// POR QUE O SDK, e não um POST direto em /v1/card-token:
// o POST direto devolve 200 e um token bem formado, mas a cobrança com ele é
// recusada com "Dados inválidos". Lendo o SDK ofuscado, o `encrypt` faz duas
// coisas a mais antes de tokenizar:
//   • calcula um FINGERPRINT (HopyFingerprint / fingerprint.js);
//   • escolhe a ADQUIRENTE por flag na URL (&simPay=1, &payzu=1, &hunterPay=1…).
// Reproduzir isso por engenharia reversa seria frágil; o único token que já
// gerou cobrança de verdade (transação 134581168) veio do SDK.
//
// O token vai em `card: { hash }` — descoberto sondando os formatos em
// produção: é o único que passa da validação do cartão (os demais devolvem
// "card.number is required"). Mesmo formato da FintPag/HylexPay, do mesmo motor.
//
// Validações locais copiadas do SDK, para errar antes e no campo certo:
// holderName com NOME E SOBRENOME, cvv 3–4 dígitos, ano com 4 dígitos.
// ─────────────────────────────────────────────────────────────────────────────

const SDK_SRC = "https://api.conta.paybeehive.com.br/v1/js";

type BeehiveSdk = {
  setPublicKey: (pk: string) => void | Promise<void>;
  setTestMode?: (on: boolean) => void;
  encrypt: (card: { number: string; holderName: string; expMonth: number; expYear: number; cvv: string }) => unknown;
  is3DSAvailable?: () => boolean | Promise<boolean>;
  authenticate3DS?: (input: { amount: number; currency: string; installments: number; card: unknown }) => unknown;
};

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return resolve();
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
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

function resolveSdk(): BeehiveSdk | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const named = w.BeehivePay || w.Beehive || w.HopyPay;
  return named && typeof named.encrypt === "function" ? (named as BeehiveSdk) : null;
}

/** Pré-carrega o SDK (e, com ele, o fingerprint) assim que o cartão aparece. */
export function preloadBeehive(): void {
  try {
    loadSdk().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Valida como a Beehive valida, devolvendo a mensagem do campo certo. */
export function validarCartaoBeehive(card: CardFields): string | null {
  if (card.number.replace(/\D/g, "").length < 13) return "Número do cartão inválido.";

  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const mes = Number(mm);
  if (!mes || mes < 1 || mes > 12) return "Mês de validade inválido.";
  const ano = aa ? (aa.length === 2 ? `20${aa}` : aa) : "";
  if (ano.length !== 4 || !Number(ano)) return "Ano de validade inválido.";

  if (!/^\d{3,4}$/.test(card.cvv || "")) return "O código de segurança (CVV) tem 3 ou 4 dígitos.";
  if ((card.holder || "").trim().split(/\s+/).filter(Boolean).length < 2) {
    return "Escreva o nome como está no cartão, com nome e sobrenome.";
  }
  return null;
}

/**
 * Extrai o token do retorno do `encrypt` e DESCREVE o que veio.
 *
 * A descrição existe porque a doc promete `bhp_tok_…` e o que chega é um blob
 * base64 de ~400 caracteres. Ou a doc está velha, ou o token certo está noutro
 * campo do objeto e estamos mandando o errado — sem ver a forma do retorno, as
 * duas hipóteses são indistinguíveis daqui.
 *
 * Só NOMES de campo e prefixo vão para o registro; nada de valor sensível.
 */
function extrairToken(r: unknown): { token: string; forma: string } {
  if (typeof r === "string") return { token: r, forma: `string(${r.length}) ${r.slice(0, 8)}` };
  if (r && typeof r === "object") {
    const o = r as Record<string, any>;
    const chaves = Object.keys(o).slice(0, 8).join(",");
    // `bhp_tok_` primeiro: se existir em qualquer campo, é ele que a doc descreve.
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && v.startsWith("bhp_tok_")) return { token: v, forma: `obj{${chaves}} bhp_tok em ${k}` };
    }
    for (const k of ["token", "hash", "cardToken", "id", "encrypted", "data"]) {
      const v = o[k];
      if (typeof v === "string" && v.length > 20) return { token: v, forma: `obj{${chaves}} usei ${k}` };
    }
    return { token: "", forma: `obj{${chaves}} nenhum campo servia` };
  }
  return { token: "", forma: `vazio(${typeof r})` };
}

/** Tokeniza pelo SDK e cobra pela nossa rota. */
export async function submitBeehiveCardPayment(params: {
  publicKey: string;
  card: CardFields;
  installments: number;
  order: CardOrder;
  amountCents?: number;
  gateway?: string;
}): Promise<CardResult> {
  const { publicKey, card, installments, order, amountCents, gateway } = params;

  const erro = validarCartaoBeehive(card);
  if (erro) return { ok: false, error: erro };
  if (!publicKey) return { ok: false, error: "Cartão indisponível no momento. Pague com Pix." };

  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const dados = {
    number: card.number.replace(/\D/g, ""),
    holderName: card.holder.trim(),
    // O SDK recebe expMonth/expYear e converte para expiration* ao enviar.
    expMonth: Number(mm),
    expYear: Number(aa && aa.length === 2 ? `20${aa}` : aa),
    cvv: card.cvv,
  };

  let token = "";
  // Estado do fingerprint. O `encrypt` do SDK só embute o fingerprint se
  // `window.HopyFingerprint` existir; sem ele o token nasce incompleto e a
  // cobrança é recusada com "Dados inválidos", sem dizer o motivo. Registrar
  // isso aqui evita depender do console do navegador para descobrir.
  let fingerprint: "ok" | "ausente" = "ausente";
  /** Forma do retorno do `encrypt`, para o registro do erro. */
  let forma = "";
  try {
    await loadSdk();
    const sdk = resolveSdk();
    if (!sdk) return { ok: false, error: "Não foi possível carregar o pagamento. Recarregue a página." };
    if (typeof window !== "undefined" && (window as any).HopyFingerprint) fingerprint = "ok";

    await sdk.setPublicKey(publicKey);
    sdk.setTestMode?.(false);

    // 3DS quando o emissor exigir. Falha aqui não interrompe: o emissor ainda
    // pode aprovar sem, e travar recusaria venda boa.
    try {
      if (typeof sdk.is3DSAvailable === "function" && (await sdk.is3DSAvailable())) {
        await sdk.authenticate3DS?.({
          amount: Math.round(amountCents ?? 0),
          currency: "brl",
          installments,
          card: dados,
        });
      }
    } catch {
      /* segue sem 3DS */
    }

    const r = extrairToken(await sdk.encrypt(dados));
    token = r.token;
    forma = r.forma;
  } catch {
    return { ok: false, error: "Não foi possível validar o cartão. Tente novamente." };
  }

  if (!token) return { ok: false, error: "Não foi possível validar o cartão. Confira os dados e tente de novo." };

  try {
    const res = await fetch("/api/checkout/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: order.items,
        customer: order.customer,
        couponCode: order.couponCode,
        shippingOptionId: order.shippingOptionId,
        gclid: order.gclid,
        tracking: order.tracking,
        ga4: order.ga4,
        meta: order.meta,
        address: order.address,
        card: { installments, token, fingerprint, tokenShape: forma, resumo: resumoCartao(card), ...(gateway ? { gateway } : {}) },
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
