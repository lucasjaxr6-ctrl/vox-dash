import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { query, execute } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { urlWebhook } from "./plataforma";

// ─────────────────────────────────────────────────────────────────────────────
// Pix DA PLATAFORMA (taxas e planos) pela Cakto, na conta da VOX.
//
// Credenciais SOMENTE pelo ambiente (Vercel): elas apontam para onde o dinheiro
// da plataforma cai, e um caminho de escrita no painel deixaria quem invadisse
// uma conta de admin trocar pela dele.
//
//   CAKTO_PLATFORM_CLIENT_ID       client_id da chave de API (Painel Cakto)
//   CAKTO_PLATFORM_CLIENT_SECRET   client_secret da mesma chave
//
// Só isso. O resto o sistema resolve sozinho, pela API, na primeira cobrança:
//  • o produto "Taxas VOX", onde ficam as ofertas (procura; cria se faltar);
//  • o webhook de pagamento aprovado desse produto (procura; cadastra se
//    faltar). O secret de assinatura volta na própria API (`fields.secret`).
//
// A chave precisa de leitura e escrita em: payments, orders, offers, products
// e webhooks. Os escopos de saque NÃO são necessários (e não devem ser dados).
//
// ⚠️ O que molda este arquivo:
//  • A cobrança Pix NÃO tem campo de valor: cobra o preço de uma OFERTA. Como a
//    taxa muda a cada cobrança, criamos (ou reaproveitamos) uma oferta com o
//    valor exato no produto da plataforma, e cobramos por ela.
//  • Oferta tem preço mínimo de R$ 5,00. Abaixo disso não há como cobrar: o
//    saldo acumula (ver minimoPixPlataforma em lib/platform-pix.ts).
//  • O token vale 10 h e o endpoint de emissão tem limite: fica em memória E no
//    banco (gateway_tokens, criptografado), compartilhado entre instâncias.
//  • O webhook NÃO reenvia quando respondemos erro: a palavra final é sempre o
//    GET do pedido, e as telas conferem sozinhas (conferirCobrancasDaLoja).
//
// Doc: https://docs.cakto.com.br/llms.txt
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.cakto.com.br";

/** Preço mínimo de uma oferta na Cakto (R$ 5,00). */
export const CAKTO_MINIMO_CENTS = 500;

/**
 * "Taxa de serviço" que a Cakto soma ao que o PAGADOR paga, por pedido
 * (`customerFees` em GET /public_api/fees/). Medida na primeira cobrança real,
 * em 23/10/2026: R$ 0,99 fixo. Decisão do dono: a VOX ABSORVE, ou seja, a
 * oferta sai com esse valor a menos e o lojista paga exatamente a dívida.
 *
 * Lida da API (cache de 1 h por instância), não fixada aqui: se a Cakto mudar
 * ou tirar a taxa, o preço da oferta acompanha. O valor abaixo só vale até a
 * primeira leitura, ou se a leitura falhar; e mesmo errado não causa cobrança
 * errada, porque o valor final é conferido antes de o Pix ir para a tela.
 */
const TAXA_COMPRADOR_PADRAO_CENTS = 99;
let taxaComprador: { fixoCents: number; pct: number; lidaEm: number } | null = null;

/** Menor COBRANÇA possível: a oferta mínima mais a taxa que a Cakto soma ao pagador. */
export function minimoCobrancaCakto(): number {
  return CAKTO_MINIMO_CENTS + (taxaComprador?.fixoCents ?? TAXA_COMPRADOR_PADRAO_CENTS);
}

/** Prefixo dos nossos txnId da Cakto: o id deles é UUID, como o da PushinPay antiga. */
export const PREFIXO_TXN_CAKTO = "ck_";

/** Nome do produto da plataforma na conta Cakto (é por ele que o achamos). */
const NOME_PRODUTO = "Taxas VOX";

function env() {
  const clientId = process.env.CAKTO_PLATFORM_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.CAKTO_PLATFORM_CLIENT_SECRET?.trim() || "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** A Cakto está configurada na Vercel? Sem ela não há como gerar Pix de taxa nem de plano. */
export const caktoConfigurada = () => env() !== null;

// ── Token ────────────────────────────────────────────────────────────────────

const memoria = new Map<string, { token: string; ate: number }>();

/** Muda quando o client_id muda, e o token antigo morre junto. */
const chaveCache = (clientId: string) =>
  `plataforma:cakto:${createHash("sha256").update(clientId).digest("hex").slice(0, 16)}`;

async function token(forcarNovo = false): Promise<string> {
  const e = env();
  if (!e) throw new Error("Cakto não configurada.");
  const chave = chaveCache(e.clientId);

  if (!forcarNovo) {
    const mem = memoria.get(chave);
    if (mem && mem.ate > Date.now()) return mem.token;
    try {
      const [r] = await query<{ tokenEnc: string; expiresAt: Date }>(
        `SELECT tokenEnc, expiresAt FROM gateway_tokens WHERE cacheKey = ? AND expiresAt > NOW(3) LIMIT 1`,
        [chave],
      );
      if (r) {
        const salvo = { token: decryptSecret(r.tokenEnc), ate: new Date(r.expiresAt).getTime() };
        memoria.set(chave, salvo);
        return salvo.token;
      }
    } catch {
      /* cache ilegível: segue para emitir um novo */
    }
  }

  const res = await fetch(`${API_BASE}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: e.clientId, client_secret: e.clientSecret }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.access_token) {
    console.error("[cakto plataforma] token:", res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Falha na autenticação da Cakto (HTTP ${res.status}).`);
  }
  // Renova 10 min antes do fim, para nenhuma chamada sair com token vencendo.
  const validade = Math.max(60, Number(data.expires_in) || 36000) * 1000;
  const novo = { token: String(data.access_token), ate: Date.now() + validade - 10 * 60_000 };
  memoria.set(chave, novo);
  await execute(
    `INSERT INTO gateway_tokens (cacheKey, tokenEnc, expiresAt) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE tokenEnc = VALUES(tokenEnc), expiresAt = VALUES(expiresAt)`,
    [chave, encryptSecret(novo.token), new Date(novo.ate)],
  ).catch((err) => console.error("[cakto plataforma] cache de token:", err instanceof Error ? err.message : err));
  return novo.token;
}

type Chamada = { method?: string; body?: unknown; idempotencyKey?: string };

/** Chamada autenticada. Um 401 (token revogado antes da hora) renova uma vez. */
async function chamar(caminho: string, opts: Chamada = {}, tentativa = 1): Promise<{ res: Response; data: any }> {
  const t = await token(tentativa > 1);
  const res = await fetch(`${API_BASE}${caminho}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: `Bearer ${t}`,
      accept: "application/json",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.idempotencyKey ? { "X-Idempotency-Key": opts.idempotencyKey } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 && tentativa === 1) return chamar(caminho, opts, 2);
  const data = await res.json().catch(() => ({}) as any);
  return { res, data };
}

// ── Produto e webhook da plataforma (resolvidos sozinhos) ────────────────────

let produtoEmMemoria: string | null = null;

/**
 * Id do produto "Taxas VOX" na conta Cakto, criando se não existir.
 *
 * Pega o MAIS ANTIGO com esse nome: se duas instâncias criassem ao mesmo tempo
 * (corrida rara, só na primeira cobrança da vida), todas passam a usar o mesmo
 * dali em diante, e é nele que o webhook fica cadastrado.
 */
async function produtoDaPlataforma(): Promise<string> {
  if (produtoEmMemoria) return produtoEmMemoria;
  const filtro = new URLSearchParams({ name: NOME_PRODUTO, ordering: "createdAt", limit: "20" });
  const lista = await chamar(`/public_api/products/?${filtro.toString()}`);
  if (!lista.res.ok) throw new Error(`Não consegui listar os produtos da Cakto (HTTP ${lista.res.status}).`);
  const existente = (lista.data?.results ?? []).find(
    (p: any) => p?.name === NOME_PRODUTO && p?.status !== "deleted" && p?.status !== "blocked",
  );
  if (existente?.id) return (produtoEmMemoria = String(existente.id));

  const novo = await chamar("/public_api/products/", {
    method: "POST",
    body: {
      name: NOME_PRODUTO,
      description: "Taxas e planos da plataforma VOX, pagos pelo lojista via Pix.",
      price: "5.00",
      type: "unique",
      paymentMethods: ["pix"],
      // Não há conteúdo a entregar: é o pagamento de uma conta.
      contentDeliveries: ["disabled"],
    },
  });
  const id = novo.data?.id;
  if (!novo.res.ok || !id) {
    console.error("[cakto plataforma] criar produto:", novo.res.status, JSON.stringify(novo.data).slice(0, 300));
    throw new Error(`Não consegui criar o produto "${NOME_PRODUTO}" na Cakto (HTTP ${novo.res.status}).`);
  }
  console.log(`[cakto plataforma] produto "${NOME_PRODUTO}" criado: ${id}`);
  return (produtoEmMemoria = String(id));
}

let webhookOk = false;
let segredoWebhook: string | null = null;

/** O webhook nosso, se já existir na conta: o da nossa URL, deste produto, com pagamento aprovado. */
async function nossoWebhook(productId: string): Promise<any | null> {
  const url = urlWebhook("cakto-plataforma");
  const lista = await chamar(`/public_api/webhook/?${new URLSearchParams({ search: url, limit: "50" }).toString()}`);
  if (!lista.res.ok) return null;
  return (
    (lista.data?.results ?? []).find(
      (w: any) =>
        String(w?.url ?? "").replace(/\/+$/, "") === url &&
        (w?.products ?? []).some((p: any) => String(p?.id ?? p) === productId) &&
        (w?.events ?? []).some((e: any) => (e?.custom_id ?? e) === "purchase_approved"),
    ) ?? null
  );
}

/**
 * Garante o webhook de pagamento aprovado no produto da plataforma.
 *
 * Roda uma vez por instância, antes da primeira cobrança. Falhar aqui NÃO
 * impede o Pix: sem webhook a baixa ainda acontece, pela conferência que as
 * telas de cobrança fazem sozinhas (só que com atraso).
 */
async function garantirWebhook(productId: string): Promise<void> {
  if (webhookOk) return;
  try {
    const atual = await nossoWebhook(productId);
    if (atual) {
      segredoWebhook = atual?.fields?.secret ? String(atual.fields.secret) : segredoWebhook;
      if (atual.status !== "active") {
        console.error(`[cakto plataforma] o webhook ${atual.id} existe mas está "${atual.status}" no painel da Cakto`);
      }
      webhookOk = true;
      return;
    }
    const novo = await chamar("/public_api/webhook/", {
      method: "POST",
      body: {
        name: "VOX: taxas e planos pagos",
        url: urlWebhook("cakto-plataforma"),
        products: [productId],
        events: ["purchase_approved"],
        status: "active",
      },
    });
    if (!novo.res.ok) {
      console.error("[cakto plataforma] cadastrar webhook:", novo.res.status, JSON.stringify(novo.data).slice(0, 300));
      return;
    }
    segredoWebhook = novo.data?.fields?.secret ? String(novo.data.fields.secret) : null;
    webhookOk = true;
    console.log(`[cakto plataforma] webhook cadastrado no produto ${productId}`);
  } catch (e) {
    console.error("[cakto plataforma] webhook:", e instanceof Error ? e.message : e);
  }
}

/**
 * Secret de assinatura do nosso webhook, lido da API (a Cakto devolve em
 * `fields.secret`). Null quando não deu para descobrir: aí o webhook segue
 * só pela re-consulta do pedido, que é o que decide de qualquer forma.
 */
async function segredoDoWebhook(): Promise<string | null> {
  if (segredoWebhook) return segredoWebhook;
  try {
    const atual = await nossoWebhook(await produtoDaPlataforma());
    segredoWebhook = atual?.fields?.secret ? String(atual.fields.secret) : null;
  } catch {
    /* sem segredo: quem chama segue pela re-consulta */
  }
  return segredoWebhook;
}

// ── Taxa do comprador ────────────────────────────────────────────────────────

/** Taxa que a Cakto soma ao pagador no Pix (fixa + percentual), da API. */
async function taxaDoComprador(): Promise<{ fixoCents: number; pct: number }> {
  if (taxaComprador && Date.now() - taxaComprador.lidaEm < 60 * 60_000) return taxaComprador;
  try {
    const { res, data } = await chamar("/public_api/fees/");
    if (res.ok && Array.isArray(data?.customerFees)) {
      // `paymentMethod` null = vale para todos os métodos.
      const doPix = data.customerFees.filter((f: any) => f?.paymentMethod == null || f?.paymentMethod === "pix");
      const fixoCents = doPix.reduce((s: number, f: any) => s + Math.round((Number(f?.amount) || 0) * 100), 0);
      const pct = doPix.reduce((s: number, f: any) => s + (Number(f?.percentage) || 0), 0);
      taxaComprador = { fixoCents, pct, lidaEm: Date.now() };
      return taxaComprador;
    }
    console.error("[cakto plataforma] taxas:", res.status, JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.error("[cakto plataforma] taxas:", e instanceof Error ? e.message : e);
  }
  return { fixoCents: taxaComprador?.fixoCents ?? TAXA_COMPRADOR_PADRAO_CENTS, pct: taxaComprador?.pct ?? 0 };
}

/** Preço da oferta para que oferta + taxa do comprador dê exatamente `totalCents`. */
function precoDaOferta(totalCents: number, taxa: { fixoCents: number; pct: number }): number {
  const semFixo = totalCents - taxa.fixoCents;
  return taxa.pct > 0 ? Math.round(semFixo / (1 + taxa.pct / 100)) : semFixo;
}

// ── Oferta com o valor exato ─────────────────────────────────────────────────

const precoEmReais = (cents: number) => Number((Math.round(cents) / 100).toFixed(2));
const mesmoPreco = (preco: unknown, cents: number) => Math.round(Number(preco) * 100) === Math.round(cents);

/**
 * Oferta ATIVA do produto da plataforma com este nome e este preço; cria se
 * não existir.
 *
 * Reaproveitar evita criar uma oferta por cobrança: o plano tem sempre o mesmo
 * preço, e uma taxa que se repete (ou o Pix gerado de novo após vencer) cai na
 * mesma. O nome entra na busca porque é o que o lojista vê no recibo: um plano
 * de R$ 127 não pode sair com o nome de uma taxa que por acaso custou R$ 127.
 */
async function ofertaDoValor(productId: string, nome: string, valorCents: number): Promise<string> {
  const preco = precoEmReais(valorCents);
  const filtro = new URLSearchParams({ product: productId, status: "active", price: String(preco), limit: "50" });
  const lista = await chamar(`/public_api/offers/?${filtro.toString()}`);
  if (lista.res.ok) {
    const itens: any[] = lista.data?.results ?? [];
    // Confere aqui também: se a API ignorar algum filtro, nada de usar oferta
    // com preço ou nome diferente.
    const achada = itens.find((o) => o?.status !== "deleted" && o?.name === nome && mesmoPreco(o?.price, valorCents));
    if (achada?.id) return String(achada.id);
  } else {
    console.error("[cakto plataforma] listar ofertas:", lista.res.status, JSON.stringify(lista.data).slice(0, 300));
  }

  const nova = await chamar("/public_api/offers/", {
    method: "POST",
    body: { product: productId, name: nome, price: preco, status: "active", type: "unique" },
  });
  const id = nova.data?.id;
  if (!nova.res.ok || !id) {
    console.error("[cakto plataforma] criar oferta:", nova.res.status, JSON.stringify(nova.data).slice(0, 300));
    throw new Error(`Não consegui criar a oferta de ${preco} na Cakto (HTTP ${nova.res.status}).`);
  }
  if (!mesmoPreco(nova.data?.price ?? preco, valorCents)) {
    throw new Error(`A Cakto criou a oferta com preço ${nova.data?.price}, esperado ${preco}.`);
  }
  return String(id);
}

// ── Cobrança Pix ─────────────────────────────────────────────────────────────

export type PagadorCakto = { nome: string; email: string; documento: string; telefone?: string | null };

/** Celular no formato E.164 sem "+", como a Cakto pede (5511999999999). */
function telefoneE164(bruto: string | null | undefined): string | null {
  let d = (bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? `55${d}` : null;
}

/**
 * Cria o Pix na conta Cakto da VOX.
 *
 * `chaveIdempotencia` é o id da NOSSA cobrança: se a chamada cair no meio e
 * for repetida, a Cakto devolve o mesmo Pix em vez de criar outro.
 */
export async function criarPixCakto(input: {
  valorCents: number;
  titulo: string;
  chaveIdempotencia: string;
  validadeMinutos: number;
  pagador: PagadorCakto;
}): Promise<{ ok: true; txnId: string; qrCode: string } | { ok: false; erro: string }> {
  const e = env();
  if (!e) return { ok: false, erro: "Pagamento indisponível no momento. Fale com o suporte." };
  const telefone = telefoneE164(input.pagador.telefone);
  if (!telefone) return { ok: false, erro: "Complete seu cadastro (celular com DDD) para gerar o Pix." };

  try {
    // O lojista paga EXATAMENTE `valorCents`: a taxa que a Cakto soma ao
    // pagador sai do preço da oferta (a VOX absorve).
    const precoOferta = precoDaOferta(input.valorCents, await taxaDoComprador());
    if (precoOferta < CAKTO_MINIMO_CENTS) {
      const min = (minimoCobrancaCakto() / 100).toFixed(2).replace(".", ",");
      return { ok: false, erro: `O Pix precisa ser de pelo menos R$ ${min}.` };
    }
    const productId = await produtoDaPlataforma();
    await garantirWebhook(productId);
    const offerId = await ofertaDoValor(productId, input.titulo.slice(0, 255), precoOferta);
    const doc = input.pagador.documento;
    const { res, data } = await chamar("/public_api/payments/", {
      method: "POST",
      idempotencyKey: input.chaveIdempotencia,
      body: {
        paymentMethod: "pix",
        customer: {
          name: (input.pagador.nome || "Lojista").trim().slice(0, 120),
          email: input.pagador.email.trim(),
          phone: telefone,
          docType: doc.length === 14 ? "cnpj" : "cpf",
          docNumber: doc,
          // Obrigatório e "estável por dispositivo/sessão". Quem paga é sempre o
          // mesmo lojista, então o documento (em hash) identifica bem e não vaza.
          fingerprint: createHash("sha256").update(`vox:${doc}`).digest("hex").slice(0, 32),
        },
        items: [{ offerId, quantity: 1 }],
        pixExpiresIn: Math.max(60, Math.round(input.validadeMinutos * 60)),
      },
    });
    if (!res.ok) {
      console.error("[cakto plataforma] criar pix:", res.status, JSON.stringify(data).slice(0, 400));
      return { ok: false, erro: "Não foi possível gerar o Pix agora. Tente de novo em instantes." };
    }
    const id = data?.id != null ? String(data.id) : "";
    const qrCode = String(data?.pix?.qrCode ?? "");
    if (!id || !qrCode) {
      console.error("[cakto plataforma] resposta sem id/qrCode:", JSON.stringify(data).slice(0, 400));
      return { ok: false, erro: "Não foi possível gerar o Pix agora." };
    }
    // O valor cobrado vem da oferta, não de nós. Se divergir, a cobrança não
    // pode ir para a tela: o lojista pagaria um valor que não é o da dívida.
    if (data?.amount != null && !mesmoPreco(data.amount, input.valorCents)) {
      console.error(`[cakto plataforma] valor divergente: pedido ${id} cobrou ${data.amount}, esperado ${input.valorCents} centavos`);
      return { ok: false, erro: "Não foi possível gerar o Pix agora. Fale com o suporte." };
    }
    return { ok: true, txnId: `${PREFIXO_TXN_CAKTO}${id}`, qrCode };
  } catch (err) {
    console.error("[cakto plataforma] criar pix:", err instanceof Error ? err.message : err);
    return { ok: false, erro: "Falha ao falar com o banco. Tente de novo." };
  }
}

/**
 * Status do pedido na Cakto ("paid" quando pago), com a nossa credencial. É o
 * que dá confiança ao webhook: um POST forjado não quita nada.
 */
export async function consultarPixCakto(txnId: string): Promise<string | null> {
  if (!caktoConfigurada() || !txnId.startsWith(PREFIXO_TXN_CAKTO)) return null;
  const id = txnId.slice(PREFIXO_TXN_CAKTO.length);
  try {
    const { res, data } = await chamar(`/public_api/orders/${encodeURIComponent(id)}/`);
    if (!res.ok) return null;
    const status = String(data?.status ?? "").toLowerCase();
    return status || null;
  } catch {
    return null;
  }
}

/**
 * Confere a origem do webhook.
 *
 * Preferida: `X-Cakto-Signature: v1=<hex>` com HMAC-SHA256 de
 * "<X-Cakto-Timestamp>.<corpo cru>", tolerância de 5 min (o que a doc pede).
 * Reserva: o campo `secret` do corpo, que toda entrega traz.
 * Sem o secret (não deu para lê-lo da API) devolve `null`: quem chama segue
 * pela re-consulta do pedido, que basta sozinha.
 */
export async function origemDoWebhookCakto(raw: string, headers: Headers, body: any): Promise<boolean | null> {
  if (!caktoConfigurada()) return null;
  const secret = await segredoDoWebhook();
  if (!secret) return null;
  return conferirAssinatura(raw, headers, body, secret);
}

/** A conta em si, separada para poder ser testada sem a API. */
export function conferirAssinatura(raw: string, headers: Headers, body: any, secret: string): boolean {
  const ts = headers.get("x-cakto-timestamp") || "";
  const assinatura = headers.get("x-cakto-signature") || "";
  if (ts && assinatura) {
    const idade = Math.abs(Date.now() / 1000 - Number(ts));
    if (Number.isFinite(idade) && idade <= 300) {
      const esperada = createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex");
      // Pode vir mais de uma versão separada por vírgula: só conferimos a v1.
      for (const parte of assinatura.split(",")) {
        const [versao, valor] = parte.trim().split("=");
        if (versao !== "v1" || !valor) continue;
        const a = Buffer.from(valor, "utf8");
        const b = Buffer.from(esperada, "utf8");
        if (a.length === b.length && timingSafeEqual(a, b)) return true;
      }
    }
  }
  const noCorpo = typeof body?.secret === "string" ? body.secret : "";
  if (noCorpo) {
    const a = Buffer.from(noCorpo, "utf8");
    const b = Buffer.from(secret, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
