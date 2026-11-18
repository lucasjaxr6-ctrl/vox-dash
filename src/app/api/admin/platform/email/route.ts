import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, handleError } from "@/lib/http";
import { getPlatformEmailStatus, savePlatformEmail, sendPlatformEmail } from "@/lib/platform-email";
import { logOutbound } from "@/lib/outbound";
import { PLATFORM_STORE_ID } from "@/lib/inbound";

// GET/PUT/POST /api/admin/platform/email
//
// E-mail da PLATAFORMA (Vox). O GET nunca devolve a chave — só se existe.
// O POST manda um teste, porque "salvou" não é o mesmo que "funciona": domínio
// não verificado no Resend só aparece na hora do envio.

const schema = z.object({
  // Ausente = mantém a chave salva; "" = remove.
  apiKey: z.string().trim().max(200).optional(),
  fromEmail: z.union([z.literal(""), z.string().trim().email().max(254)]).optional(),
  fromName: z.string().trim().max(120).optional(),
  // Endereço onde a Vox RECEBE (caixa de entrada do admin). "" limpa.
  inboundEmail: z.union([z.literal(""), z.string().trim().email().max(320)]).optional(),
  // Signing secret do webhook Inbound. Em branco mantém o salvo.
  inboundSecret: z.string().trim().max(200).optional(),
});

export async function GET() {
  try {
    await requireAdmin();
    return json(await getPlatformEmailStatus());
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const input = schema.parse(await req.json());
    await savePlatformEmail(input);
    return json({ ok: true, ...(await getPlatformEmailStatus()) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    // `requireAdmin` devolve o usuário direto, não um envelope.
    const admin = await requireAdmin();
    const body = await req.json().catch(() => ({}));
    const para = typeof body?.to === "string" && body.to.trim() ? body.to.trim() : admin.email;
    if (!para) return json({ error: "Informe um destinatário." }, 400);

    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:24px">
        <h2 style="margin:0 0 8px">Funcionou.</h2>
        <p style="margin:0;color:#475467">
          Este e-mail saiu da configuração da plataforma no painel admin.
          Se você está lendo isto, o remetente e o domínio estão verificados no Resend.
        </p>
      </div>`;
    const r = await sendPlatformEmail({ to: para, subject: "Teste de e-mail da Vox", html });
    if (!r.ok) return json({ error: r.error ?? "Falha ao enviar." }, 400);
    // Registra na aba Enviados — o teste é o primeiro e-mail que sai da Vox, e
    // é bom ele aparecer lá para conferir que a caixa está funcionando.
    await logOutbound(PLATFORM_STORE_ID, {
      toAddr: para,
      subject: "Teste de e-mail da Vox",
      htmlBody: html,
      kind: "test",
      resendId: r.id ?? null,
    });
    return json({ ok: true, to: para, id: r.id });
  } catch (err) {
    return handleError(err);
  }
}
