import type { CardFields, CardOrder, CardResult } from "./mp-card";
import { resumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Cartão Nuvra: tokenizado no navegador, sem SDK.
//
// A config vem do NOSSO servidor (/api/checkout/nuvra/card-config), que a lê de
// GET /card-tokenization com a chave secreta. O formato do corpo depende do
// `scheme` da conta (doc da Nuvra, "Passo 2"):
//   • s1: { type: "card", card: { number, holder_name, exp_month (int),
//           exp_year (4 dígitos), cvv } } → resposta { id: "token_…" }.
//           Mesmo formato da PagNiv.
//   • s2: { publishableKey, card: { number, expMonth "MM", expYear "AA", cvv,
//           holderName } } → resposta { token: "token_…" }.
//   • sandbox (chave nvr_dev_): sem chamada; o token é "sbxtok_" + o número.
//           Último dígito par aprova, ímpar recusa.
// O token vale ~60 s: tokenizar e cobrar em seguida, nunca antes.
//
// A URL de tokenização é do provedor e precisa estar no connect-src do CSP
// (next.config.js). O "Testar chave" do painel mostra qual é.
// ─────────────────────────────────────────────────────────────────────────────

export type NuvraCardConfig = { scheme: string; publicKey: string; tokenizeUrl: string; maxInstallments: number };

let cache: { em: number; cfg: NuvraCardConfig } | null = null;

/** Busca (e guarda) a configuração de tokenização da loja. */
export async function loadNuvraCardConfig(): Promise<NuvraCardConfig | null> {
  if (cache && Date.now() - cache.em < 5 * 60_000) return cache.cfg;
  try {
    const res = await fetch("/api/checkout/nuvra/card-config");
    if (!res.ok) return null;
    const cfg = (await res.json()) as NuvraCardConfig;
    if (!cfg?.scheme || (cfg.scheme !== "sandbox" && !cfg.tokenizeUrl)) return null;
    cache = { em: Date.now(), cfg };
    return cfg;
  } catch {
    return null;
  }
}

/** Pré-carrega a config assim que o cartão Nuvra fica disponível. */
export function preloadNuvra(): void {
  loadNuvraCardConfig().catch(() => {});
}

/** O token vem em `id` (s1) ou `token` (s2). */
function extractToken(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const o = r as Record<string, any>;
  for (const v of [o.id, o.token, o.data?.id, o.data?.token]) {
    if (typeof v === "string" && v) return v;
  }
  return "";
}

/** Tokeniza na Nuvra e cobra no nosso servidor. */
export async function submitNuvraCardPayment(params: {
  card: CardFields;
  installments: number;
  order: CardOrder;
  gateway?: string;
}): Promise<CardResult> {
  const { card, installments, order, gateway } = params;

  const number = card.number.replace(/\D/g, "");
  const [mm, aa] = card.expiry.split("/").map((s) => s.trim());
  const mes = Number(mm);
  const ano2 = (aa || "").slice(-2);

  if (number.length < 13) return { ok: false, error: "Número do cartão inválido." };
  if (!mes || mes > 12 || ano2.length !== 2) return { ok: false, error: "Validade do cartão inválida." };
  if (!card.cvv) return { ok: false, error: "Informe o código de segurança (CVV)." };

  const cfg = await loadNuvraCardConfig();
  if (!cfg) return { ok: false, error: "Não foi possível carregar o pagamento. Recarregue a página." };

  let token = "";
  if (cfg.scheme === "sandbox") {
    token = `sbxtok_${number}`;
  } else {
    const corpo =
      cfg.scheme === "s2"
        ? {
            publishableKey: cfg.publicKey,
            card: { number, expMonth: String(mes).padStart(2, "0"), expYear: ano2, cvv: card.cvv, holderName: card.holder },
          }
        : { type: "card", card: { number, holder_name: card.holder, exp_month: mes, exp_year: 2000 + Number(ano2), cvv: card.cvv } };
    try {
      const res = await fetch(cfg.tokenizeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (!res.ok) return { ok: false, error: "Não foi possível validar o cartão. Confira os dados e tente de novo." };
      token = extractToken(await res.json().catch(() => null));
    } catch {
      // Inclui bloqueio do CSP: o navegador recusa o fetch para um host fora
      // do connect-src e aqui só chega um TypeError.
      return { ok: false, error: "Não foi possível validar o cartão. Tente novamente." };
    }
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
        sessionId: order.sessionId,
        gclid: order.gclid,
        tracking: order.tracking,
        ga4: order.ga4,
        meta: order.meta,
        address: order.address,
        // Titular: a Nuvra exige nome e documento do titular, que pode não ser
        // o comprador. O CPF passa pela mesma conferência dos outros gateways.
        card: {
          installments,
          token,
          holderName: card.holder,
          holderDocument: card.cpf,
          resumo: resumoCartao(card),
          ...(gateway ? { gateway } : {}),
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
