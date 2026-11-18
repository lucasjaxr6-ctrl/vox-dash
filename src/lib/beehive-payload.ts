// Montagem PURA do corpo das transações Beehive — sem rede, sem banco, sem
// `server-only`. Fica separada de `beehive.ts` pelo mesmo motivo de
// `pagou-payload.ts`: assim o contrato pode ser conferido por um script antes de
// a primeira cobrança de verdade sair.
//
// O contrato exige, em TODA transação: amount, paymentMethod, customer
// (name/email/document), items[] (title/unitPrice/quantity/tangible) e metadata
// (provider/user_email/order_id/checkout_url/shop_url). A doc é explícita:
// "omitir metadata invalida a requisição".

export type BeehiveAddress = {
  cep?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  city?: string;
  uf?: string;
};

export type BeehiveCustomerInput = { name: string; email: string; document?: string; phone?: string };
export type BeehiveItemInput = { name: string; quantity: number; unitPriceCents: number };

/** Documento com `type` derivado do tamanho: 11 dígitos = CPF, 14 = CNPJ. */
export function buildCustomer(customer: BeehiveCustomerInput) {
  const doc = (customer.document || "").replace(/\D/g, "");
  const phone = (customer.phone || "").replace(/\D/g, "");
  return {
    name: customer.name,
    email: customer.email,
    document: { number: doc, type: doc.length > 11 ? "cnpj" : "cpf" },
    ...(phone ? { phone } : {}),
  };
}

/** Endereço; null quando falta o mínimo (rua + CEP) — meio endereço reprova tudo. */
export function mapAddress(a: BeehiveAddress | undefined) {
  if (!a) return null;
  const cep = (a.cep || "").replace(/\D/g, "");
  const street = (a.street || "").trim();
  if (!street || !cep) return null;
  return {
    street: street.slice(0, 60),
    streetNumber: (a.number || "S/N").replace(/[^0-9A-Za-z/]/g, "").slice(0, 10) || "S/N",
    neighborhood: (a.neighborhood || "").trim().slice(0, 60) || "Centro",
    city: (a.city || "").trim().slice(0, 60),
    state: (a.uf || "").trim().toUpperCase().slice(0, 2),
    zipCode: cep.slice(0, 8),
    country: "BR",
    ...(a.complement?.trim() ? { complement: a.complement.trim().slice(0, 60) } : {}),
  };
}

/** Itens no formato da Beehive. Sem itens, cai num item único com o total. */
export function buildItems(items: BeehiveItemInput[] | undefined, fallbackTitle: string, amountCents: number) {
  const base = items?.length ? items : [{ name: fallbackTitle, quantity: 1, unitPriceCents: amountCents }];
  return base.map((it) => ({
    title: (it.name || "Item").slice(0, 120),
    unitPrice: Math.round(it.unitPriceCents),
    quantity: it.quantity,
    tangible: true,
  }));
}

/**
 * As cinco chaves obrigatórias de `metadata`, em snake_case.
 *
 * `shop_url` é a VITRINE e `checkout_url` é o checkout — diferentes de
 * propósito. Repetir o subdomínio de pagamento nos dois foi exatamente o que a
 * HyperCash apontou como "duplicado".
 */
export function buildMetadata(input: {
  storeName?: string;
  userEmail: string;
  orderId?: string;
  checkoutUrl?: string;
  shopUrl?: string;
}): Record<string, string> {
  const checkout = input.checkoutUrl ?? "";
  return {
    provider: input.storeName ? `VoxCheckout · ${input.storeName}` : "VoxCheckout",
    user_email: input.userEmail,
    order_id: input.orderId ?? "",
    checkout_url: checkout,
    shop_url: input.shopUrl || checkout,
  };
}

type Comum = {
  amountCents: number;
  customer: BeehiveCustomerInput;
  description?: string;
  items?: BeehiveItemInput[];
  address?: BeehiveAddress;
  shippingCents?: number;
  payerIp?: string;
  postbackUrl?: string;
  metadata: Record<string, string>;
};

function base(input: Comum, paymentMethod: "pix" | "credit_card"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    paymentMethod,
    customer: buildCustomer(input.customer),
    items: buildItems(input.items, input.description || "Pedido", input.amountCents),
    metadata: input.metadata,
  };
  const address = mapAddress(input.address);
  if (address) body.shipping = { fee: Math.max(0, Math.round(input.shippingCents ?? 0)), address };
  if (input.postbackUrl) body.postbackUrl = input.postbackUrl;
  if (input.payerIp) body.ip = input.payerIp;
  return body;
}

/** Corpo de uma cobrança Pix. */
export function buildPixBody(input: Comum & { expiresInSeconds?: number }): Record<string, unknown> {
  return { ...base(input, "pix"), pix: { expiresInSeconds: input.expiresInSeconds ?? 86400 } };
}

/**
 * Corpo de uma cobrança no cartão: `card` é o TOKEN gerado no navegador.
 *
 * O número do cartão nunca passa pelo nosso servidor. Cheguei a trocar isto por
 * campos crus depois de um 422 — engano meu: o 422 vinha de token inválido, e
 * a API então cai na validação do objeto e lista "card.number is required".
 * Token válido é aceito (transação 134581168 criada assim).
 */
export function buildCardBody(input: Comum & { cardToken: string; installments: number }): Record<string, unknown> {
  return {
    ...base(input, "credit_card"),
    card: input.cardToken,
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
  };
}

/**
 * Corpo da TOKENIZAÇÃO — vai do NAVEGADOR direto para
 * `POST /v1/card-token?publicKey=…`, nunca por nós.
 *
 * ⚠️ O formato verificado (resposta 200) NÃO é o da doc:
 *   • os campos vão na RAIZ, não dentro de `card`;
 *   • os nomes são `expirationMonth`/`expirationYear`, não `expMonth`/`expYear`;
 *   • ambos são INTEIROS, e o ano tem 4 dígitos.
 * O exemplo da doc (`BeehivePay.encrypt({ expMonth, expYear })`) descreve a
 * entrada do SDK deles, não o que trafega — mandar assim devolve 422.
 *
 * A resposta é uma string base64 longa (blob AES), e não o `bhp_tok_…` que a
 * doc mostra.
 */
export function buildTokenizeBody(card: {
  number: string;
  holderName: string;
  expirationMonth: number;
  expirationYear: number;
  cvv: string;
}): Record<string, unknown> {
  return {
    number: card.number.replace(/\D/g, ""),
    holderName: card.holderName.trim().slice(0, 100),
    expirationMonth: card.expirationMonth,
    expirationYear: card.expirationYear,
    cvv: card.cvv,
  };
}

/**
 * Confere o corpo contra os obrigatórios da doc. Devolve a lista do que falta —
 * vazia quando está tudo certo.
 */
export function missingFields(body: Record<string, any>): string[] {
  const faltando: string[] = [];
  const precisa = (cond: boolean, campo: string) => {
    if (!cond) faltando.push(campo);
  };

  precisa(Number.isInteger(body.amount) && body.amount > 0, "amount (inteiro em centavos)");
  precisa(body.paymentMethod === "pix" || body.paymentMethod === "credit_card" || body.paymentMethod === "boleto", "paymentMethod");

  const c = body.customer ?? {};
  precisa(typeof c.name === "string" && c.name.trim().length > 0, "customer.name");
  precisa(typeof c.email === "string" && c.email.includes("@"), "customer.email");
  precisa(typeof c.document?.number === "string" && c.document.number.length >= 11, "customer.document.number");

  precisa(Array.isArray(body.items) && body.items.length > 0, "items[]");
  for (const [i, it] of (body.items ?? []).entries()) {
    precisa(typeof it.title === "string" && it.title.length > 0, `items[${i}].title`);
    precisa(Number.isInteger(it.unitPrice), `items[${i}].unitPrice`);
    precisa(Number.isInteger(it.quantity) && it.quantity > 0, `items[${i}].quantity`);
    precisa(typeof it.tangible === "boolean", `items[${i}].tangible`);
  }

  const m = body.metadata ?? {};
  for (const k of ["provider", "user_email", "order_id", "checkout_url", "shop_url"]) {
    precisa(typeof m[k] === "string" && m[k].length > 0, `metadata.${k}`);
  }

  if (body.paymentMethod === "credit_card") {
    // O token pode estar em `card`, `cardToken` ou `cardHash`: `beehive.ts`
    // tenta os formatos porque a API recusa o da doc. Aqui só garantimos que um
    // token EXISTE — nunca dados crus de cartão, que a API responde com a lista
    // "card.* is required" e o cliente vê como "CVV inválido".
    const t = body.card ?? body.cardToken ?? body.cardHash;
    const texto = typeof t === "string" ? t : typeof t?.token === "string" ? t.token : typeof t?.hash === "string" ? t.hash : "";
    precisa(texto.length > 20, "token do cartão");
    precisa(typeof body.card !== "object" || !("number" in (body.card ?? {})), "card não pode levar dados crus");
    precisa(Number.isInteger(body.installments) && body.installments >= 1, "installments");
  }
  return faltando;
}
