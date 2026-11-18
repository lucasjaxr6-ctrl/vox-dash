import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getBluevisionCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Blue Vision — Pix + cartão.
//
// Doc: https://app.bluevisionsolucoes.com.br/reference (SPA; o conteúdo está
// embutido no JS da página). Revenda da Wishpag: o header de assinatura do
// webhook é `X-Wishpag-Signature`.
//
// Base: https://api.bluevisionsolucoes.com.br/functions/v1
// Auth: `Authorization: Basic base64("<secret_key>:x")` (a secret_key fica em
// Configurações → Integrações no painel deles). Valores em CENTAVOS; mínimo 100.
//
// Pix e cartão no mesmo POST /transactions (`paymentMethod` "PIX" | "CARD").
// Cartão: o número passa pela NOSSA rota (como Appmax e BlackCat), vira token
// em POST /cards/tokenize e a cobrança leva só o token + CVV. Nada é gravado
// nem logado.
//
// Webhook: `postbackUrl` por transação + cadastro opcional no painel deles
// (Configurações → Webhooks), que entrega o "webhook secret" do HMAC.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.bluevisionsolucoes.com.br/functions/v1";

/** Validade do Pix: 30 min, o mesmo que o checkout promete ("vale por 30 minutos"). */
const PIX_VALIDADE_S = 1800;

/** Status da Blue Vision → vocabulário interno. */
export function normalizeBluevisionStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargeback":
      return "CHARGEBACK";
    // "falhou ou expirou" (doc): no Pix o settle não cancela o pedido (fica
    // recuperável); no cartão é recusa.
    case "failed":
      return "DECLINED";
    default:
      return "PENDING";
  }
}

async function secretKey(storeId: string): Promise<string | null> {
  return (await getBluevisionCredentials(storeId))?.secretKey ?? null;
}

async function chamar(storeId: string, caminho: string, opts: { method?: string; body?: unknown } = {}) {
  const key = await secretKey(storeId);
  if (!key) throw new Error("Blue Vision não configurada. Informe a Secret Key no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:x`).toString("base64")}`,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Campos que nunca explicam a recusa, ou que trazem dado do comprador. */
const FORA_DO_MOTIVO = new Set(["customer", "items", "shipping", "metadata", "card", "pix", "boleto", "splits", "refunds", "fee", "ip", "createdAt", "updatedAt", "installments"]);

/**
 * O que a resposta de erro traz de útil, sem dado do comprador (o texto vai para
 * o log e para o pedido). Tudo o que veio preenchido, porque o formato varia:
 * a doc promete `{ error, message, details }`, mas o caso real de 05/11/2026 foi
 * HTTP 400 com uma transação zerada (`id: null`, `amount: 0`, `status: "refused"`).
 */
function restoDoErro(data: any): string {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data)
    .filter(([k, v]) => !FORA_DO_MOTIVO.has(k) && v !== null && v !== "" && v !== 0 && v !== false)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" · ")
    .slice(0, 800);
}

/** Erro deles: `{ error, message, details: [{ field, message }] }`, ou o da `restoDoErro`. */
function apiError(prefix: string, res: Response, data: any): Error {
  const resto = restoDoErro(data);
  console.error("[bluevision]", prefix, res.status, resto);
  const campos = Array.isArray(data?.details)
    ? data.details.map((d: any) => [d?.field, d?.message].filter(Boolean).join(": ")).join("; ")
    : "";
  const detalhe = [data?.message, campos].filter((v) => typeof v === "string" && v).join(" · ") || resto;
  const codigo = typeof data?.error === "string" && data.error ? ` (${data.error})` : "";
  return new Error(`${prefix}: ${detalhe || "sem detalhe"}${codigo} [HTTP ${res.status}]`);
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
type Item = { name: string; quantity: number; unitPriceCents: number };

/** Telefone só com dígitos e sem o 55 redigitado. */
function telefone(bruto: string | undefined): string {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d;
}

/** Endereço no formato deles — só completo (meio endereço é recusa). */
function endereco(a: Address | undefined) {
  if (!a) return null;
  const zipCode = (a.cep || "").replace(/\D/g, "");
  const e = {
    street: (a.street || "").trim().slice(0, 160),
    number: (a.number || "").trim().slice(0, 20) || "S/N",
    neighborhood: (a.neighborhood || "").trim().slice(0, 120),
    city: (a.city || "").trim().slice(0, 120),
    state: (a.uf || "").trim().toUpperCase().slice(0, 2),
    zipCode,
    country: "BR",
    ...(a.complement?.trim() ? { complement: a.complement.trim().slice(0, 120) } : {}),
  };
  return e.street && e.neighborhood && e.city && e.state.length === 2 && zipCode.length === 8 ? e : null;
}

function cliente(c: PixCustomer, a: Address | undefined) {
  const doc = (c.document || "").replace(/\D/g, "");
  const tel = telefone(c.phone);
  const end = endereco(a);
  return {
    name: (c.name || "").trim().slice(0, 120),
    email: (c.email || "").trim().slice(0, 180),
    ...(tel.length >= 10 ? { phone: tel } : {}),
    document: { number: doc, type: doc.length > 11 ? "CNPJ" : "CPF" },
    ...(end ? { address: end } : {}),
  };
}

/**
 * Itens + frete. A doc não diz se a soma dos itens tem de bater com o
 * `amount`, então não arriscamos: produtos + frete quando a conta fecha
 * EXATAMENTE com o valor cobrado; senão (cupom, desconto do Pix, juros do
 * cartão) um item único com o total — mesma regra da BlackCat.
 *
 * Item físico sempre leva `shipping` com o endereço, mesmo com frete grátis: a
 * doc diz que ele é "para produtos físicos", e a FintPag, da mesma família de
 * API, recusa `tangible: true` sem ele. No item único o frete já está no total,
 * daí `amount: 0`, para não cobrar duas vezes.
 */
function itensEFrete(amountCents: number, items: Item[] | undefined, shippingCents: number | undefined, descricao: string, a: Address | undefined) {
  const end = endereco(a);
  const fisico = !!end;
  const lista = (items ?? []).map((it) => ({
    title: (it.name || "Item").slice(0, 120),
    unitPrice: Math.round(it.unitPriceCents),
    quantity: it.quantity,
    tangible: fisico,
  }));
  const frete = Math.max(0, Math.round(shippingCents ?? 0));
  const somaProdutos = lista.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const fecha = lista.length > 0 && somaProdutos + frete === Math.round(amountCents);
  return {
    items: fecha
      ? lista
      : [{ title: descricao.slice(0, 120) || "Pedido", unitPrice: Math.round(amountCents), quantity: 1, tangible: fisico }],
    ...(end ? { shipping: { amount: fecha ? frete : 0, address: end } } : {}),
  };
}

/** Cria uma cobrança Pix. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    postbackUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: Item[];
  },
): Promise<PixCharge> {
  const amount = Math.round(input.amountCents);
  if (amount < 100) throw new Error("Blue Vision: o Pix precisa ser de pelo menos R$ 1,00.");

  const body = {
    amount,
    paymentMethod: "PIX",
    installments: 1,
    customer: cliente(input.customer, input.address),
    ...itensEFrete(amount, input.items, input.shippingCents, input.description || "Pedido", input.address),
    pix: { expiresInSeconds: PIX_VALIDADE_S },
    ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
    ...(input.externalReference ? { externalRef: input.externalReference, metadata: { orderId: input.externalReference } } : {}),
  };

  const { res, data } = await chamar(storeId, "/transactions", { body });
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const qrCode = String(data?.pix?.qrCode ?? "");
  if (!qrCode) throw new Error("Blue Vision não retornou o código Pix (copia e cola).");
  const imagem = data?.pix?.qrCodeUrl;
  return {
    id: String(data?.id ?? ""),
    status: normalizeBluevisionStatus(data?.status),
    qrCode,
    qrCodeUrl: typeof imagem === "string" && /^https?:\/\//.test(imagem) ? imagem : null,
    expiresAt: data?.pix?.expiresAt ? String(data.pix.expiresAt) : null,
  };
}

export type BluevisionCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no cartão: tokeniza (POST /cards/tokenize) e cobra com o token.
 * Os dados crus só passam em memória até a Blue Vision, via TLS — nunca são
 * gravados nem logados.
 */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    externalReference?: string;
    postbackUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: Item[];
    card: { number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<BluevisionCardResult> {
  const ano = (input.card.expirationYear || "").trim();
  const tok = await chamar(storeId, "/cards/tokenize", {
    body: {
      number: (input.card.number || "").replace(/\D/g, ""),
      holderName: (input.card.holderName || "").trim().slice(0, 120),
      expiryMonth: (input.card.expirationMonth || "").padStart(2, "0"),
      expiryYear: ano.length === 2 ? `20${ano}` : ano,
      cvv: input.card.cvv,
    },
  });
  if (!tok.res.ok) {
    // Cartão que a Blue Vision não aceita (número inválido etc.) é problema do
    // CARTÃO, não da integração: vira recusa, com o motivo deles no pedido.
    if (tok.res.status === 422 || tok.data?.error === "invalid_card") {
      return { id: "", status: "DECLINED", statusDetail: String(tok.data?.message ?? tok.data?.error ?? "Cartão inválido") };
    }
    throw apiError("Falha ao tokenizar o cartão", tok.res, tok.data);
  }
  const token = String(tok.data?.token ?? "");
  if (!token) throw new Error("Blue Vision não devolveu o token do cartão.");

  const amount = Math.round(input.amountCents);
  const body = {
    amount,
    paymentMethod: "CARD",
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    customer: cliente(input.customer, input.address),
    ...itensEFrete(amount, input.items, input.shippingCents, input.description || "Pedido", input.address),
    card: { token, ...(input.card.cvv ? { cvv: input.card.cvv } : {}) },
    ...(input.postbackUrl ? { postbackUrl: input.postbackUrl } : {}),
    ...(input.externalReference ? { externalRef: input.externalReference, metadata: { orderId: input.externalReference } } : {}),
  };

  const { res, data } = await chamar(storeId, "/transactions", { body });
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const bruto = String(data?.status ?? "");
  return { id: String(data?.id ?? ""), status: normalizeBluevisionStatus(bruto), statusDetail: bruto };
}

/** Status normalizado de uma transação (ou null). */
export async function getBluevisionTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/transactions/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return typeof data?.status === "string" ? normalizeBluevisionStatus(data.status) : null;
  } catch {
    return null;
  }
}

/** Código de rastreio na transação (PUT /transactions/{id}). Best-effort. */
export async function setBluevisionTracking(storeId: string, id: string, trackingCode: string): Promise<void> {
  try {
    const { res, data } = await chamar(storeId, `/transactions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { deliveryStatus: "shipped", trackingCode: trackingCode.slice(0, 64) },
    });
    if (!res.ok) console.error("[bluevision] rastreio:", res.status, JSON.stringify(data).slice(0, 200));
  } catch (e) {
    console.error("[bluevision] rastreio:", e instanceof Error ? e.message : e);
  }
}

/**
 * Confere a assinatura do webhook: `X-Wishpag-Signature: sha256=<hex>`,
 * HMAC-SHA256 do corpo CRU com o webhook secret. Tempo constante (o exemplo
 * da doc compara com `!==`).
 */
export function verifyBluevisionSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  try {
    const recebida = header.trim().replace(/^sha256=/i, "").toLowerCase();
    const esperada = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(recebida, "utf8");
    const b = Buffer.from(esperada, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Confere a chave com uma LEITURA (lista 1 transação), sem criar nada. 401 é
 * chave errada; o resto é instabilidade. Com a chave aceita, vê se a conta pode
 * cobrar: empresa bloqueada ou sem Pix também passaria na listagem e só
 * apareceria como recusa na venda de verdade.
 */
export async function checkBluevisionCredentials(storeId: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await secretKey(storeId))) return { ok: false, error: "Secret Key não configurada." };
  try {
    const { res } = await chamar(storeId, "/transactions?page=1&limit=1");
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Secret Key recusada pela Blue Vision." };
    if (!res.ok) return { ok: false, error: `Blue Vision respondeu ${res.status}.` };

    const empresa = await chamar(storeId, "/configuracoes/company");
    if (empresa.res.ok) {
      if (empresa.data?.blocked === true) {
        return { ok: false, error: "Chave aceita, mas a empresa está bloqueada na Blue Vision. Só o suporte deles libera." };
      }
      const p = empresa.data?.permissions;
      const fora = [p?.isPixAvailable === false && "Pix", p?.isCreditCardAvailable === false && "cartão"].filter(Boolean);
      if (fora.length) {
        const verbo = fora.length > 1 ? "não estão liberados" : "não está liberado";
        return { ok: false, error: `Chave aceita, mas ${fora.join(" e ")} ${verbo} na conta da Blue Vision. Só o suporte deles libera.` };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a Blue Vision." };
  }
}
