import "server-only";
import { query } from "./db";
import { getUtmifyToken } from "./settings";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Utmify (rastreamento/atribuição de vendas). Enviamos o pedido nos
// eventos do funil: waiting_payment (gerado) e paid (pago). A Utmify usa as UTMs
// capturadas no checkout para atribuir a venda à campanha. Best-effort: nunca
// derruba o fluxo de pagamento.
// Docs: POST https://api.utmify.com.br/api-credentials/orders (header x-api-token)
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.utmify.com.br/api-credentials/orders";

export type UtmifyStatus = "waiting_payment" | "paid" | "refused" | "refunded" | "chargedback";

/** Formata uma data para "YYYY-MM-DD HH:MM:SS" em UTC (formato exigido pela Utmify). */
function fmtUtc(d: Date | string | null): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Envia (ou atualiza) um pedido na Utmify. Só envia se a loja tiver a Utmify
 * ligada E o pedido tiver e-mail do comprador (a Utmify exige um cliente
 * identificado). Idempotente do lado da Utmify: reenviar o mesmo orderId com
 * outro status atualiza o registro.
 */
export async function sendUtmifyOrder(storeId: string, orderId: string, status: UtmifyStatus): Promise<void> {
  try {
    const token = await getUtmifyToken(storeId);
    if (!token) return;

    const rows = await query<{
      id: string; totalCents: number; customerName: string | null; customerEmail: string | null;
      customerPhone: string | null; customerDocument: string | null; paymentMethod: string | null;
      createdAt: Date; trackingParams: string | null;
    }>(
      `SELECT id, totalCents, customerName, customerEmail, customerPhone, customerDocument,
              paymentMethod, createdAt, trackingParams
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    const o = rows[0];
    if (!o || !o.customerEmail) return; // sem comprador identificado a Utmify recusa

    const items = await query<{ id: string; name: string; quantity: number; unitPriceCents: number }>(
      `SELECT p.id AS id, p.name AS name, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents
       FROM order_items oi JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`,
      [orderId],
    );

    let tp: Record<string, string> = {};
    try {
      tp = o.trackingParams ? JSON.parse(o.trackingParams) : {};
    } catch {
      /* json inválido → sem UTMs */
    }

    const body = {
      orderId: o.id,
      platform: "VoxPay",
      paymentMethod: o.paymentMethod === "CREDIT_CARD" ? "credit_card" : "pix",
      status,
      createdAt: fmtUtc(o.createdAt),
      approvedDate: status === "paid" ? fmtUtc(new Date()) : null,
      refundedAt: status === "refunded" ? fmtUtc(new Date()) : null,
      customer: {
        name: o.customerName || "Cliente",
        email: o.customerEmail,
        phone: o.customerPhone || null,
        document: o.customerDocument || null,
        country: "BR",
        ip: tp.ip || "",
      },
      products: items.map((it) => ({
        id: it.id,
        name: it.name,
        planId: null,
        planName: null,
        quantity: it.quantity,
        priceInCents: it.unitPriceCents,
      })),
      trackingParameters: {
        src: tp.src ?? null,
        sck: tp.sck ?? null,
        utm_source: tp.utm_source ?? null,
        utm_campaign: tp.utm_campaign ?? null,
        utm_medium: tp.utm_medium ?? null,
        utm_content: tp.utm_content ?? null,
        utm_term: tp.utm_term ?? null,
      },
      commission: {
        totalPriceInCents: o.totalCents,
        gatewayFeeInCents: 0,
        userCommissionInCents: o.totalCents,
        currency: "BRL",
      },
      isTest: false,
    };

    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[utmify]", res.status, (await res.text().catch(() => "")).slice(0, 300));
    }
  } catch (e) {
    console.error("[sendUtmifyOrder]", e instanceof Error ? e.message : e);
  }
}

/** Monta o JSON de tracking a ser gravado no pedido (UTMs do cliente + IP real). */
export function buildTrackingParams(
  tracking: Record<string, string | null | undefined> | undefined,
  ip: string | null,
): string | null {
  const out: Record<string, string> = {};
  if (tracking) {
    for (const [k, v] of Object.entries(tracking)) {
      if (v) out[k] = String(v).slice(0, 255);
    }
  }
  if (ip) out.ip = ip;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
