import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Cartão PagNiv — tokenizado no navegador.
//
// Aqui NÃO existe SDK: a tokenização é um POST comum do navegador para a URL que
// a PagNiv informa, autenticado pela chave pública na query (`?appId=`). Menos
// mágica que Beehive/Shield, e nada para carregar antes.
//
// A URL e a chave vêm do NOSSO servidor (/api/checkout/pagniv/card-config), que
// por sua vez as lê de GET /v1/charges/card-config. A doc é explícita: não fixar
// no código, "assim, se a Pagniv trocar de infraestrutura de processamento, sua
// integração continua funcionando sem alteração".
//
// Sem caminho cru de reserva: o backend deles só aceita `cardToken`.
// ─────────────────────────────────────────────────────────────────────────────

export type PagnivCardConfig = { publicKey: string; tokenizeUrl: string; maxInstallments: number; cardEnabled: boolean };

let cache: { em: number; cfg: PagnivCardConfig } | null = null;

/** Busca (e guarda) a configuração de tokenização da loja. */
export async function loadPagnivCardConfig(): Promise<PagnivCardConfig | null> {
  if (cache && Date.now() - cache.em < 5 * 60_000) return cache.cfg;
  try {
    const res = await fetch("/api/checkout/pagniv/card-config");
    if (!res.ok) return null;
    const cfg = (await res.json()) as PagnivCardConfig;
    if (!cfg?.publicKey || !cfg?.tokenizeUrl) return null;
    cache = { em: Date.now(), cfg };
    return cfg;
  } catch {
    return null;
  }
}

/** Pré-carrega a config assim que o cartão PagNiv fica disponível. */
export function preloadPagniv(): void {
  loadPagnivCardConfig().catch(() => {});
}

/** O token vem em `id` na resposta da tokenização (ex.: token_xxxxxxxx). */
function extractToken(r: unknown): string {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (typeof r === "object") {
    const o = r as Record<string, any>;
    for (const v of [o.id, o.token, o.cardToken, o.data?.id, o.data?.token]) {
      if (typeof v === "string" && v) return v;
    }
  }
  return "";
}

/** Tokeniza na PagNiv e cobra no nosso servidor. */
export async function submitPagnivCardPayment(params: {
  card: CardFields;
  installments: number;
  order: CardOrder;
  gateway?: string;
}): Promise<CardResult> {
  const { card, installments, order, gateway } = params;

  const number = card.number.replace(/\D/g, "");
  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const expMonth = Number(mm);
  const expYear = Number(aa ? (aa.length === 2 ? aa : aa.slice(-2)) : "");

  if (number.length < 13) return { ok: false, error: "Número do cartão inválido." };
  if (!expMonth || !expYear) return { ok: false, error: "Validade do cartão inválida." };
  if (!card.cvv) return { ok: false, error: "Informe o código de segurança (CVV)." };

  const cfg = await loadPagnivCardConfig();
  if (!cfg) return { ok: false, error: "Não foi possível carregar o pagamento. Recarregue a página." };
  if (!cfg.cardEnabled) return { ok: false, error: "Cartão indisponível no momento. Pague com Pix." };

  let token = "";
  try {
    const url = `${cfg.tokenizeUrl}${cfg.tokenizeUrl.includes("?") ? "&" : "?"}appId=${encodeURIComponent(cfg.publicKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "card",
        card: { number, holder_name: card.holder, exp_month: expMonth, exp_year: expYear, cvv: card.cvv },
      }),
    });
    if (!res.ok) return { ok: false, error: "Não foi possível validar o cartão. Confira os dados e tente de novo." };
    token = extractToken(await res.json().catch(() => null));
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
        card: { installments, token, resumo: resumoCartao(card), ...(gateway ? { gateway } : {}) },
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
