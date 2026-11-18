// Montagem PURA do corpo das cobranças PagNiv — sem rede, sem banco.
// Conferível por script antes da primeira cobrança de verdade
// (scripts/check-pagniv-contract.mjs), igual a `beehive-payload.ts`.
//
// A PagNiv usa UM endpoint (POST /v1/charges) para Pix e cartão, distinguidos
// por `paymentMethod`. Obrigatórios em ambos: amount, externalId, payerName,
// payerDocument — os três últimos por PLD-FT e idempotência, segundo a doc.

export type PagnivCustomerInput = { name: string; email?: string; document?: string; phone?: string };

type Comum = {
  amountCents: number;
  /** Nosso id de pedido. Obrigatório: é a chave de idempotência e de conciliação. */
  externalId: string;
  customer: PagnivCustomerInput;
  description?: string;
};

/**
 * Campos que os dois métodos compartilham.
 *
 * `payerDocument` vai só com dígitos: a doc aceita CPF/CNPJ, e pontuação em
 * campo de documento é o tipo de coisa que passa na validação e trava no
 * antifraude depois.
 */
function base(input: Comum): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    externalId: input.externalId,
    payerName: (input.customer.name || "").trim().slice(0, 120),
    payerDocument: (input.customer.document || "").replace(/\D/g, ""),
  };
  if (input.description) body.description = input.description.slice(0, 200);
  if (input.customer.email) body.payerEmail = input.customer.email;
  return body;
}

/** Cobrança Pix. `expiresIn` é em SEGUNDOS (padrão deles: 3600). */
export function buildPixBody(input: Comum & { expiresInSeconds?: number }): Record<string, unknown> {
  const body = base(input);
  // Não mandamos paymentMethod: Pix é o padrão do endpoint.
  body.expiresIn = Math.max(60, Math.round(input.expiresInSeconds ?? 86400));
  return body;
}

/**
 * Cobrança no cartão. Síncrona: a resposta já vem PAID ou recusada com 402.
 *
 * `statementDescriptor` é o que o cliente vê na fatura; a doc limita a 13
 * caracteres, então cortamos aqui — deixar a API recusar por causa do nome da
 * loja seria perder a venda por um detalhe cosmético.
 */
export function buildCardBody(
  input: Comum & {
    cardToken: string;
    installments: number;
    maxInstallments?: number;
    statementDescriptor?: string;
  },
): Record<string, unknown> {
  const body = base(input);
  const teto = Math.max(1, Math.min(18, Math.round(input.maxInstallments ?? 12)));
  body.paymentMethod = "CARD";
  body.cardToken = input.cardToken;
  body.installments = Math.max(1, Math.min(teto, Math.round(input.installments) || 1));
  if (input.customer.phone) body.payerPhone = input.customer.phone.replace(/\D/g, "");
  // Corta em 13 e SÓ ENTÃO apara: cortar antes deixaria espaço sobrando no fim
  // ("Della Decor & Cia" -> "Della Decor  "), que é o que o cliente veria na
  // fatura. O `replace` também colapsa espaços duplos deixados pela limpeza.
  const descritor = (input.statementDescriptor || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 13)
    .trim();
  if (descritor) body.statementDescriptor = descritor;
  return body;
}

/** Corpo da tokenização (vai do NAVEGADOR direto para a PagNiv, não por nós). */
export function buildTokenizeBody(card: {
  number: string;
  holderName: string;
  expMonth: number;
  expYear: number;
  cvv: string;
}): Record<string, unknown> {
  return {
    type: "card",
    card: {
      number: card.number.replace(/\D/g, ""),
      holder_name: card.holderName,
      exp_month: card.expMonth,
      // A doc exemplifica com 2 dígitos ("exp_year": 30).
      exp_year: card.expYear > 2000 ? card.expYear - 2000 : card.expYear,
      cvv: card.cvv,
    },
  };
}

/** Confere o corpo contra os obrigatórios da doc. Lista vazia = tudo certo. */
export function missingFields(body: Record<string, any>): string[] {
  const faltando: string[] = [];
  const precisa = (cond: boolean, campo: string) => {
    if (!cond) faltando.push(campo);
  };

  // Mínimo de R$ 1,00 segundo a doc ("mín. 100").
  precisa(Number.isInteger(body.amount) && body.amount >= 100, "amount (inteiro em centavos, mín. 100)");
  precisa(typeof body.externalId === "string" && body.externalId.length > 0, "externalId");
  precisa(typeof body.payerName === "string" && body.payerName.trim().length > 0, "payerName");
  precisa(typeof body.payerDocument === "string" && /^\d{11}$|^\d{14}$/.test(body.payerDocument), "payerDocument (11 ou 14 dígitos)");

  if (body.paymentMethod === "CARD") {
    precisa(typeof body.cardToken === "string" && body.cardToken.length > 0, "cardToken");
    precisa(Number.isInteger(body.installments) && body.installments >= 1, "installments");
    precisa(
      body.statementDescriptor === undefined || String(body.statementDescriptor).length <= 13,
      "statementDescriptor (máx. 13)",
    );
  }
  return faltando;
}
