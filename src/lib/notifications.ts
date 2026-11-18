import "server-only";
import { query } from "./db";
import { getWebhooksForEvent, WEBHOOK_EVENT_LABEL, type WebhookEvent, type StoredWebhook } from "./settings";

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * POST no webhook. O corpo tem `title`/`text` no topo (apps de notificação usam
 * isso direto) E os dados estruturados do evento, para integrações de
 * verdade. O token vai no header, para o destino confirmar que a
 * chamada partiu da loja.
 * Best-effort com timeout curto — nunca lança.
 */
export async function sendWebhookNotification(
  url: string,
  payload: Record<string, unknown> & { title: string; text: string },
  opts?: { token?: string; event?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts?.token ? { "X-Webhook-Token": opts.token } : {}),
        ...(opts?.event ? { "X-Webhook-Event": opts.event } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha na requisição" };
  }
}

async function dispatch(
  hooks: StoredWebhook[],
  event: WebhookEvent,
  payload: Record<string, unknown> & { title: string; text: string },
) {
  await Promise.allSettled(
    hooks.map((h) => sendWebhookNotification(h.url, { event, ...payload }, { token: h.token, event })),
  );
}

const TITLE: Record<WebhookEvent, string> = {
  order_created: "🧾",
  order_paid: "✅",
  order_refused: "❌",
  cart_abandoned: "🛒",
  pix_generated: "⚡",
  boleto_generated: "🧾",
};

/**
 * Dispara os webhooks de um evento ligado a um PEDIDO. Best-effort: nunca
 * derruba o fluxo de pagamento. A idempotência (uma vez por transição) é
 * garantida pelo chamador.
 */
export async function notifySale(storeId: string, orderId: string, event: WebhookEvent): Promise<void> {
  try {
    const hooks = await getWebhooksForEvent(storeId, event);
    if (hooks.length === 0) return;

    const rows = await query<{
      totalCents: number; status: string; paymentMethod: string | null;
      customerName: string | null; customerEmail: string | null; customerPhone: string | null;
    }>(
      `SELECT totalCents, status, paymentMethod, customerName, customerEmail, customerPhone
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    const o = rows[0];
    if (!o) return;

    const name = o.customerName || "Cliente";
    const method = o.paymentMethod === "CREDIT_CARD" ? "cartão" : "Pix";
    const short = orderId.slice(0, 8).toUpperCase();

    const text =
      event === "order_paid"
        ? `${name} pagou via ${method}. Pedido ${short}.`
        : event === "order_refused"
          ? `O pagamento de ${name} foi recusado. Pedido ${short}.`
          : event === "pix_generated"
            ? `${name} gerou o Pix e ainda não pagou. Pedido ${short}.`
            : event === "boleto_generated"
              ? `${name} gerou o boleto. Pedido ${short}.`
              : `${name} iniciou um pedido via ${method}. Pedido ${short}.`;

    await dispatch(hooks, event, {
      title: `${TITLE[event]} ${WEBHOOK_EVENT_LABEL[event]} — ${brl(o.totalCents)}`,
      text,
      occurredAt: new Date().toISOString(),
      order: {
        id: orderId,
        status: o.status,
        totalCents: o.totalCents,
        paymentMethod: o.paymentMethod,
        customer: { name: o.customerName, email: o.customerEmail, phone: o.customerPhone },
      },
    });
  } catch {
    /* notificação nunca derruba o pagamento */
  }
}

/**
 * Dispara os webhooks de carrinho abandonado. Acontece quando o cliente deixa os
 * dados no checkout sem concluir — é o mesmo registro que alimenta a tela de
 * recuperação. Chamado só na CRIAÇÃO do lead, não a cada tecla digitada.
 */
export async function notifyCartAbandoned(
  storeId: string,
  cart: { id: string; name?: string | null; email?: string | null; phone?: string | null; totalCents?: number | null },
): Promise<void> {
  try {
    const hooks = await getWebhooksForEvent(storeId, "cart_abandoned");
    if (hooks.length === 0) return;
    const name = cart.name || "Cliente";
    const total = Number(cart.totalCents ?? 0);
    await dispatch(hooks, "cart_abandoned", {
      title: `🛒 Carrinho abandonado${total > 0 ? ` — ${brl(total)}` : ""}`,
      text: `${name} preencheu os dados e não concluiu a compra.`,
      occurredAt: new Date().toISOString(),
      cart: { id: cart.id, totalCents: total, customer: { name: cart.name, email: cart.email, phone: cart.phone } },
    });
  } catch {
    /* nunca derruba o checkout */
  }
}
