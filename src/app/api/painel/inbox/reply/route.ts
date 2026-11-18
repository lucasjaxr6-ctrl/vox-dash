import { requireStore } from "@/lib/stores";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { getResendConfig } from "@/lib/settings";
import { getInboundAddress, markInboundRead } from "@/lib/inbound";
import { logOutbound } from "@/lib/outbound";
import { z } from "zod";

const RESEND_API = "https://api.resend.com/emails";
const schema = z.object({
  id: z.string().min(1).max(64),
  message: z.string().trim().min(1, "Escreva uma resposta.").max(10000),
});

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// POST /api/painel/inbox/reply -> responde um e-mail recebido, enviando via Resend
// a partir do endereço da loja para o remetente original. Marca como lido.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const { id, message } = schema.parse(await req.json());

    const rows = await query<{ fromAddr: string | null; toAddr: string | null; subject: string | null }>(
      `SELECT fromAddr, toAddr, subject FROM inbound_emails WHERE id = ? AND storeId = ? LIMIT 1`,
      [id, store.id],
    );
    const email = rows[0];
    if (!email) return json({ error: "E-mail não encontrado." }, 404);
    if (!email.fromAddr) return json({ error: "Este e-mail não tem remetente para responder." }, 400);

    const cfg = await getResendConfig(store.id);
    if (!cfg) return json({ error: "Configure e ative o Resend em E-mails › Configuração antes de responder." }, 400);

    // Envia a partir do endereço de suporte da loja (o configurado na caixa) —
    // nunca do noreply — para as respostas do cliente voltarem à caixa.
    const inbound = await getInboundAddress(store.id);
    const fromAddr = inbound || cfg.fromEmail;

    const baseSubject = (email.subject || "").trim();
    const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject || "sua mensagem"}`;
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#374151;line-height:1.6;white-space:pre-wrap;">${esc(message)}</div>`;

    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${cfg.storeName} <${fromAddr}>`,
        to: [email.fromAddr],
        reply_to: fromAddr,
        subject,
        text: message,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as any));
      return json({ error: body?.message || body?.error?.message || `Resend respondeu ${res.status}` }, 400);
    }

    await markInboundRead(store.id, id);
    await logOutbound(store.id, { toAddr: email.fromAddr, subject, htmlBody: html, textBody: message, kind: "reply" });
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
