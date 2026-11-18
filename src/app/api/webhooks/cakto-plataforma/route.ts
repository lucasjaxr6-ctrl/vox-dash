import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { consultarStatusCobranca, quitarCobranca } from "@/lib/platform-fees";
import { ativarPlanoPago } from "@/lib/plan-billing";
import { origemDoWebhookCakto, PREFIXO_TXN_CAKTO } from "@/lib/cakto-plataforma";

// POST /api/webhooks/cakto-plataforma
//
// Pix da PLATAFORMA (taxas e planos) na conta Cakto da VOX. Um endpoint só
// para os dois: o webhook é cadastrado uma vez no Painel Cakto, e a cobrança
// diz sozinha de qual contabilidade é (está em platform_fee_charges OU em
// plan_charges). Nada aqui toca em pedido de comprador.
//
// Corpo: { secret, event, data }. Só `purchase_approved` importa. A origem é
// conferida pela assinatura (o secret vem da própria API da Cakto), mas o
// corpo nunca decide nada: a palavra final é o GET do pedido com a nossa
// credencial. O webhook é cadastrado sozinho na primeira cobrança.
//
// ⚠️ Responder 2xx SEMPRE: a Cakto não reenvia quando a resposta é erro
// (só quando a entrega nem chega). Um 500 aqui perderia o aviso de vez; as
// telas de cobrança conferem sozinhas, mas com atraso.
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const body = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();

    if ((await origemDoWebhookCakto(raw, req.headers, body)) === false) {
      console.error("[cakto plataforma webhook] origem não confere; ignorado");
      return json({ received: true });
    }

    const evento = String(body?.event ?? "");
    if (evento !== "purchase_approved") return json({ received: true });
    // Webhook V1 manda `data` como objeto; o V2 (criado só pelo painel deles)
    // manda uma LISTA com todos os pedidos da cobrança. Aceita os dois.
    const pedidos: any[] = Array.isArray(body?.data) ? body.data : [body?.data];
    for (const p of pedidos) {
      const id = String(p?.id ?? "").trim();
      if (id) await processarPedido(id);
    }
    return json({ received: true });
  } catch (e) {
    console.error("[cakto plataforma webhook]", e instanceof Error ? e.message : e);
    return json({ received: true });
  }
}

/** Quita a taxa ou ativa o plano de um pedido Cakto, se ele for cobrança nossa e estiver pago. */
async function processarPedido(id: string): Promise<void> {
  const txnId = `${PREFIXO_TXN_CAKTO}${id}`;
  const [taxa] = await query<{ status: string }>(`SELECT status FROM platform_fee_charges WHERE txnId = ? LIMIT 1`, [txnId]);
  const [plano] = taxa
    ? []
    : await query<{ status: string }>(`SELECT status FROM plan_charges WHERE txnId = ? LIMIT 1`, [txnId]);
  if (!taxa && !plano) {
    // Venda da conta Cakto que não é cobrança nossa (alguém pagou pelo link
    // público de uma oferta, por exemplo): não há o que fazer aqui.
    console.log(`[cakto plataforma webhook] pedido ${id} não é cobrança da plataforma`);
    return;
  }
  if ((taxa ?? plano)!.status === "PAID") return;

  const pago = await consultarStatusCobranca(txnId);
  if (pago !== "paid") {
    console.log(`[cakto plataforma webhook] pedido ${id} ainda não pago (status=${pago ?? "?"})`);
    return;
  }

  if (taxa) {
    const r = await quitarCobranca(txnId);
    console.log(`[cakto plataforma webhook] taxa ${id} quitada=${r.ok} taxas=${r.taxas}`);
  } else {
    const ativou = await ativarPlanoPago(txnId);
    console.log(`[cakto plataforma webhook] plano ${id} ativado=${ativou}`);
  }
}
