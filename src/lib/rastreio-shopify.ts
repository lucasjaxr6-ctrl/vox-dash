import "server-only";
import { query, execute } from "./db";
import { shopifyAdminFetch } from "./shopify";

// ─────────────────────────────────────────────────────────────────────────────
// Código de rastreio que vem da SHOPIFY (o lojista, ou um app dele, lança o
// rastreio no pedido lá). Dois caminhos trazem o código para cá:
//
//   1. webhook orders/updated (/api/webhooks/shopify) — o caminho rápido;
//   2. sincronização periódica (/api/cron/shopify-rastreio) — a rede de
//      segurança: pergunta à Shopify pelos pedidos pagos que ainda estão sem
//      rastreio aqui. Webhook é otimização; a consulta periódica é garantia
//      (mesma regra da conciliação de pagamentos).
//
// Caso real que motivou isto (Elvora Decor, 21/10/2026): ~70 pedidos com
// rastreio na Shopify e nenhum aqui. O webhook só gravava o código DEPOIS que
// o e-mail "Pedido postado" saía; qualquer falha do e-mail (o Resend recusa
// acima de 2 envios por segundo, e lançar rastreio em lote dispara dezenas de
// webhooks juntos) descartava o código — e não havia segunda tentativa.
//
// Agora o código é gravado PRIMEIRO; o e-mail é aviso, e falhar nele não leva
// o rastreio junto. (O envio manual pelo painel continua mandando o e-mail
// antes de gravar: lá o lojista vê o erro na hora e decide.)
// ─────────────────────────────────────────────────────────────────────────────

type Fulfillment = {
  tracking_number?: string | null;
  tracking_numbers?: (string | null)[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RastreioShopify = { codigo: string; lancadoEm: Date | null };

/**
 * Último código de rastreio de um pedido da Shopify (payload do webhook ou da
 * Admin API) e quando ele foi lançado. Null se o pedido não tem rastreio.
 */
export function rastreioDaShopify(pedido: { fulfillments?: unknown }): RastreioShopify | null {
  let achado: RastreioShopify | null = null;
  const lista = Array.isArray(pedido?.fulfillments) ? (pedido.fulfillments as Fulfillment[]) : [];
  for (const f of lista) {
    const bruto = f?.tracking_number || (Array.isArray(f?.tracking_numbers) ? f.tracking_numbers.find(Boolean) : "") || "";
    const codigo = String(bruto).trim();
    if (!codigo) continue;
    const quando = f.updated_at || f.created_at;
    achado = { codigo, lancadoEm: quando ? new Date(quando) : null };
  }
  return achado;
}

export type PedidoParaRastreio = {
  id: string;
  status: string;
  trackingCode: string | null;
  providerTxnId: string | null;
  paymentGateway: string | null;
};

/**
 * O Resend recusa acima de 2 envios por segundo ("Too many requests"). Com
 * rastreio lançado em lote, vários webhooks chegam juntos: em vez de perder o
 * aviso, espera e tenta de novo, no máximo duas vezes.
 */
async function enviarAvisoComFolga(storeId: string, orderId: string, codigo: string) {
  const { dispararEmail } = await import("./email-agenda");
  for (let tentativa = 0; ; tentativa++) {
    const r = await dispararEmail(storeId, orderId, "tracking", codigo);
    if (r.ok || tentativa >= 2 || !/too many|rate.?limit|429/i.test(r.error ?? "")) return r;
    await new Promise((ok) => setTimeout(ok, 1200 * (tentativa + 1)));
  }
}

/**
 * Aplica um código de rastreio vindo da Shopify: grava no pedido e marca como
 * ENVIADO; depois, best-effort, avisa o cliente, informa o gateway e registra
 * no 17TRACK. Idempotente: o UPDATE só passa se o código for NOVO para este
 * pedido, então webhook e sincronização ao mesmo tempo não mandam dois e-mails.
 */
export async function aplicarRastreioDaShopify(
  storeId: string,
  pedido: PedidoParaRastreio,
  codigo: string,
  { avisarCliente }: { avisarCliente: boolean },
): Promise<{ aplicado: boolean; avisado: boolean; erroAviso?: string }> {
  if (pedido.status !== "PAID" && pedido.status !== "SHIPPED") return { aplicado: false, avisado: false };
  if (pedido.trackingCode === codigo) return { aplicado: false, avisado: false };

  const r = await execute(
    `UPDATE orders SET trackingCode = ?, status = 'SHIPPED'
      WHERE id = ? AND storeId = ? AND status IN ('PAID', 'SHIPPED')
        AND (trackingCode IS NULL OR trackingCode <> ?)`,
    [codigo, pedido.id, storeId, codigo],
  );
  if (r.affectedRows === 0) return { aplicado: false, avisado: false };

  let avisado = false;
  let erroAviso: string | undefined;
  if (avisarCliente) {
    const e = await enviarAvisoComFolga(storeId, pedido.id, codigo);
    avisado = e.ok;
    if (!e.ok) {
      erroAviso = e.error;
      console.error(`[rastreio shopify] código gravado, e-mail não saiu (pedido ${pedido.id}):`, e.error);
    }
  }

  // Gateway que PROCESSOU o pedido (Appmax libera saques; HyperCash atualiza a entrega).
  try {
    const { pushGatewayTracking } = await import("./payments");
    await pushGatewayTracking(storeId, pedido, codigo);
  } catch (e) {
    console.error("[rastreio shopify] gateway:", e instanceof Error ? e.message : e);
  }

  // Abre a remessa no 17TRACK já no despacho, como o envio manual faz: os
  // eventos já estão lá quando o cliente abre o link do e-mail.
  try {
    await execute(`INSERT IGNORE INTO tracking_shipments (trackingCode, storeId) VALUES (?, ?)`, [codigo, storeId]);
    const { registrarCodigo } = await import("./track17");
    await registrarCodigo(codigo);
  } catch (e) {
    console.error("[rastreio shopify] 17TRACK:", e instanceof Error ? e.message : e);
  }

  return { aplicado: true, avisado, erroAviso };
}

/** Pedidos pagos sem rastreio que ainda valem a consulta. */
const JANELA_DIAS = 45;
/**
 * Só avisa o cliente se o rastreio foi lançado na Shopify há pouco. Um código
 * antigo que escapou do webhook é gravado em silêncio: um "seu pedido foi
 * postado" semanas depois da postagem confunde mais do que ajuda.
 */
const AVISO_ATE_DIAS = 7;
/** A Admin API aceita até 250 ids por consulta. */
const IDS_POR_CONSULTA = 250;
/** Teto por rodada (cabe no limite de 60 s do cron); o resto fica para a próxima. */
const MAX_APLICADOS_POR_RODADA = 40;
/** Folga entre e-mails: o Resend aceita 2 por segundo. */
const FOLGA_ENTRE_EMAILS_MS = 600;

/**
 * Rede de segurança: para cada loja, pergunta à Shopify pelos pedidos pagos
 * que ainda estão sem rastreio aqui e aplica os que já têm código lá.
 */
export async function sincronizarRastreiosDaShopify(): Promise<{
  lojas: number;
  consultados: number;
  aplicados: number;
  avisados: number;
  erros: string[];
}> {
  const pendentes = await query<PedidoParaRastreio & { storeId: string; shopifyOrderId: string; pagoEm: Date }>(
    `SELECT id, storeId, status, trackingCode, providerTxnId, paymentGateway, shopifyOrderId,
            COALESCE(paidAt, createdAt) AS pagoEm
       FROM orders
      WHERE status = 'PAID' AND shopifyOrderId IS NOT NULL
        AND (trackingCode IS NULL OR trackingCode = '')
        AND COALESCE(paidAt, createdAt) >= NOW(3) - INTERVAL ${JANELA_DIAS} DAY
      -- Mais recentes primeiro: lojas que nunca lançam rastreio na Shopify
      -- acumulam pedidos pagos sem código, e não podem empurrar os novos para
      -- fora do limite.
      ORDER BY pagoEm DESC
      LIMIT 2000`,
  );

  const porLoja = new Map<string, Map<string, PedidoParaRastreio>>();
  for (const p of pendentes) {
    if (!porLoja.has(p.storeId)) porLoja.set(p.storeId, new Map());
    porLoja.get(p.storeId)!.set(String(p.shopifyOrderId), p);
  }

  const limiteAviso = Date.now() - AVISO_ATE_DIAS * 86_400_000;
  let consultados = 0;
  let aplicados = 0;
  let avisados = 0;
  const erros: string[] = [];

  for (const [storeId, pedidos] of porLoja) {
    const ids = [...pedidos.keys()];
    for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
      if (aplicados >= MAX_APLICADOS_POR_RODADA) break;
      const lote = ids.slice(i, i + IDS_POR_CONSULTA);
      let encontrados: { id: number | string; fulfillments?: unknown }[] = [];
      try {
        // status=any: pedido atendido costuma ser arquivado na Shopify, e sem
        // isso a consulta só devolveria os abertos.
        const res = await shopifyAdminFetch(
          storeId,
          `orders.json?ids=${lote.join(",")}&status=any&limit=${IDS_POR_CONSULTA}&fields=id,fulfillments`,
        );
        if (!res.ok) {
          erros.push(`loja ${storeId}: Shopify respondeu ${res.status}`);
          break;
        }
        const data = await res.json();
        encontrados = Array.isArray(data?.orders) ? data.orders : [];
      } catch (e) {
        erros.push(`loja ${storeId}: ${e instanceof Error ? e.message : "falha na consulta"}`);
        break;
      }
      consultados += lote.length;

      for (const o of encontrados) {
        if (aplicados >= MAX_APLICADOS_POR_RODADA) break;
        const pedido = pedidos.get(String(o.id));
        const rastreio = rastreioDaShopify(o);
        if (!pedido || !rastreio) continue;
        const avisarCliente = !!rastreio.lancadoEm && rastreio.lancadoEm.getTime() >= limiteAviso;
        try {
          const r = await aplicarRastreioDaShopify(storeId, pedido, rastreio.codigo, { avisarCliente });
          if (!r.aplicado) continue;
          aplicados++;
          if (r.avisado) avisados++;
          if (avisarCliente) await new Promise((ok) => setTimeout(ok, FOLGA_ENTRE_EMAILS_MS));
        } catch (e) {
          erros.push(`pedido ${pedido.id}: ${e instanceof Error ? e.message : "falha ao aplicar"}`);
        }
      }
    }
  }

  return { lojas: porLoja.size, consultados, aplicados, avisados, erros };
}
