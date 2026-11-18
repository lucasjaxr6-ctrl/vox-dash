// Montagem PURA do corpo das cobranças Vext — sem rede, sem banco.
// Conferível por script (scripts/check-vext-contract.mjs) antes da primeira
// cobrança real, como em `beehive-payload.ts` e `pagniv-payload.ts`.
//
// A Vext é só PIX: quatro endpoints, sem cartão e sem tokenização.
// Obrigatórios: `amount` e `customer` — e o `customer` exige nome, e-mail,
// documento e TELEFONE SEPARADO em DDD + número.

export type VextCustomerInput = { name: string; email: string; document?: string; phone?: string };
export type VextItemInput = { name: string; quantity: number; unitPriceCents: number };

/**
 * Quebra o telefone em DDD + número, que é como a Vext pede.
 *
 * Aceita o que o checkout tiver: com máscara, com +55, sem nada. O DDI 55 é
 * removido quando sobra tamanho de telefone nacional — sem isso, "5511987654321"
 * viraria DDD "55" e número "11987654321", e a cobrança nasceria sem QR.
 */
export function splitPhone(bruto: string | undefined): { ddd: string; numero: string } | null {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), numero: d.slice(2) };
}

/**
 * Cliente da cobrança.
 *
 * A doc é explícita sobre o custo de cada campo faltando: "sem e-mail o provedor
 * aceita o pedido e devolve uma cobrança SEM QR CODE". Ou seja, a falha não é um
 * erro — é uma cobrança inútil que o comprador não consegue pagar. Por isso
 * `missingFields` trata os quatro como obrigatórios de verdade.
 */
export function buildCustomer(c: VextCustomerInput) {
  const doc = (c.document || "").replace(/\D/g, "");
  const tel = splitPhone(c.phone);
  return {
    name: (c.name || "").trim().slice(0, 120),
    email: (c.email || "").trim().slice(0, 180),
    document: doc,
    document_type: doc.length > 11 ? "CNPJ" : "CPF",
    phone_ddd: tel?.ddd ?? "",
    phone_number: tel?.numero ?? "",
  };
}

/**
 * Itens — só quando a soma FECHA com o total.
 *
 * A Vext exige que `soma(quantity × amount)` seja exatamente o `amount` da
 * cobrança. No nosso checkout existe frete e cupom, então na maioria das vendas
 * a soma dos produtos NÃO bate com o total cobrado. Mandar assim é 422, ou seja,
 * venda perdida por um campo opcional.
 *
 * A própria doc diz que sem itens eles montam um a partir de `description`.
 * Então: manda quando fecha, omite quando não fecha.
 */
export function buildItems(items: VextItemInput[] | undefined, amountCents: number) {
  if (!items?.length) return null;
  const lista = items.map((it) => ({
    description: (it.name || "Item").slice(0, 180),
    quantity: it.quantity,
    amount: Math.round(it.unitPriceCents),
  }));
  const soma = lista.reduce((s, i) => s + i.quantity * i.amount, 0);
  return soma === Math.round(amountCents) ? lista : null;
}

type Entrada = {
  amountCents: number;
  customer: VextCustomerInput;
  description?: string;
  /** Nosso id de pedido: filtra a listagem deles e volta nos webhooks. */
  reference?: string;
  items?: VextItemInput[];
  payerIp?: string;
  expiresInSeconds?: number;
  metadata?: Record<string, string>;
};

/** Corpo de uma cobrança Pix. */
export function buildPixBody(input: Entrada): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    customer: buildCustomer(input.customer),
  };
  if (input.description) body.description = input.description.slice(0, 255);
  if (input.reference) body.reference = input.reference.slice(0, 120);
  // Piso de 60s e teto de 7 dias no contrato deles.
  if (input.expiresInSeconds) body.expires_in = Math.max(60, Math.min(604800, Math.round(input.expiresInSeconds)));
  // O IP é do COMPRADOR. Sem ele a Vext registra o IP do nosso servidor e o
  // "Local" da venda no painel deles aponta para o datacenter em toda cobrança.
  if (input.payerIp) body.customer_ip = input.payerIp;

  const itens = buildItems(input.items, input.amountCents);
  if (itens) body.items = itens;

  if (input.metadata && Object.keys(input.metadata).length) {
    // Valores PRECISAM ser string: a doc avisa que um número vira 422, porque
    // `{"total": 10.10}` voltaria como `10.1` e a formatação seria perdida.
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v == null) continue;
      meta[k.slice(0, 40)] = String(v).slice(0, 500);
    }
    if (Object.keys(meta).length) body.metadata = meta;
  }
  return body;
}

/** Confere o corpo contra o contrato. Lista vazia = tudo certo. */
export function missingFields(body: Record<string, any>): string[] {
  const faltando: string[] = [];
  const precisa = (cond: boolean, campo: string) => {
    if (!cond) faltando.push(campo);
  };

  precisa(Number.isInteger(body.amount) && body.amount >= 1, "amount (inteiro em centavos)");

  const c = body.customer ?? {};
  precisa(typeof c.name === "string" && c.name.trim().length > 0, "customer.name");
  precisa(typeof c.email === "string" && c.email.includes("@"), "customer.email");
  precisa(typeof c.document === "string" && /^\d{11}$|^\d{14}$/.test(c.document), "customer.document (11 ou 14 dígitos)");
  // Sem telefone a cobrança nasce sem QR — vale como obrigatório.
  precisa(typeof c.phone_ddd === "string" && /^\d{2}$/.test(c.phone_ddd), "customer.phone_ddd");
  precisa(typeof c.phone_number === "string" && /^\d{8,9}$/.test(c.phone_number), "customer.phone_number");

  if (body.items) {
    const soma = body.items.reduce((s: number, i: any) => s + (i.quantity ?? 0) * (i.amount ?? 0), 0);
    precisa(soma === body.amount, `itens somam ${soma}, cobrança é ${body.amount}`);
    for (const [i, it] of body.items.entries()) {
      precisa(typeof it.description === "string" && it.description.length > 0, `items[${i}].description`);
      precisa(Number.isInteger(it.quantity) && it.quantity >= 1, `items[${i}].quantity`);
      precisa(Number.isInteger(it.amount), `items[${i}].amount`);
    }
  }
  if (body.metadata) {
    for (const [k, v] of Object.entries(body.metadata)) {
      precisa(typeof v === "string", `metadata.${k} precisa ser string`);
    }
  }
  if (body.expires_in !== undefined) {
    precisa(Number.isInteger(body.expires_in) && body.expires_in >= 60 && body.expires_in <= 604800, "expires_in (60..604800)");
  }
  return faltando;
}
