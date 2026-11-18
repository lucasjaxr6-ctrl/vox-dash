import "server-only";
import { query, execute } from "./db";
import { getResendConfig, getDomainConfig, getCheckoutTheme, getEmailTempos, isEmailKindEnabled } from "./settings";
import { mergeTheme } from "./checkout-theme";
import { logOutbound } from "./outbound";
import {
  brl, esc, shell, intro, summaryCard, infoBox, ctaButton, codeBlock, timeline, twoCols, note,
  type EmailItem,
} from "./email-ui";

// ─────────────────────────────────────────────────────────────────────────────
// Envio de e-mail transacional via Resend (por loja). A API key e o remetente
// são configurados pelo lojista no painel. Best-effort: nunca lança nem derruba
// o fluxo de pagamento.
// Docs: POST https://api.resend.com/emails  { from, to, subject, html }
//
// O VISUAL vem todo de ./email-ui — os quatro e-mails dividem o mesmo esqueleto
// (cabeçalho, faixa de status, resumo, rodapé). Antes cada um tinha o seu HTML
// copiado, e o cliente recebia três e-mails com três caras diferentes.
// ─────────────────────────────────────────────────────────────────────────────

const RESEND_API = "https://api.resend.com/emails";

function methodLabel(m: string | null): string {
  switch (m) {
    case "PIX": return "Pix";
    case "CREDIT_CARD": return "Cartão de crédito";
    default: return "—";
  }
}

function dataHora(d: Date | string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (!Number.isFinite(dt.getTime())) return "—";
  return dt
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
    .replace(", ", " às ");
}

type OrderRow = {
  id: string;
  status: string;
  totalCents: number;
  shippingCents: number | null;
  discountCents: number | null;
  paidAt: Date | null;
  customerName: string | null;
  customerEmail: string | null;
  paymentMethod: string | null;
};

const ORDER_COLS = `id, status, totalCents, shippingCents, discountCents, paidAt,
                    customerName, customerEmail, paymentMethod`;

const firstName = (o: OrderRow) => (o.customerName || "").trim().split(/\s+/)[0] || "";
const shortId = (o: OrderRow) => o.id.slice(0, 8).toUpperCase();

async function loadItems(orderId: string): Promise<EmailItem[]> {
  return query<EmailItem>(
    `SELECT p.name AS name, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents
       FROM order_items oi JOIN products p ON p.id = oi.productId
      WHERE oi.orderId = ?`,
    [orderId],
  );
}

/**
 * De onde saem os ícones do e-mail. Preferimos o domínio próprio da loja: a
 * imagem vem do mesmo domínio dos links do pedido, o que evita cara de
 * conteúdo de terceiro para os filtros de spam. Sem domínio verificado, cai na
 * URL da plataforma.
 */
function assetBase(dom: { customDomain: string | null; domainVerified: boolean }): string | null {
  if (dom.customDomain && dom.domainVerified) return `https://${dom.customDomain}`;
  const fixo = process.env.EMAIL_ASSET_BASE?.trim();
  if (fixo) return fixo.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

type Brand = { logoUrl: string | null; tagline: string | null; assetBase: string | null };

/**
 * Logo, assinatura e origem dos ícones da loja.
 *
 * O domínio do checkout NÃO é IMPRESSO no e-mail de propósito: é endereço
 * técnico (`checkout.delladecor.com`), não a marca que o cliente conhece. Aqui
 * ele serve só como origem das imagens.
 */
async function branding(storeId: string): Promise<Brand> {
  try {
    const [theme, dom] = await Promise.all([
      getCheckoutTheme(storeId).then(mergeTheme),
      getDomainConfig(storeId),
    ]);
    return {
      logoUrl: theme.header.logoUrl || null,
      tagline: theme.header.tagline || null,
      assetBase: assetBase(dom),
    };
  } catch {
    return { logoUrl: null, tagline: null, assetBase: null };
  }
}

/** Resumo do pedido com a composição real (subtotal, desconto, frete). */
function resumo(order: OrderRow, items: EmailItem[], totalLabel?: string): string {
  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  return summaryCard({
    items,
    subtotalCents: subtotal,
    discountCents: Number(order.discountCents ?? 0),
    shippingCents: Number(order.shippingCents ?? 0),
    totalCents: Number(order.totalCents),
    totalLabel,
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * Etapas da linha do tempo, uma só lista para os dois e-mails que a usam —
 * duas cópias da mesma coisa é como elas acabam divergindo.
 *
 * "Postado" é quando o pacote é ENTREGUE à transportadora e o código de
 * rastreio nasce. Não confundir com "saiu para entrega", que é o último
 * trecho, já na cidade do cliente, no mesmo dia da chegada — anunciar isso na
 * postagem faz o cliente esperar o pacote naquele dia.
 */
const ETAPAS = ["Pagamento confirmado", "Em preparação", "Postado", "Entregue"];

function htmlPix(store: string, b: Brand, order: OrderRow, items: EmailItem[], pixCode: string, payUrl: string | null): string {
  return shell({
    store, ...b,
    icon: "pix",
    title: "Seu Pix foi gerado",
    subtitle: "Finalize seu pagamento para garantir seu pedido.",
    body: `
      ${intro(firstName(order), `Reservamos o seu pedido <b>#${shortId(order)}</b>. Para garantir a compra, finalize o pagamento com o Pix copia e cola abaixo.`)}
      ${resumo(order, items)}
      ${codeBlock("Código Pix (copia e cola)", pixCode)}
      ${ctaButton("Abrir e copiar o código Pix", payUrl)}
      ${payUrl ? `<p style="margin:8px 0 0;text-align:center;font-size:12px;color:#93a29b;">Ou copie o código acima manualmente.</p>` : ""}
      ${infoBox(b.assetBase, "lock", "Pagamento seguro", "Seu pagamento é processado de forma segura e a confirmação acontece automaticamente.")}
      ${note("Se você já realizou o pagamento, não é necessário fazer mais nada. Qualquer dúvida, é só responder este e-mail.")}`,
  });
}

function htmlPago(store: string, b: Brand, order: OrderRow, items: EmailItem[], orderUrl: string | null): string {
  return shell({
    store, ...b,
    icon: "check",
    title: "Pagamento confirmado",
    subtitle: "Recebemos o seu pagamento com sucesso!",
    body: `
      ${intro(firstName(order), `Seu pagamento foi confirmado e o pedido <b>#${shortId(order)}</b> já está em processamento.`)}
      ${resumo(order, items, "Total pago")}
      ${twoCols(
        { label: "Forma de pagamento", value: methodLabel(order.paymentMethod) },
        { label: "Pago em", value: dataHora(order.paidAt) },
      )}
      ${infoBox(b.assetBase, "box", "Próxima etapa", "Nossa equipe iniciará a separação do seu pedido. Você receberá um novo e-mail assim que ele for postado, com o código de rastreamento.")}
      ${ctaButton("Ver meu pedido", orderUrl)}
      ${note(`Obrigado por escolher a ${esc(store)}! Estamos sempre à disposição.`)}`,
  });
}

function htmlSeparacao(store: string, b: Brand, order: OrderRow, items: EmailItem[]): string {
  return shell({
    store, ...b,
    icon: "box",
    title: "Seu pedido está em preparação",
    subtitle: "Estamos separando e embalando com todo cuidado.",
    body: `
      ${intro(firstName(order), `Seu pagamento foi confirmado e o pedido <b>#${shortId(order)}</b> já está sendo separado pela nossa equipe.`)}
      ${timeline(ETAPAS, 1)}
      <p style="margin:14px 0 0;font-size:13px;color:#6b7c74;line-height:1.55;">
        Neste momento, nossa equipe está realizando a separação e conferência dos produtos antes do envio.
      </p>
      <div style="height:18px;font-size:0;line-height:0;">&nbsp;</div>
      ${resumo(order, items)}
      ${infoBox(b.assetBase, "truck", "Próxima atualização", "Assim que o pedido for postado na transportadora, enviaremos o código de rastreamento por e-mail para você acompanhar a entrega.")}`,
    // Sem botão de propósito: nesta fase não há o que acompanhar — o pacote
    // ainda não existe. O link útil é o do e-mail de rastreio, que sai com o
    // código. Um botão aqui só desviaria o cliente para uma tela sem novidade.
  });
}

/**
 * A página de rastreio PRÓPRIA já pode receber clientes?
 *
 * LIGADO em 27/09/2026, depois de conferir uma encomenda real: token do 17TRACK
 * salvo, ZA07369342701 abriu com a marca da loja, China Post detectada e o
 * evento traduzido do chinês. As três lojas que despacham (Della, Melora,
 * Sunizze) têm domínio próprio verificado, então o link sempre cai num host que
 * resolve a loja.
 *
 * Se precisar voltar atrás: `false` manda todo mundo para o 17track de novo,
 * imediatamente, sem perder nada — os eventos continuam sendo gravados aqui.
 *
 * ⚠️ Depende da COTA do 17TRACK. Sem cota, o código novo não é registrado e a
 * página fica sem movimentações — pior que a tela em chinês. Conferir em
 * Admin → Configurações → Rastreamento.
 */
const RASTREIO_PROPRIO = true;

/**
 * Link de acompanhamento da entrega.
 *
 * Com o rastreio próprio ligado, aponta para a página da loja, em português.
 * Sem domínio conhecido (loja sem domínio verificado e sem URL de plataforma)
 * cai no 17track de qualquer forma — melhor um link torto que um botão quebrado.
 */
function urlRastreio(assetBase: string | null, code: string): string {
  const c = encodeURIComponent(code);
  if (!RASTREIO_PROPRIO || !assetBase) return `https://t.17track.net/pt-br#nums=${c}`;
  return `${assetBase}/rastreio/${c}`;
}

// Não existe mais URL de rastreio por ID DE PEDIDO: o e-mail de "em
// preparação" era o único que a usava e ficou sem botão. A PÁGINA continua
// aceitando o id como chave de propósito — os e-mails já enviados com esse
// link precisam seguir abrindo.

function htmlRastreio(store: string, b: Brand, order: OrderRow, code: string): string {
  return shell({
    store, ...b,
    icon: "truck",
    title: "Seu pedido foi postado",
    subtitle: "Já pode acompanhar o trajeto pelo código abaixo.",
    body: `
      ${intro(firstName(order), `O pedido <b>#${shortId(order)}</b> foi entregue à transportadora e o código de rastreamento já está disponível.`)}
      ${timeline(ETAPAS, 2)}
      ${codeBlock("Código de rastreamento", code)}
      ${ctaButton("Acompanhar entrega", urlRastreio(b.assetBase, code))}
      ${infoBox(b.assetBase, "truck", "O que acontece agora", "O pacote segue para os centros de distribuição até chegar à sua cidade. Quando estiver com o entregador, o rastreio vai mostrar “saiu para entrega”.")}
      ${note("O rastreamento pode levar algumas horas para exibir a primeira atualização. Qualquer dúvida, é só responder este e-mail.")}`,
  });
}

/**
 * Recuperação de carrinho abandonado.
 *
 * É o único e-mail que vai para quem NÃO comprou, e o tom muda por causa disso:
 * sem "seu pedido", sem número de pedido, sem prometer reserva de estoque que
 * não existe. Um convite para voltar, com o que ele já tinha escolhido.
 */
function htmlRecuperacao(store: string, b: Brand, firstName: string, items: EmailItem[], totalCents: number, url: string | null): string {
  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  return shell({
    store, ...b,
    icon: "cart",
    title: "Você deixou algo no carrinho",
    subtitle: "Estes itens continuam disponíveis para você.",
    body: `
      ${intro(firstName, "Vimos que você começou uma compra e não finalizou. Guardamos o que você escolheu — é só continuar de onde parou.")}
      ${summaryCard({
        items,
        subtotalCents: subtotal,
        discountCents: 0,
        shippingCents: 0,
        totalCents: totalCents > 0 ? totalCents : subtotal,
        totalLabel: "Total",
        title: "Seu carrinho",
      })}
      ${ctaButton("Finalizar minha compra", url)}
      ${infoBox(b.assetBase, "lock", "Compra segura", "Seu pagamento é processado em ambiente seguro e os seus dados não são compartilhados.")}
      ${note("Se você já concluiu a compra, pode ignorar este e-mail. Qualquer dúvida, é só responder aqui.")}`,
  });
}

/**
 * Pix gerado e não pago.
 *
 * Diferente da recuperação de carrinho: aqui a cobrança EXISTE. O cliente não
 * precisa refazer nada, só pagar — então o copia e cola vem junto, e o texto
 * não convida a "voltar", lembra que o código ainda está valendo.
 */
function htmlPixNaoPago(store: string, b: Brand, order: OrderRow, items: EmailItem[], pixCode: string, payUrl: string | null): string {
  return shell({
    store, ...b,
    icon: "pix",
    title: "Seu Pix ainda está valendo",
    subtitle: "Falta só o pagamento para o pedido seguir.",
    body: `
      ${intro(firstName(order), `O Pix do pedido <b>#${shortId(order)}</b> foi gerado e ainda não identificamos o pagamento. O código abaixo continua válido.`)}
      ${resumo(order, items)}
      ${codeBlock("Código Pix (copia e cola)", pixCode)}
      ${ctaButton("Abrir e copiar o código Pix", payUrl)}
      ${
        // O código impresso acima ENVELHECE com o e-mail, que pode ser aberto dias
        // depois. A página do botão gera outro na hora, mas quem copia direto daqui
        // não saberia disso. Sem citar prazo: a validade muda de gateway para gateway.
        payUrl
          ? `<p style="margin:8px 0 0;text-align:center;font-size:12px;color:#93a29b;">Se o seu banco recusar o código, toque no botão acima que geramos um novo na hora.</p>`
          : ""
      }
      ${infoBox(b.assetBase, "lock", "Confirmação automática", "Assim que o pagamento cair, a confirmação chega no seu e-mail — não precisa enviar comprovante.")}
      ${note("Se você já pagou, pode ignorar este e-mail: a compensação do Pix leva alguns minutos. Qualquer dúvida, é só responder aqui.")}`,
  });
}

// ── Envio ────────────────────────────────────────────────────────────────────

/** Link público do pedido — só com domínio próprio verificado da loja. */
/**
 * O código venceu antes de o e-mail sair: imprimir um código morto faria o cliente
 * achar que a loja está com problema. O botão leva à página do Pix, que confere se o
 * antigo foi pago e gera outro na hora (lib/pix-renew, mesma regra de validade).
 */
function htmlPixVencido(store: string, b: Brand, order: OrderRow, items: EmailItem[], payUrl: string): string {
  return shell({
    store, ...b,
    icon: "pix",
    title: "Seu pedido está esperando o pagamento",
    subtitle: "Falta só o pagamento para o pedido seguir.",
    body: `
      ${intro(firstName(order), `Ainda não identificamos o pagamento do pedido <b>#${shortId(order)}</b>. Toque no botão abaixo para gerar um novo código Pix e concluir a compra.`)}
      ${resumo(order, items)}
      ${ctaButton("Gerar novo código Pix", payUrl)}
      ${infoBox(b.assetBase, "lock", "Confirmação automática", "Assim que o pagamento cair, a confirmação chega no seu e-mail. Não precisa enviar comprovante.")}
      ${note("Se você já pagou, pode ignorar este e-mail: a compensação do Pix leva alguns minutos. Qualquer dúvida, é só responder aqui.")}`,
  });
}

const PIX_VENCIDO_SQL = `(COALESCE(pixExpiresAt, DATE_ADD(createdAt, INTERVAL 30 MINUTE)) <= NOW(3)) AS vencido`;
const SEM_LINK_PARA_RENOVAR = "O Pix venceu e a loja não tem domínio próprio verificado para gerar outro.";

async function orderUrlFor(storeId: string, orderId: string, path: "obrigado" | "pix"): Promise<string | null> {
  const dom = await getDomainConfig(storeId);
  if (!dom.customDomain || !dom.domainVerified) return null;
  return `https://${dom.customDomain}/${path}/${orderId}`;
}

/**
 * Envia o e-mail com o CÓDIGO DE RASTREIO ao cliente. Retorna {ok,error} para o
 * painel exibir o resultado (diferente do e-mail de compra, aqui é acionado
 * manualmente pelo lojista, então o erro precisa ser visível).
 */
export async function sendTrackingEmail(storeId: string, orderId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  // Este é acionado À MÃO pelo lojista, então "desligado" não pode virar um
  // silêncio nem ser confundido com "Resend não configurado" — as duas causas
  // pedem ações diferentes. Por isso a checagem aparece separada aqui.
  if (!(await isEmailKindEnabled(storeId, "tracking"))) {
    return { ok: false, error: 'O e-mail "Pedido postado" está desligado em E-mails › Configuração.' };
  }
  const cfg = await getResendConfig(storeId, "tracking");
  if (!cfg) return { ok: false, error: "Configure e ative o Resend em E-mails › Configuração antes de enviar." };

  const rows = await query<OrderRow>(
    `SELECT ${ORDER_COLS} FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [orderId, storeId],
  );
  const order = rows[0];
  if (!order) return { ok: false, error: "Pedido não encontrado." };
  if (!order.customerEmail) return { ok: false, error: "Este pedido não tem e-mail do cliente." };

  const subject = `Seu pedido foi postado — ${cfg.storeName}`;
  const html = htmlRastreio(cfg.storeName, await branding(storeId), order, code);
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [order.customerEmail], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as any);
      return { ok: false, error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` };
    }
    await logOutbound(storeId, { toAddr: order.customerEmail, subject, htmlBody: html, kind: "tracking" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}

/** Itens do carrinho abandonado (guardados em JSON pelo checkout). */
type ItemCarrinho = { productId?: string; name?: string; quantity?: number; priceCents?: number };

function itensDoCarrinho(itemsJson: string | null): EmailItem[] {
  try {
    const arr = JSON.parse(itemsJson || "[]") as ItemCarrinho[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((i) => i && i.name)
      .map((i) => ({
        name: String(i.name).slice(0, 160),
        quantity: Math.max(1, Math.round(Number(i.quantity) || 1)),
        unitPriceCents: Math.max(0, Math.round(Number(i.priceCents) || 0)),
      }));
  } catch {
    return [];
  }
}

/**
 * Freio da varredura. A batida é a cada 20s por visitante; sem isto, uma loja
 * com 30 pessoas no checkout varreria 90 vezes por minuto.
 *
 * É memória do processo: em serverless cada instância tem a sua, então na
 * prática varre um pouco mais que isto — e tudo bem, porque a consulta é
 * indexada e a reserva no banco impede envio duplicado de qualquer forma.
 */
const SWEEP_THROTTLE_MS = 60_000;
const SWEEP_LIMIT = 5;
const ultimaVarredura = new Map<string, number>();

type CartRow = {
  id: string; name: string | null; email: string | null; totalCents: number;
  itemsJson: string | null; status: string;
  recoveryEmailId: string | null; recoveryEmailAt: Date | null;
  minutosParaDisparo: number | null;
};

const CART_COLS = `id, name, email, totalCents, itemsJson, status, recoveryEmailId, recoveryEmailAt,
                   TIMESTAMPDIFF(MINUTE, NOW(3), recoveryEmailAt) AS minutosParaDisparo`;

/**
 * O comprador tem pedido em andamento (Pix gerado, cartão em análise) ou pago da
 * mesma ida às compras deste carrinho, mesmo que feito noutra aba ou sessão.
 *
 * Antes só o pago DEPOIS de abrir o carrinho contava, e o Pix converte só o
 * carrinho da própria sessão. Quem tinha o checkout em duas abas recebia "você
 * deixou algo no carrinho" uns 15 minutos depois do "Pix gerado": gerou o Pix numa
 * aba e a outra ficou parada, ou gerou o Pix e abriu o checkout de novo. Foram 15
 * casos em uma semana (Sunizze, AVELIN, NOBREVIA, ALVONTI, até 10/11/2026). Pior:
 * quem gerava o Pix, abria outra aba e PAGAVA também recebia, porque o pedido era
 * de antes do carrinho novo.
 *
 * A janela começa 2 h antes de o carrinho abrir: pega o pedido da mesma compra e
 * deixa de fora o cliente antigo que voltou outro dia. Quem tem Pix em aberto já
 * recebe o lembrete de Pix não pago. Pedido cancelado (gateway recusou, Pix
 * vencido) não conta: aí o carrinho ainda é a chance de trazê-lo de volta.
 * Usa o alias `ac`.
 */
const COMPROU_DEPOIS_DO_CARRINHO = `EXISTS (
  SELECT 1 FROM orders o
   WHERE o.storeId = ac.storeId AND o.status IN ('PENDING','PAID','SHIPPED')
     AND o.createdAt >= ac.createdAt - INTERVAL 2 HOUR
     AND ((ac.email IS NOT NULL AND o.customerEmail = ac.email)
       OR (ac.phone IS NOT NULL AND o.customerPhone = ac.phone)))`;

/** Monta assunto e HTML do e-mail de recuperação de um carrinho. */
async function montarRecuperacao(storeId: string, storeName: string, cart: CartRow) {
  const items = itensDoCarrinho(cart.itemsJson);
  if (items.length === 0) return { erro: "Este carrinho não tem itens registrados." as const };

  // Link que devolve o cliente ao checkout com o carrinho montado. Sem domínio
  // próprio verificado não existe endereço público — e um e-mail de recuperação
  // sem botão de voltar não recupera nada.
  const dom = await getDomainConfig(storeId);
  if (!dom.customDomain || !dom.domainVerified) {
    return { erro: "Configure o domínio próprio para gerar o link de retorno ao checkout." as const };
  }
  const url = `https://${dom.customDomain}/checkout?lead=${cart.id}`;
  const primeiro = (cart.name || "").trim().split(/\s+/)[0] || "";
  return {
    subject: `${primeiro ? `${primeiro}, v` : "V"}ocê deixou algo no carrinho — ${storeName}`,
    html: htmlRecuperacao(storeName, await branding(storeId), primeiro, items, Number(cart.totalCents), url),
  };
}

async function lerCarrinho(storeId: string, where: "id" | "sessionId", valor: string) {
  const rows = await query<CartRow>(
    `SELECT ${CART_COLS} FROM abandoned_carts WHERE ${where} = ? AND storeId = ? LIMIT 1`,
    [valor, storeId],
  );
  return rows[0] ?? null;
}

/**
 * Agenda (ou reagenda) o e-mail de recuperação deste carrinho no Resend.
 *
 * Chamado a cada salvamento do lead, enquanto o cliente preenche o checkout:
 *  • sem nada agendado  -> cria o e-mail com `scheduled_at` daqui a 15 min;
 *  • já agendado e perto de disparar -> PATCH empurrando 15 min de novo.
 *
 * O reagendamento é o que faz os 15 minutos serem de INATIVIDADE: enquanto o
 * cliente mexe, a hora marcada vai sendo adiada.
 *
 * Best-effort e silencioso — isto roda dentro do checkout e não pode derrubá-lo.
 */
/**
 * Varre a loja atrás de carrinhos que JÁ ficaram em silêncio e manda o e-mail.
 *
 * Roda de carona na batida de presença do checkout (`/api/live/beat`), que é o
 * único código nosso que executa com regularidade — e, por sorte, executa
 * justamente quando a loja tem movimento, que é quando há carrinho novo para
 * recuperar. Não é cron: ninguém precisa agendar nada.
 *
 * O e-mail só nasce AQUI, depois do tempo de silêncio configurado. Enquanto o cliente
 * preenche, não existe envio nenhum criado — logo não existe cancelamento para
 * dar errado.
 */
/**
 * Cancela um agendamento no Resend e DIZ se conseguiu.
 *
 * O cancelamento antes era `.catch(() => {})` e a linha era limpa de qualquer
 * jeito — ou seja, o sistema nunca soube se um único cancelamento funcionou, e
 * o banco parecia limpo mesmo quando o e-mail tinha saído.
 *
 * Devolve `true` quando não há mais nada a fazer com aquele id:
 *  • 2xx        — cancelado de verdade;
 *  • 404/4xx    — não existe mais lá (já saiu, ou já tinha sido cancelado).
 *                 Insistir só geraria tentativa infinita a cada varredura.
 * Devolve `false` no que é transitório (rede, 5xx, 429, chave recusada), para
 * a próxima varredura tentar de novo.
 */
async function cancelarNoResend(apiKey: string, emailId: string): Promise<boolean> {
  try {
    const res = await fetch(`${RESEND_API}/${encodeURIComponent(emailId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      console.log("[cancelRecovery] ok", emailId);
      return true;
    }
    const corpo = (await res.text().catch(() => "")).slice(0, 200);
    console.error("[cancelRecovery] falhou", emailId, res.status, corpo);
    // 401/403 = chave; 429 = limite. Os dois passam com o tempo — não desistir.
    if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) return false;
    return true;
  } catch (e) {
    console.error("[cancelRecovery] erro", emailId, e instanceof Error ? e.message : e);
    return false;
  }
}

export async function sweepCartRecovery(
  storeId: string,
  opts: { ignorarFreio?: boolean } = {},
): Promise<void> {
  const agora = Date.now();
  // O freio existe para a batida de presença, que chega dezenas de vezes por
  // minuto. O relógio (cron) já vem espaçado, e passar por ele aqui faria a
  // varredura pular rodadas inteiras quando caísse na mesma instância.
  if (!opts.ignorarFreio) {
    const ultima = ultimaVarredura.get(storeId) ?? 0;
    if (agora - ultima < SWEEP_THROTTLE_MS) return;
  }
  ultimaVarredura.set(storeId, agora);

  try {
    // ── Limpeza de agendamentos herdados ──
    // A versão anterior criava o envio já no preenchimento e cancelava pela
    // SESSÃO. Quando o cliente volta noutra sessão e compra, o cancelamento
    // nunca acontecia — aconteceu com um pedido pago de verdade. Aqui a busca
    // é pelo CONTATO, que é o que sobrevive à troca de sessão.
    const herdados = await query<{ id: string; recoveryEmailId: string; aindaDaTempo: number }>(
      `SELECT ac.id, ac.recoveryEmailId,
              (ac.recoveryEmailAt > NOW(3)) AS aindaDaTempo
         FROM abandoned_carts ac
        WHERE ac.storeId = ? AND ac.recoveryEmailId IS NOT NULL
          AND (ac.status <> 'OPEN' OR EXISTS (
                SELECT 1 FROM orders o
                 WHERE o.storeId = ac.storeId AND o.status IN ('PAID','SHIPPED')
                   AND o.createdAt >= ac.createdAt
                   AND ((ac.email IS NOT NULL AND o.customerEmail = ac.email)
                     OR (ac.phone IS NOT NULL AND o.customerPhone = ac.phone))))
        LIMIT 10`,
      [storeId],
    );
    if (herdados.length) {
      const cfg = await getResendConfig(storeId);
      for (const h of herdados) {
        // Hora marcada já passou = o e-mail saiu; cancelar não desfaz nada.
        // Só limpamos a referência.
        const resolvido = h.aindaDaTempo && cfg
          ? await cancelarNoResend(cfg.apiKey, h.recoveryEmailId)
          : true;
        // A referência só some quando o Resend CONFIRMA. Falha de rede mantém o
        // id na linha para a próxima varredura tentar de novo — antes o id era
        // apagado de qualquer jeito, e por isso nunca soubemos se funcionou.
        if (resolvido) {
          await execute(`UPDATE abandoned_carts SET recoveryEmailId = NULL, updatedAt = updatedAt WHERE id = ?`, [h.id]).catch(() => {});
        }
      }
    }

    // Inteiro já validado em lerTempos, por isso pode entrar direto no SQL.
    const { recovery: espera } = await getEmailTempos(storeId);
    const alvos = await query<{ id: string }>(
      `SELECT ac.id
         FROM abandoned_carts ac
         JOIN store_settings ss ON ss.storeId = ac.storeId
        WHERE ac.storeId = ?
          AND ac.status = 'OPEN'
          AND ac.recoveryEmailAt IS NULL
          AND ac.email IS NOT NULL AND ac.email <> ''
          AND ss.emailRecoveryEnabled = 1 AND ss.resendEnabled = 1
          AND ss.resendApiKeyEnc IS NOT NULL AND ss.resendFromEmail IS NOT NULL
          AND ss.customDomain IS NOT NULL AND ss.domainVerified = 1
          -- MARCO ZERO: só carrinhos nascidos DEPOIS de o lojista ligar a
          -- recuperação. Sem isto, ligar o interruptor dispara e-mail para
          -- todos os carrinhos parados da loja de uma só vez.
          AND ss.emailRecoveryEnabledAt IS NOT NULL
          AND ac.createdAt >= ss.emailRecoveryEnabledAt
          AND ac.updatedAt <= DATE_SUB(NOW(3), INTERVAL ${espera} MINUTE)
          -- Teto de 24h além da espera escolhida: se o envio atrasar (relógio
          -- parado, Resend fora do ar), e-mail velho demais não recupera, só irrita.
          AND ac.updatedAt >= DATE_SUB(NOW(3), INTERVAL ${espera + 1440} MINUTE)
          AND NOT ${COMPROU_DEPOIS_DO_CARRINHO}
        ORDER BY ac.updatedAt ASC
        LIMIT ${SWEEP_LIMIT}`,
      [storeId],
    );

    for (const alvo of alvos) {
      // Reserva ANTES de enviar: duas batidas simultâneas não podem pegar o
      // mesmo carrinho. O UPDATE condicional só deixa uma passar.
      const r = await execute(
        `UPDATE abandoned_carts SET recoveryEmailAt = NOW(3), updatedAt = updatedAt
          WHERE id = ? AND recoveryEmailAt IS NULL`,
        [alvo.id],
      );
      if (r.affectedRows !== 1) continue;

      const envio = await sendAbandonedCartEmail(storeId, alvo.id, { jaReservado: true });
      if (!envio.ok) {
        // Devolve para a fila: o motivo pode ser temporário (Resend fora do ar).
        await execute(`UPDATE abandoned_carts SET recoveryEmailAt = NULL, updatedAt = updatedAt WHERE id = ?`, [alvo.id]).catch(() => {});
        console.error("[recuperação]", alvo.id, envio.error);
      }
    }
  } catch (e) {
    console.error("[sweepCartRecovery]", e instanceof Error ? e.message : e);
  }

  await sweepPixRecovery(storeId).catch(() => {});
}

/**
 * Pix gerado, cliente saiu e não pagou: manda o lembrete com o mesmo código.
 *
 * Roda junto da varredura de carrinho — pela batida de presença e pelo cron de
 * /api/cron/recovery —, com o mesmo marco zero. O relógio aqui é o `createdAt`
 * do PEDIDO: o Pix nasce quando o cliente termina o checkout.
 */
async function sweepPixRecovery(storeId: string): Promise<void> {
  try {
    const { pixrecovery: espera } = await getEmailTempos(storeId);
    const alvos = await query<{ id: string }>(
      `SELECT o.id
         FROM orders o
         JOIN store_settings ss ON ss.storeId = o.storeId
        WHERE o.storeId = ?
          AND o.status = 'PENDING'
          AND o.paymentMethod = 'PIX'
          AND o.pixRecoveryEmailAt IS NULL
          AND o.customerEmail IS NOT NULL AND o.customerEmail <> ''
          AND o.pixQrCode IS NOT NULL AND o.pixQrCode <> ''
          -- Código vencido só tem saída com o link para gerar outro.
          AND (COALESCE(o.pixExpiresAt, DATE_ADD(o.createdAt, INTERVAL 30 MINUTE)) > NOW(3)
               OR (ss.customDomain IS NOT NULL AND ss.domainVerified = 1))
          AND ss.emailPixRecoveryEnabled = 1 AND ss.resendEnabled = 1
          AND ss.resendApiKeyEnc IS NOT NULL AND ss.resendFromEmail IS NOT NULL
          AND ss.emailPixRecoveryEnabledAt IS NOT NULL
          AND o.createdAt >= ss.emailPixRecoveryEnabledAt
          AND o.createdAt <= DATE_SUB(NOW(3), INTERVAL ${espera} MINUTE)
          AND o.createdAt >= DATE_SUB(NOW(3), INTERVAL ${espera + 1440} MINUTE)
        ORDER BY o.createdAt ASC
        LIMIT ${SWEEP_LIMIT}`,
      [storeId],
    );

    for (const alvo of alvos) {
      // Mesma reserva antes do envio: o UPDATE condicional é o que garante um
      // e-mail por pedido mesmo com batidas simultâneas.
      const r = await execute(
        `UPDATE orders SET pixRecoveryEmailAt = NOW(3)
          WHERE id = ? AND pixRecoveryEmailAt IS NULL AND status = 'PENDING'`,
        [alvo.id],
      );
      if (r.affectedRows !== 1) continue;

      const envio = await sendPixRecoveryEmail(storeId, alvo.id);
      if (!envio.ok) {
        await execute(`UPDATE orders SET pixRecoveryEmailAt = NULL WHERE id = ?`, [alvo.id]).catch(() => {});
        console.error("[pix não pago]", alvo.id, envio.error);
      }
    }
  } catch (e) {
    console.error("[sweepPixRecovery]", e instanceof Error ? e.message : e);
  }
}

/** Manda o lembrete de Pix não pago de um pedido. */
export async function sendPixRecoveryEmail(storeId: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getResendConfig(storeId, "pixrecovery");
  if (!cfg) return { ok: false, error: 'Ative "Pix não pago" em E-mails › Configuração.' };

  const rows = await query<OrderRow & { pixQrCode: string | null; vencido: number }>(
    `SELECT ${ORDER_COLS}, pixQrCode, ${PIX_VENCIDO_SQL} FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [orderId, storeId],
  );
  const order = rows[0];
  if (!order) return { ok: false, error: "Pedido não encontrado." };
  // Relê o status: entre a seleção e o envio o cliente pode ter pago.
  if (order.status !== "PENDING") return { ok: false, error: "Este pedido não está mais pendente." };
  if (!order.customerEmail || !order.pixQrCode) return { ok: false, error: "Pedido sem e-mail ou sem código Pix." };

  const items = await loadItems(order.id);
  const payUrl = await orderUrlFor(storeId, order.id, "pix");
  const vencido = Number(order.vencido) === 1;
  if (vencido && !payUrl) return { ok: false, error: SEM_LINK_PARA_RENOVAR };
  const subject = vencido ? `${cfg.storeName}: seu pedido está esperando o pagamento` : `Seu Pix ainda está valendo — ${cfg.storeName}`;
  const html = vencido
    ? htmlPixVencido(cfg.storeName, await branding(storeId), order, items, payUrl!)
    : htmlPixNaoPago(cfg.storeName, await branding(storeId), order, items, order.pixQrCode, payUrl);

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [order.customerEmail], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as any);
      return { ok: false, error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` };
    }
    await logOutbound(storeId, { toAddr: order.customerEmail, subject, htmlBody: html, kind: "pix_recovery" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}

/**
 * Cancela um e-mail que ficou AGENDADO no Resend.
 *
 * A versão anterior criava o envio já no primeiro preenchimento do checkout e
 * dependia deste cancelamento quando o cliente comprava — o que é justamente o
 * que deixou de fazer sentido: quem preenche não abandonou nada, e bastava um
 * cancelamento falhar para quem pagou receber "você deixou algo no carrinho".
 *
 * Hoje nada é agendado, então isto existe só para limpar o que sobrou daquela
 * versão. Continua chamado na conversão do carrinho e some sozinho conforme os
 * agendamentos antigos são cancelados.
 */
export async function cancelCartRecovery(storeId: string, sessionId: string): Promise<void> {
  try {
    const cart = await lerCarrinho(storeId, "sessionId", sessionId);
    if (!cart?.recoveryEmailId) return;

    // Sem `kind`: mesmo com a recuperação desligada depois, o e-mail antigo
    // precisa ser cancelado.
    const cfg = await getResendConfig(storeId);
    // Mesma regra da varredura: o id só sai da linha quando o Resend confirma.
    if (cfg && !(await cancelarNoResend(cfg.apiKey, cart.recoveryEmailId))) return;
    await execute(
      `UPDATE abandoned_carts SET recoveryEmailId = NULL, updatedAt = updatedAt WHERE id = ? AND storeId = ?`,
      [cart.id, storeId],
    );
  } catch (e) {
    console.error("[cancelCartRecovery]", e instanceof Error ? e.message : e);
  }
}

/**
 * Manda o e-mail de recuperação AGORA.
 *
 * Usado pela varredura (que já reservou o carrinho) e pelo botão do painel,
 * quando o lojista quer antecipar.
 */
export async function sendAbandonedCartEmail(
  storeId: string,
  cartId: string,
  opts: { jaReservado?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isEmailKindEnabled(storeId, "recovery"))) {
    return { ok: false, error: 'Ative "Recuperação de carrinho" em E-mails › Configuração para enviar.' };
  }
  const cfg = await getResendConfig(storeId, "recovery");
  if (!cfg) return { ok: false, error: "Configure e ative o Resend em E-mails › Configuração antes de enviar." };

  const cart = await lerCarrinho(storeId, "id", cartId);
  if (!cart) return { ok: false, error: "Carrinho não encontrado." };
  if (!cart.email) return { ok: false, error: "Este carrinho não tem e-mail do cliente." };
  // Já comprou: mandar "você esqueceu algo" para quem pagou é o pior erro
  // possível aqui, então a checagem é no momento do envio, não só na listagem.
  if (cart.status !== "OPEN") return { ok: false, error: "Este carrinho já foi convertido." };
  // Mesma regra da varredura, conferida na hora de sair: entre a escolha do
  // carrinho e o envio o comprador pode ter gerado o Pix noutra aba (já houve caso
  // com 7 segundos de diferença). Vale também para o botão do painel.
  const [ja] = await query<{ comprou: number }>(
    `SELECT ${COMPROU_DEPOIS_DO_CARRINHO} AS comprou FROM abandoned_carts ac WHERE ac.id = ? AND ac.storeId = ? LIMIT 1`,
    [cart.id, storeId],
  );
  if (Number(ja?.comprou) === 1) return { ok: false, error: "Este cliente já fez um pedido depois de abrir este carrinho." };
  // `jaReservado`: a varredura carimbou a data para segurar o lugar, então
  // encontrar data preenchida ali é o esperado, não um envio anterior.
  if (!opts.jaReservado && cart.recoveryEmailAt) {
    return { ok: false, error: "Este carrinho já recebeu o e-mail de recuperação." };
  }

  const montado = await montarRecuperacao(storeId, cfg.storeName, cart);
  if ("erro" in montado) return { ok: false, error: montado.erro };

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [cart.email], subject: montado.subject, html: montado.html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as any);
      return { ok: false, error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` };
    }
    await execute(
      // `updatedAt = updatedAt` PRESERVA o horário: a coluna é `on update
      // CURRENT_TIMESTAMP`, e sem isto registrar o envio contaria como sinal de
      // vida do cliente — o carrinho sumia da lista por mais 15 minutos logo
      // depois de receber o e-mail. Atribuir explicitamente desliga o gatilho.
      `UPDATE abandoned_carts SET recoveryEmailAt = NOW(3), recoveryEmailId = NULL, updatedAt = updatedAt
        WHERE id = ? AND storeId = ?`,
      [cart.id, storeId],
    );
    await logOutbound(storeId, { toAddr: cart.email, subject: montado.subject, htmlBody: montado.html, kind: "cart_recovery" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}

/**
 * Envia um e-mail de TESTE (painel) para validar a configuração do Resend —
 * principalmente a verificação do domínio do remetente. Retorna o erro exato do
 * Resend (ex.: domínio não verificado) para o lojista ver no painel.
 */
export async function sendResendTest(storeId: string, to: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getResendConfig(storeId);
  if (!cfg) return { ok: false, error: "Configure e ative o Resend (API key + remetente) e salve antes de testar." };
  const html = shell({
    store: cfg.storeName,
    ...(await branding(storeId)),
    icon: "check",
    title: "Tudo certo com o seu e-mail",
    subtitle: "Esta é uma mensagem de teste da sua loja.",
    body: `${intro("", "Se você recebeu este e-mail, o envio está configurado corretamente e os avisos de pedido já vão chegar aos seus clientes.")}
      ${note("Este e-mail foi enviado pelo botão de teste no painel e não está ligado a nenhum pedido.")}`,
  });
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [to], subject: `Teste de e-mail — ${cfg.storeName}`, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as any);
      return { ok: false, error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}

/** Modelos que o lojista pode disparar para si mesmo, para conferir o visual. */
export const PREVIEW_KINDS = ["pix", "paid", "separation", "tracking", "recovery", "pixrecovery"] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

export const PREVIEW_LABEL: Record<PreviewKind, string> = {
  pix: "Pix gerado",
  paid: "Pagamento confirmado",
  separation: "Pedido em preparação",
  tracking: "Pedido postado (rastreio)",
  recovery: "Carrinho abandonado",
  pixrecovery: "Pix não pago",
};

/**
 * Envia UM dos modelos com dados de EXEMPLO, para o lojista ver como chega.
 *
 * Os dados são fictícios de propósito: usar um pedido real mandaria nome,
 * e-mail e compras de um cliente para um endereço qualquer digitado no painel.
 */
export async function sendTemplatePreview(storeId: string, to: string, kind: PreviewKind): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getResendConfig(storeId);
  if (!cfg) return { ok: false, error: "Configure e ative o Resend (API key + remetente) e salve antes de enviar." };

  const exemplo: OrderRow = {
    id: "exemplo0-0000-0000-0000-000000000000",
    status: kind === "pix" ? "PENDING" : "PAID",
    totalCents: 15191,
    shippingCents: 0,
    discountCents: 799,
    paidAt: kind === "pix" ? null : new Date(),
    customerName: "Maria de Almeida",
    customerEmail: to,
    paymentMethod: "PIX",
  };
  const itens: EmailItem[] = [
    { name: "Produto de exemplo — este e-mail é um teste", quantity: 1, unitPriceCents: 15990 },
  ];
  const b = await branding(storeId);
  const pixExemplo =
    "00020101021226810014br.gov.bcb.pix2559exemplo-de-codigo-copia-e-cola-para-conferir-o-layout5204000053039865802BR6009SAO PAULO62070503***6304ABCD";

  const html =
    kind === "pix" ? htmlPix(cfg.storeName, b, exemplo, itens, pixExemplo, null)
    : kind === "paid" ? htmlPago(cfg.storeName, b, exemplo, itens, null)
    : kind === "separation" ? htmlSeparacao(cfg.storeName, b, exemplo, itens)
    : kind === "recovery" ? htmlRecuperacao(cfg.storeName, b, "Maria", itens, 15990, null)
    : kind === "pixrecovery" ? htmlPixNaoPago(cfg.storeName, b, exemplo, itens, pixExemplo, null)
    : htmlRastreio(cfg.storeName, b, exemplo, "NM123456789BR");

  const subject = `[Teste] ${PREVIEW_LABEL[kind]} — ${cfg.storeName}`;
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as any);
      return { ok: false, error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha ao enviar." };
  }
}

/**
 * Envia o e-mail de "compra aprovada" ao cliente do pedido. Best-effort — só
 * envia se a loja tiver o Resend configurado/ligado e o pedido tiver e-mail.
 *
 * Devolve o resultado para o reenvio manual (aba E-mails do pedido); o fluxo
 * de pagamento ignora o retorno e segue igual.
 */
export async function sendOrderPaidEmail(storeId: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getResendConfig(storeId, "paid");
    if (!cfg) return { ok: false, error: "Configure e ative o Resend em E-mails › Configuração antes de enviar." };

    const rows = await query<OrderRow>(
      `SELECT ${ORDER_COLS} FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    const order = rows[0];
    if (!order) return { ok: false, error: "Pedido não encontrado." };
    if (!order.customerEmail) return { ok: false, error: "Este pedido não tem e-mail do cliente." };

    const [items, b, url] = await Promise.all([
      loadItems(orderId),
      branding(storeId),
      orderUrlFor(storeId, orderId, "obrigado"),
    ]);
    const subject = `Pagamento confirmado — ${cfg.storeName}`;
    const html = htmlPago(cfg.storeName, b, order, items, url);

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [order.customerEmail], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const corpo = (await res.text().catch(() => "")).slice(0, 300);
      console.error("[resend]", res.status, corpo);
      return { ok: false, error: `Resend respondeu ${res.status}` };
    }
    await logOutbound(storeId, { toAddr: order.customerEmail, subject, htmlBody: html, kind: "order_paid" });
    return { ok: true };
  } catch (e) {
    // E-mail nunca derruba o fluxo de pagamento.
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendOrderPaidEmail]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Envia o e-mail do Pix NA HORA em que ele é gerado, com o copia-e-cola para o
 * cliente pagar. Best-effort — só envia se a loja tem Resend ligado, é Pix, tem
 * e-mail e o copia-e-cola.
 */
export async function sendPixEmail(storeId: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getResendConfig(storeId, "pix");
    if (!cfg) return { ok: false, error: "Configure e ative o Resend em E-mails › Configuração antes de enviar." };

    const rows = await query<OrderRow & { pixQrCode: string | null; vencido: number }>(
      `SELECT ${ORDER_COLS}, pixQrCode, ${PIX_VENCIDO_SQL} FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    const order = rows[0];
    if (!order) return { ok: false, error: "Pedido não encontrado." };
    if (order.paymentMethod !== "PIX" || !order.pixQrCode) return { ok: false, error: "Este pedido não tem Pix gerado." };
    if (!order.customerEmail) return { ok: false, error: "Este pedido não tem e-mail do cliente." };

    // Link da página pública do Pix (onde o botão COPIAR funciona de verdade —
    // e-mail não roda JavaScript). Só com domínio próprio verificado.
    const [items, b, payUrl] = await Promise.all([
      loadItems(orderId),
      branding(storeId),
      orderUrlFor(storeId, orderId, "pix"),
    ]);
    // Com espera configurada, o código pode vencer antes de o e-mail sair.
    const vencido = Number(order.vencido) === 1;
    if (vencido && !payUrl) return { ok: false, error: SEM_LINK_PARA_RENOVAR };
    const subject = vencido ? `${cfg.storeName}: seu pedido está esperando o pagamento` : `Seu Pix foi gerado — ${cfg.storeName}`;
    const html = vencido ? htmlPixVencido(cfg.storeName, b, order, items, payUrl!) : htmlPix(cfg.storeName, b, order, items, order.pixQrCode, payUrl);

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [order.customerEmail], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[pix email]", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return { ok: false, error: `Resend respondeu ${res.status}` };
    }
    await logOutbound(storeId, { toAddr: order.customerEmail, subject, htmlBody: html, kind: "pix_generated" });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendPixEmail]", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Envia o e-mail de "pedido em preparação" agora. O tempo de espera depois da
 * aprovação é decidido em lib/email-agenda. Best-effort.
 */
export async function sendSeparationEmail(storeId: string, orderId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cfg = await getResendConfig(storeId, "separation");
    if (!cfg) return { ok: false, error: "E-mail 'Em preparação' desligado ou Resend não configurado." };
    const rows = await query<OrderRow>(
      `SELECT ${ORDER_COLS} FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    const order = rows[0];
    if (!order) return { ok: false, error: "Pedido não encontrado." };
    if (!order.customerEmail) return { ok: false, error: "O pedido não tem e-mail de cliente." };

    // Sem `orderUrlFor` aqui: este e-mail não tem mais botão, e montar a URL
    // custava uma consulta ao domínio da loja por envio.
    const [items, b] = await Promise.all([loadItems(orderId), branding(storeId)]);
    const subject = `Seu pedido está em preparação — ${cfg.storeName}`;
    const html = htmlSeparacao(cfg.storeName, b, order, items);

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${cfg.storeName} <${cfg.fromEmail}>`, to: [order.customerEmail], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const corpo = (await res.text().catch(() => "")).slice(0, 200);
      console.error("[separacao email]", res.status, corpo);
      // O motivo sobe para quem chamou: no reenvio manual, "falhou" sem motivo
      // não diz se o problema é o e-mail, a chave ou o agendamento.
      return { ok: false, error: `Resend ${res.status}: ${corpo || "sem detalhe"}` };
    }
    await logOutbound(storeId, { toAddr: order.customerEmail, subject, htmlBody: html, kind: "separation" });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendSeparationEmail]", msg);
    return { ok: false, error: msg };
  }
}
