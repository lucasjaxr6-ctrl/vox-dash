import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { PLATFORM_STORE_ID, markInboundRead } from "@/lib/inbound";
import { getPlatformEmailStatus, sendPlatformEmail } from "@/lib/platform-email";
import { logOutbound } from "@/lib/outbound";

// POST /api/admin/platform/inbox/reply
//
// Responde um e-mail da caixa da Vox. Sai pela conta Resend DA PLATAFORMA —
// responder pelo Resend de uma loja assinaria a mensagem com a marca dela.

const schema = z.object({
  id: z.string().min(1).max(64),
  message: z.string().trim().min(1, "Escreva uma resposta.").max(10000),
});

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { id, message } = schema.parse(await req.json());

    const rows = await query<{ fromAddr: string | null; subject: string | null }>(
      `SELECT fromAddr, subject FROM inbound_emails WHERE id = ? AND storeId = ? LIMIT 1`,
      [id, PLATFORM_STORE_ID],
    );
    const email = rows[0];
    if (!email) return json({ error: "E-mail não encontrado." }, 404);
    if (!email.fromAddr) return json({ error: "Este e-mail não tem remetente para responder." }, 400);

    const base = (email.subject || "").trim();
    const subject = /^re:/i.test(base) ? base : `Re: ${base || "sua mensagem"}`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${esc(message)}</div>`;

    // A resposta da pessoa tem que voltar para a CAIXA, não para o remetente
    // configurado (que pode ser um noreply). Sem endereço de caixa, o Resend
    // usa o próprio remetente.
    const { inboundEmail } = await getPlatformEmailStatus();
    const r = await sendPlatformEmail({
      to: email.fromAddr,
      subject,
      html,
      text: message,
      replyTo: inboundEmail || undefined,
    });
    if (!r.ok) return json({ error: r.error ?? "Falha ao enviar." }, 400);

    await markInboundRead(PLATFORM_STORE_ID, id);
    await logOutbound(PLATFORM_STORE_ID, {
      toAddr: email.fromAddr,
      subject,
      htmlBody: html,
      textBody: message,
      kind: "reply",
      resendId: r.id ?? null,
    });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
