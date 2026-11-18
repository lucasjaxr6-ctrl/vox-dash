import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { sendResendTest, sendTemplatePreview, PREVIEW_KINDS, PREVIEW_LABEL, type PreviewKind } from "@/lib/email";
import { z } from "zod";

const schema = z.object({
  to: z.string().trim().email().max(255),
  // Sem `template`: manda só a mensagem simples de checagem da configuração.
  // Com "all": manda os quatro modelos, um a um.
  template: z.enum([...PREVIEW_KINDS, "all"]).optional(),
});

// POST /api/admin/resend-test -> envia e-mail(s) de teste com a config da loja.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const { to, template } = schema.parse(await req.json());

    if (!template) {
      const r = await sendResendTest(store.id, to);
      if (!r.ok) return json({ error: r.error ?? "Falha ao enviar." }, 400);
      return json({ ok: true, enviados: ["Configuração"] });
    }

    const kinds: PreviewKind[] = template === "all" ? [...PREVIEW_KINDS] : [template];
    const enviados: string[] = [];
    const falhas: string[] = [];
    // Em sequência, não em paralelo: o Resend limita requisições por segundo e
    // disparar os quatro juntos faz alguns voltarem com 429.
    for (const k of kinds) {
      const r = await sendTemplatePreview(store.id, to, k);
      if (r.ok) enviados.push(PREVIEW_LABEL[k]);
      else falhas.push(`${PREVIEW_LABEL[k]}: ${r.error ?? "falhou"}`);
    }

    if (enviados.length === 0) return json({ error: falhas.join(" · ") || "Falha ao enviar." }, 400);
    return json({ ok: true, enviados, falhas });
  } catch (err) {
    return handleError(err);
  }
}
