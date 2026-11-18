// Montagem PURA do corpo das cobranças MushPag (sem rede, sem banco).
// Conferível por script (scripts/check-mushpag-contract.mjs) antes da primeira
// cobrança real, como em `vext-payload.ts`.
//
// A MushPag é só PIX. `POST /v1/charges` exige:
//   amount (centavos, de 215 a 30000 por padrão), product_name (3 a 255),
//   buyer.name, buyer.document (CPF/CNPJ), buyer.phone (10 ou 11 DÍGITOS,
//   sem máscara: com máscara é recusado) e buyer.email.
// Doc: https://app.mushpag.com/docs/cobrancas/criar-pix

/** Menor cobrança aceita (R$ 2,15). Abaixo disso a API devolve amount_below_minimum. */
export const MUSHPAG_MIN_CENTS = 215;

/**
 * Teto PADRÃO por cobrança (R$ 300,00). A conta pode ter um limite maior,
 * visível em `GET /v1/balance` (`limits.max_charge_amount`), então NÃO barramos
 * localmente por ele: só usamos o número para explicar o erro limit_exceeded.
 */
export const MUSHPAG_MAX_PADRAO_CENTS = 30000;

const UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

export type MushpagBuyerInput = { name: string; email: string; document?: string; phone?: string; uf?: string };

/**
 * Telefone só com dígitos, como a MushPag exige (10 ou 11).
 *
 * O checkout manda o que tiver: com máscara, com +55. O DDI sai quando sobra
 * tamanho de telefone nacional; sem isso "5511987654321" (13 dígitos) seria
 * recusado e a venda perdida.
 */
export function phoneDigits(bruto: string | undefined): string | null {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

/** Comprador da cobrança. `state` só vai quando é uma UF válida (inválida dá 422). */
export function buildBuyer(c: MushpagBuyerInput) {
  const buyer: Record<string, string> = {
    name: (c.name || "").trim().slice(0, 120),
    document: (c.document || "").replace(/\D/g, ""),
    phone: phoneDigits(c.phone) ?? "",
    email: (c.email || "").trim().slice(0, 180),
  };
  const uf = (c.uf || "").trim().toUpperCase();
  if (UFS.has(uf)) buyer.state = uf;
  return buyer;
}

type Entrada = {
  amountCents: number;
  buyer: MushpagBuyerInput;
  /** Obrigatório na MushPag (3 a 255). */
  productName?: string;
  /** Nosso id de pedido. Filtra a listagem deles; NÃO volta no webhook. */
  reference?: string;
  metadata?: Record<string, string>;
};

/** Corpo de uma cobrança Pix. */
export function buildChargeBody(input: Entrada): Record<string, unknown> {
  let produto = (input.productName || "").trim().slice(0, 255);
  // Abaixo de 3 caracteres a API recusa (invalid_product_name).
  if (produto.length < 3) produto = "Pedido";
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    product_name: produto,
    buyer: buildBuyer(input.buyer),
  };
  if (input.reference) body.external_reference = input.reference.slice(0, 64);
  if (input.metadata && Object.keys(input.metadata).length) {
    const meta: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v == null || v === "") continue;
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
  precisa(Number.isInteger(body.amount) && body.amount >= MUSHPAG_MIN_CENTS, `amount (inteiro, mínimo ${MUSHPAG_MIN_CENTS} centavos)`);
  precisa(typeof body.product_name === "string" && body.product_name.length >= 3 && body.product_name.length <= 255, "product_name (3 a 255)");
  const b = body.buyer ?? {};
  precisa(typeof b.name === "string" && b.name.trim().length > 0, "buyer.name");
  precisa(typeof b.document === "string" && /^\d{11}$|^\d{14}$/.test(b.document), "buyer.document (11 ou 14 dígitos)");
  precisa(typeof b.phone === "string" && /^\d{10,11}$/.test(b.phone), "buyer.phone (10 ou 11 dígitos)");
  precisa(typeof b.email === "string" && b.email.includes("@"), "buyer.email");
  if (b.state !== undefined) precisa(UFS.has(b.state), "buyer.state (UF)");
  if (body.external_reference !== undefined) {
    precisa(typeof body.external_reference === "string" && body.external_reference.length <= 64, "external_reference (até 64)");
  }
  return faltando;
}
