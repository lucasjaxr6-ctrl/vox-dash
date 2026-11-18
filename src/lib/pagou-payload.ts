import type { PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Montagem do corpo de `POST /v2/transactions` da Pagou.ai.
//
// Separado de `pagou.ts` (que fala com a rede e é server-only) porque aqui é
// tudo função PURA: entra pedido, sai JSON. Isso deixa o corpo ser conferido
// contra o contrato oficial sem precisar de banco, credencial ou chamada real
// — e o corpo do cartão é exatamente o que decide se o 3DS tem o que precisa.
//
// Referência: shared/contracts/openapi-v2.json do repositório oficial
// github.com/PagouAi/examples. As restrições citadas nos comentários saem de lá,
// não de memória.
//
// Campos do contrato, com os obrigatórios em MAIÚSCULA:
//   AMOUNT (centavos) · METHOD · BUYER · PRODUCTS (1..100)
//   external_ref · currency · installments (1..12) · interest_rate (0..100)
//   token (^(pgct_|pgpm_)) · notify_url · metadata (STRING) · traceable
//   ip_address (IPv4/IPv6 puro)
//
// `informations` NÃO existe no contrato: já mandamos e era descartado em
// silêncio. A origem da venda viaja em `metadata`.
// ─────────────────────────────────────────────────────────────────────────────

export type Address = {
  cep?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  city?: string;
  uf?: string;
};

export type PagouItem = { name: string; quantity: number; unitPriceCents: number; sku?: string };

export type PagouCreateInput = {
  amountCents: number;
  customer: PixCustomer;
  description?: string;
  payerIp?: string;
  address?: Address;
  /** Id do nosso pedido — vira `external_ref` (idempotência da Pagou). */
  externalReference?: string;
  /** Webhook desta loja. */
  postbackUrl?: string;
  checkoutUrl?: string;
  storeName?: string;
  /** Frete cobrado, para separá-lo dos juros na composição dos itens. */
  shippingCents?: number;
  items?: PagouItem[];
  /**
   * Valor ANTES do acréscimo de parcelamento (produto + frete - cupom). Serve
   * para declarar `interest_rate`; sem ele os juros ficam escondidos dentro do
   * `amount`.
   */
  baseAmountCents?: number;
};

// Regex do próprio contrato para `ip_address`.
const IPV4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const IPV6 =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;

/**
 * `ip_address` só é aceito como IPv4 ou IPv6 PURO. O que chega do proxy pode vir
 * como IPv4 mapeado em IPv6 (`::ffff:1.2.3.4`), entre colchetes ou com porta —
 * formas que o contrato rejeita com 422. Normaliza o que dá e DESCARTA o resto:
 * o campo é opcional, e um IP malformado derrubaria a cobrança inteira.
 */
export function sanitizeIp(ip: string | undefined): string | null {
  let v = (ip || "").trim().replace(/^\[|\]$/g, "");
  if (!v) return null;
  const mapeado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v);
  if (mapeado) v = mapeado[1];
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.indexOf(":"));
  if (IPV4.test(v) || IPV6.test(v)) return v;
  return null;
}

/**
 * Endereço no formato da Pagou (zipCode camelCase, state com 2 letras).
 *
 * Campo vazio é OMITIDO, nunca mandado como "": o contrato impõe minLength 1 em
 * `street`/`city` e o padrão `^[\p{L}\p{N}]{2,3}$` em `state`, então uma string
 * vazia não passa vaga — reprova a requisição inteira com 422.
 *
 * Quem exige o endereço COMPLETO é o 3DS, e essa checagem vive em
 * `missingFor3ds`: o Pix não autentica nada e cobra normalmente com o que o
 * cliente tiver preenchido.
 */
export function mapAddress(a: Address | undefined) {
  if (!a) return null;
  const zip = (a.cep || "").replace(/\D/g, "");
  const street = (a.street || "").trim().slice(0, 120);
  const city = (a.city || "").trim().slice(0, 120);
  const state = (a.uf || "").trim().toUpperCase().slice(0, 2);
  const number = (a.number || "").trim().slice(0, 20);
  const neighborhood = (a.neighborhood || "").trim().slice(0, 120);
  const complement = (a.complement || "").trim().slice(0, 120);
  // `street` e `city` são os dois obrigatórios do contrato. Sem eles não há
  // endereço que a API aceite.
  if (!street || !city) return null;
  return {
    street,
    city,
    country: "BR",
    // "S/N" é a forma real de um endereço sem número no Brasil, não um
    // preenchimento inventado. Bairro/CEP/estado ausentes ficam DE FORA — chutar
    // um valor aqui passa na validação e volta como recusa do emissor no 3DS,
    // que é muito mais difícil de diagnosticar do que o campo faltando.
    number: number || "S/N",
    ...(neighborhood ? { neighborhood } : {}),
    ...(state.length >= 2 ? { state } : {}),
    ...(zip ? { zipCode: zip } : {}),
    ...(complement ? { complement } : {}),
  };
}

/** Comprador completo. Documento é obrigatório e vai só com dígitos. */
export function buildBuyer(customer: PixCustomer, address?: Address) {
  const doc = (customer.document || "").replace(/\D/g, "");
  const buyer: Record<string, unknown> = {
    name: customer.name,
    email: customer.email,
    document: { type: doc.length > 11 ? "CNPJ" : "CPF", number: doc },
  };
  // Telefone em E.164, COM o "+".
  //
  // A doc do 3DS só diz "a buyer.phone that includes its country code", mas o
  // único exemplo de telefone que a Pagou publica (shared/fixtures/customer.json)
  // é "+5511999990000". O "+" não é enfeite: o 3DS monta `mobilePhone` com `cc`
  // e `subscriber` SEPARADOS, e sem ele "5535983872810" é ambíguo — o código do
  // país pode ser lido como 5, 55 ou 553. Mandávamos sem o "+".
  //
  // Só sai se o número fizer sentido: com o 55 na frente, telefone brasileiro
  // tem 12 dígitos (fixo) ou 13 (celular). Fora disso preferimos OMITIR e deixar
  // o `missingFor3ds` acusar "falta: telefone" — mandar lixo para a
  // autenticação é pior do que não mandar, porque o erro volta ilegível.
  let phone = (customer.phone || "").replace(/\D/g, "");
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length === 12 || phone.length === 13) buyer.phone = `+${phone}`;

  const addr = mapAddress(address);
  if (addr) buyer.address = addr;
  return buyer;
}

/**
 * Campos que a autenticação do cartão exige do comprador.
 *
 * A doc do 3DS é explícita: "Send a complete buyer record: buyer.email,
 * buyer.name, a buyer.phone that includes its country code, and EVERY field of
 * buyer.address: country, state, city, zipCode, street, number and
 * neighborhood. Only complement is optional."
 *
 * Sem isso o 3DS não tem o que mandar ao emissor. Conferimos ANTES de chamar a
 * API para o lojista receber "falta o bairro" em vez de um erro opaco de
 * adquirente — e para não queimar uma cobrança que já nasce condenada.
 */
export function missingFor3ds(buyer: Record<string, unknown>): string[] {
  const falta: string[] = [];
  if (!buyer.name) falta.push("nome");
  if (!buyer.email) falta.push("e-mail");
  if (!buyer.phone) falta.push("telefone");
  const a = buyer.address as Record<string, string> | undefined;
  if (!a) {
    falta.push("endereço");
    return falta;
  }
  const rotulos: [string, string][] = [
    ["street", "rua"], ["number", "número"], ["neighborhood", "bairro"],
    ["city", "cidade"], ["state", "estado"], ["zipCode", "CEP"], ["country", "país"],
  ];
  for (const [campo, rotulo] of rotulos) if (!String(a[campo] ?? "").trim()) falta.push(rotulo);
  return falta;
}

/**
 * Itens da venda. `price` é o UNITÁRIO em centavos.
 *
 * A soma dos itens SEMPRE fecha com o `amount` cobrado — os dois exemplos da doc
 * fecham, e se a Pagou validar isso uma divergência viraria 422 e Pix não
 * gerado. E fecha SEM preço negativo: a doc não diz que aceita negativo, então
 * o desconto é aplicado reduzindo o preço unitário (vira o preço efetivo pago),
 * e a sobra de arredondamento entra como uma linha positiva.
 */
export function buildProducts(
  items: PagouItem[] | undefined,
  description: string | undefined,
  amountCents: number,
  shippingCents?: number,
) {
  const target = Math.max(0, Math.round(amountCents));
  const base: PagouItem[] = items?.length ? items : [{ name: description || "Pedido", quantity: 1, unitPriceCents: target }];
  const list = base.map((it) => ({
    name: (it.name || "Item").slice(0, 120),
    price: Math.max(0, Math.round(it.unitPriceCents)),
    quantity: Math.max(1, Math.round(it.quantity)),
    tangible: true,
    // sku = id do produto na nossa base. Ajuda a Pagou (e nós) a casar a linha
    // com o catálogo numa conferência ou disputa.
    ...(it.sku ? { sku: String(it.sku).slice(0, 120) } : {}),
  }));

  const sum = list.reduce((s, p) => s + p.price * p.quantity, 0);
  if (sum === target) return list;

  // Cobrando MAIS que os itens: a diferença é frete e/ou juros do parcelamento.
  // Separamos as duas coisas em vez de jogar tudo numa linha "Frete" — a
  // composição é o que a adquirente audita, e chamar juros de frete é errado.
  if (sum < target) {
    let diff = target - sum;
    const frete = Math.max(0, Math.min(Math.round(shippingCents ?? 0), diff));
    if (frete > 0) {
      list.push({ name: "Frete", price: frete, quantity: 1, tangible: false });
      diff -= frete;
    }
    if (diff > 0) list.push({ name: "Juros do parcelamento", price: diff, quantity: 1, tangible: false });
    return list;
  }

  // Cobrando MENOS (desconto do Pix/cupom): reduz proporcionalmente o unitário.
  // O floor deixa a soma <= alvo, então a diferença que sobra é sempre POSITIVA
  // e cabe numa linha de acerto.
  if (sum > 0) {
    for (const p of list) p.price = Math.floor((p.price * target) / sum);
  }
  const scaled = list.reduce((s, p) => s + p.price * p.quantity, 0);
  const rest = target - scaled;
  if (rest > 0) list.push({ name: "Ajuste", price: rest, quantity: 1, tangible: false });
  return list;
}

/** `metadata` é texto livre: mandamos a origem em uma linha legível. */
export function buildMetadata(input: { storeName?: string; externalReference?: string; checkoutUrl?: string }): string {
  const parts = ["VoxCheckout"];
  if (input.storeName) parts.push(input.storeName);
  if (input.checkoutUrl) {
    try {
      parts.push(new URL(input.checkoutUrl).host);
    } catch {
      /* ignora URL malformada */
    }
  }
  if (input.externalReference) parts.push(`pedido ${input.externalReference}`);
  return parts.join(" | ").slice(0, 500);
}

/** Campos comuns a Pix e cartão. */
function buildCommon(input: PagouCreateInput, method: "pix" | "credit_card"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    amount: Math.round(input.amountCents),
    currency: "BRL",
    method,
    buyer: buildBuyer(input.customer, input.address),
    products: buildProducts(input.items, input.description, input.amountCents, input.shippingCents),
    // STRING, nunca objeto — a API rejeita objeto neste campo. Vai legível, com
    // plataforma, loja e pedido, para quem abrir a transação no painel da Pagou
    // saber de onde ela veio sem precisar cruzar nada.
    metadata: buildMetadata(input),
    // `traceable` fica de FORA de propósito: a doc lista o campo mas não explica
    // o que ele afirma, e não temos endpoint de rastreio na Pagou para sustentar
    // um `true`. Melhor herdar o padrão deles do que declarar algo que não
    // cumprimos — é esse tipo de divergência que gera dor de cabeça com risco.
  };
  if (input.externalReference) body.external_ref = input.externalReference;
  if (input.postbackUrl) body.notify_url = input.postbackUrl;
  const ip = sanitizeIp(input.payerIp);
  if (ip) body.ip_address = ip;
  return body;
}

/** Corpo de uma cobrança Pix. */
export function buildPixBody(input: PagouCreateInput): Record<string, unknown> {
  return buildCommon(input, "pix");
}

/**
 * Corpo de uma cobrança no cartão. Lança quando falta ao comprador algo que a
 * autenticação (3DS) exige — melhor um erro nosso, nomeando o campo, do que uma
 * recusa opaca da adquirente depois da cobrança criada.
 */
export function buildCardBody(input: PagouCreateInput & { token: string; installments: number }): Record<string, unknown> {
  const token = (input.token || "").trim();
  if (!token) throw new Error("Token do cartão ausente.");
  // O token do Payment Element tem prefixo fixo no contrato. Conferir aqui evita
  // gastar uma criação para receber um 422 de volta.
  if (!/^(pgct_|pgpm_)/.test(token)) throw new Error("Token de cartão inválido (esperado pgct_/pgpm_).");

  const body = buildCommon(input, "credit_card");
  const buyer = body.buyer as Record<string, unknown>;
  const falta = missingFor3ds(buyer);
  if (falta.length) throw new Error(`Endereço incompleto para a autenticação do cartão (falta: ${falta.join(", ")}).`);

  const installments = Math.max(1, Math.min(12, Math.round(input.installments) || 1));
  body.token = token;
  body.installments = installments;

  // Os juros do parcelamento estão EMBUTIDOS no `amount` (repassados ao
  // cliente). O contrato tem campo próprio para declarar a taxa, e declarar é o
  // que deixa a análise de risco separar preço de juros em vez de ver uma venda
  // acima do valor dos itens.
  const base = input.baseAmountCents ?? 0;
  if (installments > 1 && base > 0 && input.amountCents > base) {
    const taxa = (input.amountCents / base - 1) * 100;
    if (taxa > 0 && taxa <= 100) body.interest_rate = Number(taxa.toFixed(4));
  }
  return body;
}
