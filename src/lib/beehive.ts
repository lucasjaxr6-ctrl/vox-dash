import "server-only";
import { storefrontUrl } from "./storefront";
import { getBeehiveCredentials, getStoreName } from "./settings";
import { buildPixBody, buildCardBody, buildMetadata, missingFields, type BeehiveAddress } from "./beehive-payload";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Beehive Pay — Pix + cartão transparente.
// Um único endpoint cria a transação (POST /v1/transactions).
//
// AUTENTICAÇÃO: a doc se contradiz — a prosa manda `Bearer <base64(SECRET:x)>`,
// o exemplo em curl da mesma página manda `Basic <base64(SECRET:x)>`, e a visão
// geral ainda cita `x-api-key`. A prosa deu 401 na conta real. Ver MODOS_AUTH:
// provamos os formatos e guardamos o que a API aceitar.
//
// CARTÃO: tokenizado no NAVEGADOR pelo SDK /v1/js (ele calcula o fingerprint e
// escolhe a adquirente; um POST direto em /v1/card-token gera token que a
// cobrança recusa). O token vai em `card: { hash }` — ver MODOS_CARD.
//
// Status (webhook/API): created, processing, authorized, paid, refused,
// refunded, chargedback.
// Doc: https://docs.beehivehub.io
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.conta.paybeehive.com.br/v1";

/** Mapeia o status da Beehive para o vocabulário interno. */
export function normalizeBeehiveStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "paid":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargedback":
    case "chargeback":
      return "CHARGEBACK";
    case "refused":
    case "canceled":
    case "cancelled":
    case "failed":
      return "DECLINED";
    // created, processing, waiting_payment e AUTHORIZED ficam indefinidos.
    // `authorized` é cartão autorizado mas não capturado: tratar como aprovado
    // liberaria pedido sem dinheiro liquidado. PENDING é no-op seguro — quem
    // decide é o webhook de `paid` ou a reconciliação.
    default:
      return "PENDING";
  }
}

type Address = BeehiveAddress;

/**
 * FORMATOS DE AUTENTICAÇÃO — a doc da Beehive se contradiz, então tentamos.
 *
 *  • "Notas Importantes" e "Autenticação" dizem: `Bearer <base64(SECRET:x)>`
 *  • o exemplo em curl da mesma doc usa: `Basic <base64(SECRET:x)>`
 *  • a "Visão geral" ainda cita `x-api-key` "se habilitado no seu gateway"
 *
 * Seguir a prosa deu 401 na conta real. Em vez de escolher por fé, provamos na
 * primeira chamada e guardamos o que funcionou. A ordem começa pelo exemplo em
 * curl, que é código que alguém rodou, e não texto que alguém escreveu.
 */
// O `x-api-key` ficou de fora da lista: sondado com chave falsa, respondeu
// exatamente o mesmo que não mandar credencial nenhuma ("Token inválido.", sem
// código) — o header é ignorado pela API.
//
// ⚠️ Os sufixos (RL), (RL-2), (RL-4) das mensagens de erro são RATE LIMIT
// ("Espere um segundo. (RL-X)", HTTP 429), e NÃO pistas sobre o formato de
// autenticação. Cheguei a ler assim; sondar rápido demais é que produzia isso.
const MODOS_AUTH = [
  { nome: "basic", montar: (s: string) => ({ Authorization: "Basic " + Buffer.from(`${s}:x`).toString("base64") }) },
  { nome: "bearer-base64", montar: (s: string) => ({ Authorization: "Bearer " + Buffer.from(`${s}:x`).toString("base64") }) },
  { nome: "bearer-cru", montar: (s: string) => ({ Authorization: `Bearer ${s}` }) },
  // Invertido (usuário "x", senha = segredo). É o que a HyperCash usa, e
  // confusão entre as duas ordens é erro comum de quem escreve a doc.
  { nome: "basic-invertido", montar: (s: string) => ({ Authorization: "Basic " + Buffer.from(`x:${s}`).toString("base64") }) },
] as const;

export type BeehiveAuthMode = (typeof MODOS_AUTH)[number]["nome"];

/** Modo que funcionou nesta loja, para não re-descobrir a cada chamada. */
const modoPorLoja = new Map<string, BeehiveAuthMode>();

function headersDoModo(modo: BeehiveAuthMode, secret: string): Record<string, string> {
  const m = MODOS_AUTH.find((x) => x.nome === modo) ?? MODOS_AUTH[0];
  return m.montar(secret);
}

/** Cabeçalhos de autenticação da loja (modo já descoberto, ou o primeiro). */
async function beehiveAuth(storeId: string): Promise<Record<string, string> | null> {
  const creds = await getBeehiveCredentials(storeId);
  if (!creds) return null;
  return headersDoModo(modoPorLoja.get(storeId) ?? MODOS_AUTH[0].nome, creds.secretKey);
}

type Origin = {
  /** Id do pedido no nosso lado — vai em `metadata.order_id`. */
  externalReference?: string;
  /** URL do checkout onde a venda aconteceu. */
  checkoutUrl?: string;
  address?: Address;
  shippingCents?: number;
};

/**
 * Monta o `metadata` obrigatório buscando o nome da loja e a vitrine.
 * As cinco chaves e o porquê de cada uma estão em `beehive-payload.ts`.
 */
async function metadataDaLoja(storeId: string, o: Origin, email: string): Promise<Record<string, string>> {
  const storeName = await getStoreName(storeId).catch(() => "");
  return buildMetadata({
    storeName: storeName || undefined,
    userEmail: email,
    orderId: o.externalReference,
    checkoutUrl: o.checkoutUrl,
    shopUrl: storefrontUrl(o.checkoutUrl ?? "") ?? undefined,
  });
}

/**
 * `enviado` é o corpo da requisição, mascarado. Vai junto no erro de propósito:
 * a Beehive recusa com "Dados inválidos" sem dizer qual campo, e sem saber o
 * que mandamos a depuração vira adivinhação — foi o que aconteceu duas vezes.
 * Esta mensagem é gravada em `providerPayload`; o CLIENTE vê a versão tratada
 * por `safeCardMessage`, nunca esta.
 */
function apiError(prefix: string, res: Response, data: any, enviado?: string): Error {
  const detail =
    (Array.isArray(data?.message) ? data.message.join(", ") : data?.message) ||
    data?.error?.message ||
    data?.error ||
    (data?.errors ? JSON.stringify(data.errors).slice(0, 200) : "") ||
    "sem detalhe";
  console.error("[beehive]", prefix, res.status, JSON.stringify(data).slice(0, 400), enviado ? `enviado=${enviado}` : "");
  // O status HTTP entra na mensagem porque ela é gravada no pedido: sem ele,
  // uma recusa de negócio e uma mudança de contrato da API ficam iguais.
  return new Error(`${prefix}: ${detail} [HTTP ${res.status}]${enviado ? ` enviado=${enviado}` : ""}`);
}

/**
 * ONDE O TOKEN VAI NO CORPO — a doc diz `card`, e a API recusa.
 *
 * Provado em produção: com `card: "<token>"` a resposta é 422 listando
 * "card.number is required, card.holderName is required…", ou seja, o validador
 * caiu no formato de OBJETO e não reconheceu a string. Mas a transação
 * 134581168 nasceu de um token, então existe um lugar que funciona.
 *
 * Um 422 de validação NÃO cria cobrança, então tentar os formatos é seguro:
 * nada é cobrado duas vezes. Paramos no primeiro que passar e guardamos qual
 * foi, para as vendas seguintes irem direto.
 */
// ORDEM IMPORTA, e não é estilo: o token é provavelmente de uso único. Na
// primeira sondagem em produção, `card.hash` foi o ÚNICO formato a passar da
// validação do cartão (os outros devolveram "card.number is required"), mas
// chegou como 4ª tentativa — com o token já usado três vezes. Vai na frente
// para receber o token novo. É o mesmo formato da FintPag/HylexPay, do mesmo
// motor.
const MODOS_CARD = [
  { nome: "card.hash", montar: (t: string) => ({ card: { hash: t } }) },
  { nome: "cardHash", montar: (t: string) => ({ cardHash: t }) },
  { nome: "card.token", montar: (t: string) => ({ card: { token: t } }) },
  { nome: "cardToken", montar: (t: string) => ({ cardToken: t }) },
  { nome: "card-string", montar: (t: string) => ({ card: t }) },
] as const;

type ModoCard = (typeof MODOS_CARD)[number]["nome"];
const modoCardPorLoja = new Map<string, ModoCard>();

/**
 * A resposta é "não reconheci seu token" (e não uma recusa de verdade)?
 * Só nesse caso vale tentar outro formato.
 */
function pareceFormatoErrado(status: number, data: any): boolean {
  if (status !== 422 && status !== 400) return false;
  const msg = Array.isArray(data?.message) ? data.message.join(" ") : String(data?.message ?? "");
  return /card\.(number|holderName|cvv|expiration)/i.test(msg);
}

/** A transação pode vir em data, data.data ou data.transaction. */
function txnFrom(data: any): any {
  return data?.data ?? data?.transaction ?? data ?? {};
}

/**
 * Lê o status venha ele como for.
 *
 * Uma cobrança real (txn 134581168) devolveu `status` como OBJETO, e o
 * `String(...)` do código virou `"[object Object]"` gravado no pedido — um
 * status ilegível é pior que nenhum, porque parece dado e não é.
 */
function statusTexto(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["status", "name", "code", "value", "message", "description"]) {
      if (typeof o[k] === "string" && o[k]) return o[k] as string;
    }
    return JSON.stringify(v).slice(0, 120);
  }
  return v == null ? "" : String(v);
}

/**
 * Cópia do corpo SEM dado sensível, para gravar junto do erro.
 *
 * Sem isto, cada recusa vira adivinhação: a Beehive responde "Dados inválidos"
 * sem dizer qual campo, e não havia registro do que foi enviado. Número vira
 * BIN + final (o que já aparece no pedido) e o CVV some — PCI-DSS proíbe
 * guardar os dois, e depurar não é motivo para abrir exceção.
 */
function corpoMascarado(body: Record<string, unknown>): string {
  try {
    const copia: any = JSON.parse(JSON.stringify(body));

    // O CARTÃO SAI NA FRENTE, e resumido. Ele é o campo que a Beehive recusa e
    // fica no fim do JSON, depois do endereço — na primeira tentativa o corte de
    // tamanho comeu justamente ele, e o registro não serviu para nada.
    let resumoCard: string;
    if (typeof copia?.card === "string") {
      const t = copia.card;
      resumoCard = `token[${t.length} chars] início="${t.slice(0, 24)}"`;
    } else if (copia?.card && typeof copia.card === "object") {
      const n = String(copia.card.number ?? "");
      resumoCard = `OBJETO(!) number=${n.length} dígitos, campos=${Object.keys(copia.card).join("/")}`;
    } else {
      resumoCard = `ausente (${typeof copia?.card})`;
    }
    delete copia.card;

    const resto = JSON.stringify(copia);
    return `card=${resumoCard} · installments=${copia.installments ?? "-"} · resto=${resto.slice(0, 500)}`;
  } catch {
    return "(não foi possível serializar)";
  }
}

/**
 * Procura o copia-e-cola do Pix na resposta.
 *
 * A doc nomeia `qrCode` e avisa que a IMAGEM não vem — quem desenha o QR é o
 * checkout, a partir deste texto. As outras chaves são tolerância defensiva: o
 * contrato publicado não mostra o corpo da resposta do Pix, só cita o campo.
 */
function extractPix(tx: any): { qrCode: string; expiresAt: string | null } {
  const p = tx?.pix ?? tx?.pixData ?? tx ?? {};
  const qrCode = String(
    p.qrCode ?? p.qrcode ?? p.qr_code ?? p.copyPaste ?? p.copy_paste ?? p.emv ?? p.payload ?? "",
  );
  const exp = p.expiresAt ?? p.expirationDate ?? p.expiration_date ?? p.expires_at ?? p.dueDate ?? null;
  return { qrCode, expiresAt: exp ? String(exp) : null };
}

/** Cria uma cobrança Pix na Beehive. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    shippingCents?: number;
    postbackUrl?: string;
    externalReference?: string;
    checkoutUrl?: string;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
  },
): Promise<PixCharge> {
  const auth = await beehiveAuth(storeId);
  if (!auth) throw new Error("Beehive não configurada. Informe a chave secreta no painel.");

  // `paymentMethod` vai em minúsculas, ao contrário da família FastSoft
  // (HyperCash/FintPag), que exige PIX/CREDIT_CARD em maiúsculas.
  const body = buildPixBody({
    amountCents: input.amountCents,
    customer: input.customer,
    description: input.description,
    items: input.items,
    address: input.address,
    shippingCents: input.shippingCents,
    payerIp: input.payerIp,
    postbackUrl: input.postbackUrl,
    metadata: await metadataDaLoja(storeId, input, input.customer.email),
  });

  const res = await fetch(`${API_BASE}/transactions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok) throw apiError("Falha ao gerar o Pix", res, data, corpoMascarado(body));

  const tx = txnFrom(data);
  const { qrCode, expiresAt } = extractPix(tx);
  if (!qrCode) throw new Error("Beehive não retornou o código Pix (copia e cola).");
  return {
    id: String(tx.id ?? tx.transactionId ?? ""),
    status: normalizeBeehiveStatus(statusTexto(tx.status)),
    qrCode,
    qrCodeUrl: null, // a doc avisa: a imagem é responsabilidade nossa
    expiresAt,
  };
}

export type BeehiveCardResult = { id: string; status: string; statusDetail: string };

/**
 * Cobrança no CARTÃO — `card` é o TOKEN gerado no navegador.
 *
 * O 422 com "card.number is required" que me fez trocar isto por campos crus
 * vinha de token INVÁLIDO: quando o valor não é um token reconhecido, a API cai
 * na validação do objeto e lista os campos que faltam. Com token válido a
 * cobrança nasce (foi o caso da transação 134581168).
 */
export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    installments: number;
    payerIp?: string;
    postbackUrl?: string;
    externalReference?: string;
    checkoutUrl?: string;
    address?: Address;
    shippingCents?: number;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
    /** Token gerado no navegador pelo SDK (base64 longo). */
    cardToken: string;
    /** O fingerprint do SDK carregou? Só entra no registro do erro. */
    fingerprint?: "ok" | "ausente";
    /** Forma do retorno do `encrypt`. Só entra no registro do erro. */
    tokenShape?: string;
  },
): Promise<BeehiveCardResult> {
  const auth = await beehiveAuth(storeId);
  if (!auth) throw new Error("Beehive não configurada.");
  const token = (input.cardToken || "").trim();
  if (!token) throw new Error("Token do cartão ausente.");

  const body = buildCardBody({
    amountCents: input.amountCents,
    customer: input.customer,
    description: input.description,
    items: input.items,
    address: input.address,
    shippingCents: input.shippingCents,
    payerIp: input.payerIp,
    postbackUrl: input.postbackUrl,
    metadata: await metadataDaLoja(storeId, input, input.customer.email),
    cardToken: token,
    installments: input.installments,
  });

  // Barreira local: a API valida os mesmos campos e devolve uma lista de erros
  // em inglês que vira "CVV inválido" para o cliente, mesmo quando o problema é
  // outro. Falhar aqui, com o campo nomeado, é mais honesto e mais rápido.
  const faltando = missingFields(body);
  if (faltando.length) throw new Error(`Beehive: campos inválidos (${faltando.join(", ")}).`);

  // Tenta os formatos de token até um passar. Começa pelo que já funcionou nesta
  // loja; um 422 de validação não cria cobrança, então não há risco de cobrar
  // duas vezes. Qualquer outra resposta (recusa, erro) interrompe na hora.
  const conhecido = modoCardPorLoja.get(storeId);
  const ordem = conhecido ? [conhecido, ...MODOS_CARD.map((m) => m.nome).filter((n) => n !== conhecido)] : MODOS_CARD.map((m) => m.nome);
  const tentados: string[] = [];
  let ultimo: { res: Response; data: any; corpo: Record<string, unknown> } | null = null;

  for (const nome of ordem) {
    const modo = MODOS_CARD.find((m) => m.nome === nome)!;
    // Remove as chaves dos outros formatos antes de aplicar o deste.
    const corpo: Record<string, unknown> = { ...body };
    for (const k of ["card", "cardToken", "cardHash"]) delete corpo[k];
    Object.assign(corpo, modo.montar(token));

    const res = await fetch(`${API_BASE}/transactions`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify(corpo),
    });
    const data = await res.json().catch(() => ({}) as any);

    if (res.ok) {
      modoCardPorLoja.set(storeId, nome);
      if (tentados.length) console.log("[beehive] formato de token aceito:", nome, "· descartados:", tentados.join(", "));
      const tx = txnFrom(data);
      return {
        id: String(tx.id ?? tx.transactionId ?? ""),
        status: normalizeBeehiveStatus(statusTexto(tx.status)),
        statusDetail: statusTexto(tx.refusedReason ?? tx.status),
      };
    }

    // Transação criada e recusada: é resposta de negócio, não de formato.
    const t = txnFrom(data);
    if (t?.id && normalizeBeehiveStatus(statusTexto(t?.status)) === "DECLINED") {
      modoCardPorLoja.set(storeId, nome);
      const motivo = statusTexto(data?.error?.refusedReason ?? t?.refusedReason ?? t?.status);
      // A resposta inteira vai junto: eles devolvem só "Transação não
      // autorizada.", sem código, e sem ver o corpo não dá para saber se o
      // motivo do adquirente está em algum campo que estamos descartando.
      // Não há dado de cartão aqui — o corpo é a resposta DELES.
      const bruto = JSON.stringify(data).slice(0, 400);
      return {
        id: String(t.id),
        status: "DECLINED",
        statusDetail: `${motivo} · resposta=${bruto}`,
      };
    }

    ultimo = { res, data, corpo };
    if (!pareceFormatoErrado(res.status, data)) break; // erro real: não insiste
    tentados.push(nome);
  }

  throw apiError(
    "Falha ao processar o cartão",
    ultimo!.res,
    ultimo!.data,
    `${corpoMascarado(ultimo!.corpo)} · fingerprint=${input.fingerprint ?? "?"} · encrypt=${input.tokenShape || "?"} · formatos tentados=${tentados.join(",") || "(nenhum)"}`,
  );
}

/** Consulta o status normalizado de uma transação Beehive (ou null). */
export async function getBeehiveTransactionStatus(storeId: string, id: string): Promise<string | null> {
  const auth = await beehiveAuth(storeId);
  if (!auth) return null;
  try {
    const res = await fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}`, {
      headers: { ...auth, accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const tx = txnFrom(data);
    // `status` pode vir como objeto (visto numa cobrança real) — statusTexto
    // extrai o texto. Vazio devolve null: "sem status" não é "pendente".
    const texto = statusTexto(tx?.status);
    return texto ? normalizeBeehiveStatus(texto) : null;
  } catch {
    return null;
  }
}

/**
 * Endpoint de sondagem.
 *
 * É `/transactions` e NÃO `/balance`: a doc lista `/balance` entre os endpoints,
 * mas a API real devolve 404 nele (verificado em 18/09/2026, sem credencial).
 * Testar autenticação contra uma rota inexistente dá 404 em todo formato — foi
 * o que fez o teste do painel falhar dizendo "não aceitou a conexão".
 */
const ROTA_SONDA = "/transactions?limit=1";

/**
 * Descobre QUAL formato de autenticação esta conta aceita, provando um a um.
 *
 * Leitura barata, sem criar nada. Guarda o vencedor em memória, então o custo é
 * uma vez por instância — as cobranças seguintes já saem no formato certo.
 *
 * Devolve também o que cada tentativa respondeu. Sem isso, "recusada" é só uma
 * palavra: com isso dá para ver se é 401 em todos (chave errada mesmo) ou 401 em
 * uns e 200 noutro (era o formato).
 */
export async function resolveBeehiveAuth(
  storeId: string,
): Promise<{ modo: BeehiveAuthMode | null; tentativas: { modo: string; status: number | string; corpo?: string }[] }> {
  const creds = await getBeehiveCredentials(storeId);
  if (!creds) return { modo: null, tentativas: [] };

  const tentativas: { modo: string; status: number | string; corpo?: string }[] = [];
  for (const m of MODOS_AUTH) {
    try {
      const res = await fetch(`${API_BASE}${ROTA_SONDA}`, {
        headers: { ...m.montar(creds.secretKey), accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        tentativas.push({ modo: m.nome, status: res.status });
        modoPorLoja.set(storeId, m.nome);
        return { modo: m.nome, tentativas };
      }
      // O corpo do erro costuma dizer mais que o status (ex.: "invalid token"
      // x "account suspended"). Nunca contém o segredo — é a resposta deles.
      const corpo = (await res.text().catch(() => "")).slice(0, 160);
      tentativas.push({ modo: m.nome, status: res.status, corpo });
    } catch (e) {
      tentativas.push({ modo: m.nome, status: "rede", corpo: e instanceof Error ? e.message : "" });
    }
  }
  return { modo: null, tentativas };
}

/**
 * Checa se a credencial autentica, testando todos os formatos da doc.
 * Usado pelo painel ao salvar a chave.
 */
export async function checkBeehiveCredentials(
  storeId: string,
): Promise<{ ok: boolean; error?: string; modo?: BeehiveAuthMode; detalhe?: string }> {
  const creds = await getBeehiveCredentials(storeId);
  if (!creds) return { ok: false, error: "Chave secreta não configurada." };

  const { modo, tentativas } = await resolveBeehiveAuth(storeId);
  if (modo) return { ok: true, modo };

  // Nenhum formato passou: mostra o que a API respondeu em cada um. É a
  // diferença entre "a chave está errada" e "estamos falando errado com eles".
  const resumo = tentativas.map((t) => `${t.modo}: ${t.status}${t.corpo ? ` ${t.corpo}` : ""}`).join(" · ");
  console.error("[beehive] nenhum formato de auth funcionou:", resumo);
  const todos401 = tentativas.every((t) => t.status === 401 || t.status === 403);
  // "Token inválido." SEM código é a mesma resposta que a API dá a quem não
  // manda credencial nenhuma — sinal de que a chave não foi reconhecida, e não
  // de que o formato está errado.
  const naoReconhecida = tentativas.some((t) => (t.corpo ?? "").includes("Token inválido.") && !/RL/.test(t.corpo ?? ""));
  return {
    ok: false,
    error: todos401
      ? naoReconhecida
        ? "A Beehive não reconheceu a chave. Confira se é a SECRETA (não a pública) e se a conta já está com o cadastro aprovado — chave de conta pendente costuma ser recusada assim."
        : "Chave recusada em todos os formatos — confira se copiou a chave SECRETA em Configurações → Credenciais de API."
      : "A Beehive não aceitou a conexão. Veja o detalhe abaixo.",
    detalhe: resumo,
  };
}
