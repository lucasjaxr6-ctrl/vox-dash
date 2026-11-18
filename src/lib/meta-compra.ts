import "server-only";
import { createHash } from "node:crypto";
import { query } from "./db";
import { getDomainConfig, getMetaComToken } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// Compra na Meta enviada pelo SERVIDOR (Conversions API).
//
// Pelo navegador, a compra só conta se o cliente chegar à página de obrigado, e
// bloqueador de anúncio a derruba. Daqui ela sai quando o pagamento é confirmado.
//
// Ao contrário do Google Analytics, navegador e servidor enviam JUNTOS: a Meta
// descarta a repetição por event_name + event_id, em até 48 h, e o firePurchase já
// manda o id do pedido como eventID. É o desenho que a própria Meta recomenda.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api/parameters
// Normalização e hash de cada campo: customer-information-parameters.
//
// Versão: a v25.0 era a única da Marketing API sem data para expirar em 11/2026.
// Se aparecer o erro 2635 no log, é ela que venceu: troque aqui.
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH = "https://graph.facebook.com/v25.0";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Nome, cidade e estado: minúsculas, de a a z, sem acento, espaço ou pontuação. */
function letras(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

/** Telefone: só dígitos, sem zero à esquerda e sempre com o código do país. */
function telefone(v: string): string {
  const d = v.replace(/\D/g, "").replace(/^0+/, "");
  return d.length <= 11 ? `55${d}` : d;
}

/** Campo com hash, no formato da API. Vazio some: hash de vazio atrapalha o casamento. */
const comHash = (v: string | null | undefined) => (v ? [sha256(v)] : undefined);

type Pedido = {
  totalCents: number;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  trackingParams: string | null;
};

function lerJson(v: string | null): Record<string, string> {
  try {
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}

/** Dados do comprador: tudo com hash, menos IP, navegador e os cookies do pixel. O CPF não vai. */
function dadosDoCliente(o: Pedido, visita: Record<string, string>) {
  const partes = (o.customerName ?? "").trim().split(/\s+/).filter(Boolean);
  const end = lerJson(o.customerAddress);
  return {
    em: comHash(o.customerEmail?.trim().toLowerCase()),
    ph: comHash(o.customerPhone ? telefone(o.customerPhone) : null),
    fn: comHash(partes[0] ? letras(partes[0]) : null),
    ln: comHash(partes.length > 1 ? letras(partes[partes.length - 1]) : null),
    ct: comHash(end.city ? letras(end.city) : null),
    st: comHash(end.uf ? letras(end.uf) : null),
    zp: comHash(end.cep ? end.cep.replace(/\D/g, "") : null),
    country: comHash("br"),
    client_ip_address: visita.ip || undefined,
    client_user_agent: visita.ua || undefined,
    fbp: visita.fbp || undefined,
    fbc: visita.fbc || undefined,
  };
}

async function postar(pixelId: string, token: string, evento: unknown): Promise<void> {
  // Duas tentativas: uma falha de rede aqui é uma venda a menos para a campanha.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(`${GRAPH}/${encodeURIComponent(pixelId)}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Token no corpo, não na URL: endereço costuma parar em log.
        body: JSON.stringify({ access_token: token, data: [evento] }),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return;
      const d = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string } };
      console.error("[meta-compra] Meta respondeu", res.status, d.error?.code, String(d.error?.message ?? "").slice(0, 200));
      if (res.status < 500) return;
    } catch (e) {
      console.error("[meta-compra]", e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Envia o `Purchase` do pedido para cada pixel da Meta da loja com token. Só deve
 * ser chamada uma vez por pedido (ver settlePixOrder). Best-effort: nunca derruba a
 * confirmação do pagamento.
 */
export async function enviarCompraMeta(storeId: string, orderId: string): Promise<void> {
  try {
    const destinos = await getMetaComToken(storeId);
    if (destinos.length === 0) return;

    const [o] = await query<Pedido>(
      `SELECT totalCents, customerName, customerEmail, customerPhone, customerAddress, trackingParams
         FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    if (!o) return;
    const itens = await query<{ id: string; quantity: number; unitPriceCents: number }>(
      `SELECT oi.productId AS id, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents FROM order_items oi WHERE oi.orderId = ?`,
      [orderId],
    );
    const visita = lerJson(o.trackingParams);
    const { customDomain } = await getDomainConfig(storeId);

    // "website" exige o navegador e o endereço da página. Pedido sem isso (criado
    // antes do token) entra como evento do sistema, em vez de ser recusado.
    const noSite = Boolean(visita.ua && customDomain);
    const evento = {
      event_name: "Purchase",
      event_time: Math.floor(Date.now() / 1000),
      // O mesmo eventID do navegador (firePurchase): é ele que evita contar em dobro.
      event_id: orderId,
      action_source: noSite ? "website" : "system_generated",
      ...(noSite ? { event_source_url: `https://${customDomain}/checkout` } : {}),
      user_data: dadosDoCliente(o, visita),
      custom_data: {
        currency: "BRL",
        value: Number(o.totalCents) / 100,
        order_id: orderId,
        content_type: "product",
        content_ids: itens.map((i) => i.id),
        contents: itens.map((i) => ({ id: i.id, quantity: i.quantity, item_price: i.unitPriceCents / 100 })),
        num_items: itens.reduce((s, i) => s + i.quantity, 0),
      },
    };

    await Promise.all(destinos.map(({ pixelId, token }) => postar(pixelId, token, evento)));
  } catch (e) {
    console.error("[enviarCompraMeta]", e instanceof Error ? e.message : e);
  }
}

/**
 * Motivo de recusar um token novo, ou null. Manda uma lista vazia: a Meta confere o
 * token e devolve erro de parâmetro sem criar evento nenhum. Só recusa quando ela
 * diz com todas as letras que o token não serve; rede fora do ar não impede salvar.
 */
export async function conferirTokenMeta(pixelId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: token, data: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: { code?: number; error_subcode?: number } };
    const codigo = d.error?.code;
    if (codigo === 190) return "A Meta recusou este token. Confira se copiou inteiro, no Gerenciador de Eventos.";
    if (codigo === 10 || codigo === 200 || codigo === 803 || (codigo === 100 && d.error?.error_subcode === 33)) {
      return `Este token não tem acesso ao pixel ${pixelId}. Gere o token no Gerenciador de Eventos, dentro deste pixel.`;
    }
  } catch {
    /* sem resposta: não dá para afirmar nada sobre o token */
  }
  return null;
}
