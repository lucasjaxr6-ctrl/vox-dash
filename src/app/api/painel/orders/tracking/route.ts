import { requireStore } from "@/lib/stores";
import { query, execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { dispararEmail } from "@/lib/email-agenda";
import { z } from "zod";

const schema = z.object({
  orderId: z.string().min(1).max(64),
  trackingCode: z.string().trim().min(3, "Informe o código de rastreio").max(120),
});

// POST /api/painel/orders/tracking -> salva o código de rastreio, marca o pedido
// como ENVIADO e envia o e-mail ao cliente. Só age em pedidos da loja ativa.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const { orderId, trackingCode } = schema.parse(await req.json());

    const rows = await query<{ id: string; status: string; providerTxnId: string | null; paymentGateway: string | null }>(
      `SELECT id, status, providerTxnId, paymentGateway FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, store.id],
    );
    const order = rows[0];
    if (!order) return json({ error: "Pedido não encontrado." }, 404);
    if (order.status !== "PAID" && order.status !== "SHIPPED") {
      return json({ error: "Só é possível enviar rastreio de pedidos pagos." }, 400);
    }

    // Envia o e-mail ANTES de persistir o status, para não marcar como enviado se
    // o e-mail falhar (ex.: Resend não configurado / domínio não verificado). Com
    // espera configurada ele só entra na fila, depois de conferir a configuração.
    const result = await dispararEmail(store.id, orderId, "tracking", trackingCode);
    if (!result.ok) return json({ error: result.error ?? "Falha ao enviar o e-mail." }, 400);

    await execute(
      `UPDATE orders SET trackingCode = ?, status = 'SHIPPED' WHERE id = ? AND storeId = ?`,
      [trackingCode, orderId, store.id],
    );

    // Grava o rastreio no gateway que PROCESSOU o pedido (fonte da verdade:
    // paymentGateway). Best-effort — não derruba o envio do e-mail.
    const { pushGatewayTracking } = await import("@/lib/payments");
    await pushGatewayTracking(store.id, order, trackingCode);

    // Abre a remessa e pede ao provedor que comece a acompanhar. Registrar no
    // DESPACHO (e não na primeira visita do cliente) faz os eventos já estarem
    // lá quando ele abrir o link do e-mail. Best-effort: falhar aqui não pode
    // impedir o despacho, e a página registra de novo se precisar.
    await execute(`INSERT IGNORE INTO tracking_shipments (trackingCode, storeId) VALUES (?, ?)`, [
      trackingCode,
      store.id,
    ]);
    const { registrarCodigo } = await import("@/lib/track17");
    await registrarCodigo(trackingCode);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
