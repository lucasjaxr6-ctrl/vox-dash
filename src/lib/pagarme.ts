import "server-only";
import { getPagarmeCredentials } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Pagar.me (API v5 / "core") — Pix + cartão.
//
// Tudo nasce como PEDIDO: `POST /orders` com `items`, `customer` e `payments`.
// O valor cobrado é calculado por ELES (soma dos itens + `shipping.amount`), não
// informado por nós — por isso a montagem dos itens tem que fechar exatamente
// com o total (ver itensEFrete).
//
// Auth: Basic base64("sk_…:") — a chave secreta como usuário, senha vazia.
//
// Cartão DIRETO (dados crus via TLS, nunca gravados nem logados), como Appmax e
// BlackCat. A alternativa da Pagar.me (token no navegador com a public key)
// exige cadastrar o domínio de cada checkout no painel deles — inviável numa
// plataforma com domínio próprio por loja.
//
// Webhook: cadastrado UMA VEZ no painel da conta (não vai por cobrança) e sem
// assinatura. O corpo só aponta o pedido; o status vem do GET /orders/{id},
// com a chave da loja.
//
// Doc: https://docs.pagar.me/llms.txt
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.pagar.me/core/v5";

/**
 * Status da COBRANÇA (charge) → vocabulário interno.
 *
 * Olhamos a cobrança e não o pedido: só ela distingue estorno e chargeback,
 * e o pedido fica "paid" mesmo depois de a cobrança ser estornada.
 */
export function normalizePagarmeStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
    case "overpaid":
    case "captured":
      return "APPROVED";
    // Estorno parcial: o pedido continua pago. Só o total desfaz a venda.
    case "partial_refunded":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
      return "CHARGEBACK";
    case "failed":
    case "canceled":
    case "cancelled":
    case "voided":
    case "not_authorized":
    case "with_error":
      return "DECLINED";
    // pending, processing, underpaid, waiting_payment: ainda podem mudar.
    default:
      return "PENDING";
  }
}

async function auth(storeId: string): Promise<string | null> {
  const creds = await getPagarmeCredentials(storeId);
  return creds ? "Basic " + Buffer.from(`${creds.secretKey}:`).toString("base64") : null;
}

async function chamar(storeId: string, caminho: string, body?: unknown) {
  const a = await auth(storeId);
  if (!a) throw new Error("Pagar.me não configurada. Informe a chave secreta no painel.");
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: a,
      accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

/** Erro de validação deles: `{ message, errors: { "campo": ["msg"] } }`. */
function apiError(prefix: string, res: Response, data: any): Error {
  console.error("[pagarme]", prefix, res.status, JSON.stringify(data).slice(0, 500));
  const campos = data?.errors && typeof data.errors === "object"
    ? Object.entries(data.errors)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join("; ")
    : "";
  const detalhe = [data?.message, campos].filter(Boolean).join(" — ");
  return new Error(`${prefix}: ${detalhe || "sem detalhe"} [HTTP ${res.status}]`);
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };
type Item = { name: string; quantity: number; unitPriceCents: number; code?: string };

/** Telefone em DDD + número, que é como a Pagar.me pede. */
function celular(bruto: string | undefined) {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { country_code: "55", area_code: d.slice(0, 2), number: d.slice(2) };
}

/** Endereço no formato deles: `line_1` = "número, rua, bairro", nessa ordem. */
function endereco(a: Address | undefined) {
  if (!a) return null;
  const zip = (a.cep || "").replace(/\D/g, "");
  const rua = (a.street || "").trim();
  const uf = (a.uf || "").trim().toUpperCase();
  const cidade = (a.city || "").trim();
  if (!rua || zip.length !== 8 || uf.length !== 2 || !cidade) return null;
  return {
    line_1: [(a.number || "S/N").trim(), rua, (a.neighborhood || "").trim()].filter(Boolean).join(", ").slice(0, 256),
    ...(a.complement?.trim() ? { line_2: a.complement.trim().slice(0, 128) } : {}),
    zip_code: zip,
    city: cidade.slice(0, 64),
    state: uf,
    country: "BR",
  };
}

function cliente(c: PixCustomer, addr: ReturnType<typeof endereco>) {
  const doc = (c.document || "").replace(/\D/g, "");
  const cnpj = doc.length === 14;
  const tel = celular(c.phone);
  return {
    name: (c.name || "").trim().slice(0, 64),
    email: (c.email || "").trim().slice(0, 64),
    document: doc,
    document_type: cnpj ? "CNPJ" : "CPF",
    type: cnpj ? "company" : "individual",
    ...(tel ? { phones: { mobile_phone: tel } } : {}),
    ...(addr ? { address: addr } : {}),
  };
}

/**
 * Itens + entrega.
 *
 * A Pagar.me cobra `soma(itens) + shipping.amount`. Se mandarmos os produtos
 * com preço cheio numa venda com cupom ou desconto do Pix, ela cobraria MAIS do
 * que o checkout mostrou. Então: produtos + frete quando a conta fecha com o
 * total; senão um item único com o total exato e frete zero no `shipping`.
 */
function itensEFrete(
  amountCents: number,
  items: Item[] | undefined,
  shippingCents: number | undefined,
  descricao: string,
  nome: string,
  telefone: string | undefined,
  addr: ReturnType<typeof endereco>,
) {
  const total = Math.round(amountCents);
  const frete = Math.max(0, Math.round(shippingCents ?? 0));
  const lista = (items ?? []).map((it, i) => ({
    amount: Math.round(it.unitPriceCents),
    description: (it.name || "Item").slice(0, 256),
    quantity: it.quantity,
    code: (it.code || `item-${i + 1}`).slice(0, 52),
  }));
  const fecha = lista.length > 0 && lista.every((i) => i.amount > 0) && lista.reduce((s, i) => s + i.amount * i.quantity, 0) + frete === total;
  const itens = fecha ? lista : [{ amount: total, description: descricao.slice(0, 256) || "Pedido", quantity: 1, code: "pedido" }];
  const freteCobrado = fecha ? frete : 0;
  const shipping = addr
    ? {
        amount: freteCobrado,
        description: "Entrega",
        recipient_name: nome.slice(0, 64),
        ...(telefone ? { recipient_phone: telefone.replace(/\D/g, "").slice(-11) } : {}),
        address: addr,
      }
    : null;
  return { items: itens, ...(shipping ? { shipping } : {}) };
}

/** A cobrança mais recente do pedido (a que importa para status e motivo). */
function cobrancaDe(pedido: any): any {
  const lista = Array.isArray(pedido?.charges) ? pedido.charges : [];
  return lista[lista.length - 1] ?? {};
}

/** Nome da loja na fatura: sem acento, só letras/números, até 13 (limite PSP). */
function descritor(nome: string | undefined): string | undefined {
  const s = (nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, 13)
    .trim();
  return s || undefined;
}

type Base = {
  amountCents: number;
  customer: PixCustomer;
  description?: string;
  /** Nosso orderId: vai como `code` do pedido e volta nos webhooks. */
  externalReference?: string;
  address?: Address;
  shippingCents?: number;
  items?: Item[];
};

function pedidoBase(input: Base) {
  const addr = endereco(input.address);
  return {
    ...(input.externalReference ? { code: input.externalReference.slice(0, 52) } : {}),
    customer: cliente(input.customer, addr),
    ...itensEFrete(input.amountCents, input.items, input.shippingCents, input.description || "Pedido", input.customer.name, input.customer.phone, addr),
    ...(input.externalReference ? { metadata: { pedido: input.externalReference } } : {}),
    closed: true,
  };
}

/** Cria um Pix (pedido com pagamento Pix). */
export async function createPixCharge(storeId: string, input: Base & { expiresInSeconds?: number }): Promise<PixCharge> {
  const body = {
    ...pedidoBase(input),
    payments: [{ payment_method: "pix", pix: { expires_in: Math.max(300, Math.round(input.expiresInSeconds ?? 86400)) } }],
  };
  const { res, data } = await chamar(storeId, "/orders", body);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data);

  const ch = cobrancaDe(data);
  const tx = ch?.last_transaction ?? {};
  const qrCode = String(tx.qr_code ?? "");
  if (!qrCode) {
    // Pedido criado mas sem QR: costuma ser conta sem Pix habilitado ou dado
    // do comprador recusado. O motivo vem na transação.
    const motivo = tx?.gateway_response?.errors?.map((e: any) => e?.message).filter(Boolean).join("; ");
    console.error("[pagarme] Pix sem QR:", ch?.status, tx?.status, motivo);
    throw new Error(`Pagar.me não retornou o código Pix${motivo ? `: ${motivo}` : ""}.`);
  }
  return {
    // Guardamos o id do PEDIDO (or_…): é por ele que consultamos o status.
    id: String(data?.id ?? ""),
    status: normalizePagarmeStatus(ch?.status),
    qrCode,
    qrCodeUrl: typeof tx.qr_code_url === "string" && tx.qr_code_url.startsWith("https://") ? tx.qr_code_url : null,
    expiresAt: tx.expires_at ? String(tx.expires_at) : null,
  };
}

export type PagarmeCardResult = { id: string; status: string; statusDetail: string };

/** Cobrança no cartão (dados crus, repassados via TLS — nunca gravados). */
export async function createCardPayment(
  storeId: string,
  input: Base & {
    installments: number;
    storeName?: string;
    card: { number?: string; cvv?: string; expirationMonth?: string; expirationYear?: string; holderName?: string };
  },
): Promise<PagarmeCardResult> {
  const base = pedidoBase(input);
  const cobranca = endereco(input.address);
  const body = {
    ...base,
    payments: [
      {
        payment_method: "credit_card",
        credit_card: {
          installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
          ...(descritor(input.storeName) ? { statement_descriptor: descritor(input.storeName) } : {}),
          operation_type: "auth_and_capture",
          card: {
            number: (input.card.number || "").replace(/\D/g, ""),
            // A doc recusa número e caractere especial no nome do titular.
            holder_name: (input.card.holderName || "")
              .normalize("NFD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/[^A-Za-z ]/g, "")
              .trim()
              .slice(0, 64),
            exp_month: Number(input.card.expirationMonth),
            exp_year: Number(input.card.expirationYear),
            cvv: input.card.cvv,
            // O endereço de cobrança é exigido pelo antifraude deles.
            ...(cobranca ? { billing_address: cobranca } : {}),
          },
        },
      },
    ],
  };

  const { res, data } = await chamar(storeId, "/orders", body);
  if (!res.ok) throw apiError("Falha ao processar o cartão", res, data);

  const ch = cobrancaDe(data);
  const tx = ch?.last_transaction ?? {};
  const status = normalizePagarmeStatus(ch?.status);
  // Motivo legível para o lojista: retorno da adquirente, erro do gateway ou
  // a decisão do antifraude — o que vier.
  const detalhe = [
    tx?.acquirer_return_code,
    tx?.acquirer_message,
    ...(Array.isArray(tx?.gateway_response?.errors) ? tx.gateway_response.errors.map((e: any) => e?.message) : []),
    tx?.antifraud_response?.status ? `antifraude: ${tx.antifraud_response.status}` : null,
  ]
    .filter(Boolean)
    .join(" — ");
  return { id: String(data?.id ?? ""), status, statusDetail: detalhe || String(ch?.status ?? tx?.status ?? "") };
}

/** Status normalizado de um pedido (ou null). */
export async function getPagarmeTransactionStatus(storeId: string, id: string): Promise<string | null> {
  try {
    const { res, data } = await chamar(storeId, `/orders/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const ch = cobrancaDe(data);
    const bruto = ch?.status ?? data?.status;
    return typeof bruto === "string" ? normalizePagarmeStatus(bruto) : null;
  } catch {
    return null;
  }
}

/** Confere a chave listando 1 pedido (leitura — não cria nada). */
export async function checkPagarmeCredentials(storeId: string): Promise<{ ok: boolean; error?: string; ambiente?: string }> {
  const creds = await getPagarmeCredentials(storeId);
  if (!creds) return { ok: false, error: "Chave secreta não configurada." };
  try {
    const { res } = await chamar(storeId, "/orders?page=1&size=1");
    if (res.status === 401) return { ok: false, error: "Chave recusada pela Pagar.me." };
    if (res.status === 403) return { ok: false, error: "Chave sem permissão nesta conta Pagar.me." };
    if (!res.ok) return { ok: false, error: `Pagar.me respondeu ${res.status}.` };
    return { ok: true, ambiente: creds.secretKey.startsWith("sk_test_") ? "teste" : "produção" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao falar com a Pagar.me." };
  }
}
