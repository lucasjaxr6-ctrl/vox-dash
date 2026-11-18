import crypto from "crypto";
import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { getPushinpayTransactionStatus, normalizePushinpayStatus } from "@/lib/pushinpay";
import { settlePixOrder, NEXT_STATUS } from "@/lib/payments";
import { isGatewayActive, getPushinpayCredentials } from "@/lib/settings";

// POST /api/webhooks/pushinpay
//
// ⚠️ A PushinPay NÃO manda JSON: o corpo vem como FORMULÁRIO
// (`application/x-www-form-urlencoded`). `req.json()` aqui explodiria e todo
// pagamento ficaria sem confirmação — por isso lemos com `req.formData()`.
//
// A MESMA URL recebe três eventos (o corpo não diz qual é; a forma é que diz):
//   • pix_cashin  — Pix RECEBIDO. É o nosso: liquida o pedido.
//   • pix_cashout — Pix ENVIADO (saque da conta do lojista). Não é venda: ignora.
//   • pix_med     — MED/infração (o pagador contestou o Pix). Só registra: uma
//                   infração ABERTA não é estorno, e cancelar aqui derrubaria
//                   uma venda que ainda pode ser defendida.
//
// Autenticação (a doc só oferece isto): quando o lojista configura um token na
// conta da PushinPay, ele vem no header `x-pushinpay-token`. Se a loja tem esse
// token salvo aqui, ele é comparado e o corpo passa a ser confiável. Se NÃO
// tem, não confiamos no corpo: re-consultamos GET /api/transactions/{id} para
// decidir pelo que a API responde — assim um POST forjado nesta URL não marca
// pedido como pago.
//
// Responde 2xx sempre (a doc pede): fora da faixa 2xx eles reenfileiram.
export async function POST(req: Request) {
  try {
    const f = await readForm(req);
    if (!f) {
      console.error("[pushinpay webhook] corpo ilegível");
      return json({ received: true });
    }

    // pix_med traz transaction_id + infraction_id; pix_cashout traz receiver_*.
    if (f.infraction_id || f.status_infraction) {
      console.error(
        `[pushinpay webhook] MED/infração tx=${f.transaction_id ?? "-"} infração=${f.infraction_id ?? "-"} status=${f.status_infraction ?? "-"} valor=${f.value ?? "-"} — verifique no painel da PushinPay`,
      );
      return json({ received: true });
    }
    if (f.receiver_name || f.receiver_national_registration) return json({ received: true }); // saque, não venda

    const txId = (f.id ?? "").trim();
    if (!txId) {
      console.error("[pushinpay webhook] cash-in sem id");
      return json({ received: true });
    }

    const rows = await query<{
      id: string; storeId: string; status: string; totalCents: number; providerTxnId: string | null;
      paymentGateway: string | null; shopifyOrderId: string | null; shopifyDraftId: string | null;
    }>(
      `SELECT id, storeId, status, totalCents, providerTxnId, paymentGateway, shopifyOrderId, shopifyDraftId
         FROM orders WHERE providerTxnId = ? LIMIT 1`,
      [txId],
    );
    const order = rows[0];
    if (!order) {
      console.error(`[pushinpay webhook] pedido não encontrado tx=${txId} status=${f.status ?? "-"}`);
      return json({ received: true });
    }
    if (order.status === "PAID" || order.status === "CANCELLED") return json({ received: true }); // dedupe

    // Só processa se o pedido é DESTE gateway e a loja tem PushinPay ativa.
    if (order.paymentGateway && order.paymentGateway !== "pushinpay") return json({ received: true });
    if (!(await isGatewayActive(order.storeId, "pushinpay"))) return json({ received: true });

    const creds = await getPushinpayCredentials(order.storeId);
    const sentToken = req.headers.get("x-pushinpay-token");

    let raw: string | null;
    if (creds?.webhookToken) {
      // A loja configurou o token: ele é a autenticação. Não bate = forjado.
      if (!sentToken || !safeEquals(sentToken, creds.webhookToken)) {
        console.error(`[pushinpay webhook] x-pushinpay-token inválido pedido=${order.id}`);
        return json({ received: true });
      }
      raw = normalizePushinpayStatus(f.status);
    } else {
      // Sem token configurado, o corpo não vale nada por si só. Antes de gastar
      // uma consulta (a API limita a 1 por minuto por transação), exigimos que o
      // valor do evento bata com o total do pedido — um POST aleatório não passa
      // daqui e não consegue nos fazer martelar a API deles.
      const value = Number(f.value);
      if (!Number.isFinite(value) || Math.round(value) !== order.totalCents) {
        console.error(`[pushinpay webhook] valor divergente pedido=${order.id} evento=${f.value ?? "-"} esperado=${order.totalCents}`);
        return json({ received: true });
      }
      // `force`: isto é um evento da PushinPay, não polling nosso — o freio de
      // 1x/minuto não se aplica e a confirmação precisa sair agora.
      raw = await getPushinpayTransactionStatus(order.storeId, order.providerTxnId || txId, { force: true });
    }

    const next = raw ? NEXT_STATUS[raw] : undefined;
    console.log(`[pushinpay webhook] pedido=${order.id} evento=${f.status ?? "-"} resolvido=${raw ?? "-"}`);
    if (next) await settlePixOrder(order.storeId, order, next);

    return json({ received: true });
  } catch (e) {
    console.error("[pushinpay webhook]", e);
    return json({ received: true });
  }
}

/**
 * Lê o corpo como formulário. Aceita JSON também: se um dia mudarem o
 * Content-Type, o webhook continua funcionando em vez de calar.
 */
async function readForm(req: Request): Promise<Record<string, string> | null> {
  const body = await req.text();
  if (!body) return null;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const j = JSON.parse(body);
      if (!j || typeof j !== "object") return null;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(j)) if (v != null) out[k] = String(v);
      return out;
    } catch {
      return null;
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

/** Comparação de token em tempo constante (não vaza o segredo por timing). */
function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
