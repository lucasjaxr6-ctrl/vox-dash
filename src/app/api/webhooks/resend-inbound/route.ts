import crypto from "crypto";
import { json } from "@/lib/http";
import { storeInboundEmail, findStoreByInboundEmail, getInboundSecret, PLATFORM_STORE_ID } from "@/lib/inbound";
import { getResendApiKey } from "@/lib/settings";
import { getPlatformEmailConfig, getPlatformInboundSecret } from "@/lib/platform-email";

// POST /api/webhooks/resend-inbound
// Recebe e-mails do Resend Inbound e grava na caixa de entrada da loja dona do
// endereço destinatário (store_settings.inboundEmail). Sempre responde 2xx.
// Se RESEND_INBOUND_SECRET estiver setado, valida a assinatura Svix do Resend.

function verifySvix(secret: string, id: string, ts: string, sig: string, body: string): boolean {
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return sig.split(" ").some((p) => {
      const s = p.split(",")[1];
      return !!s && s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected));
    });
  } catch {
    return false;
  }
}

function extractEmail(s: string): string {
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}
function parseAddr(v: unknown): { addr: string | null; name: string | null } {
  if (!v) return { addr: null, name: null };
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const addr = (o.email ?? o.address) as string | undefined;
    return { addr: addr ? String(addr).toLowerCase() : null, name: (o.name as string) ?? null };
  }
  const s = String(v);
  const nameM = /^\s*"?([^"<]+?)"?\s*</.exec(s);
  return { addr: extractEmail(s), name: nameM ? nameM[1].trim() : null };
}
function firstAddr(v: unknown): string | null {
  if (!v) return null;
  if (Array.isArray(v)) {
    for (const x of v) { const a = parseAddr(x).addr; if (a) return a; }
    return null;
  }
  return parseAddr(v).addr;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const body = JSON.parse(raw) as Record<string, any>;
    const d = (body?.data ?? body ?? {}) as Record<string, any>;

    // Só e-mail RECEBIDO interessa aqui. Quando o lojista assina todos os
    // eventos no webhook da Resend, chegam também os dos e-mails que a LOJA
    // envia (email.sent, email.delivered, email.opened, email.clicked...),
    // em que o destinatário é o CLIENTE. Cada um caía no "não pertence a
    // nenhuma loja" e enchia o log de erro com o gmail de comprador, vários
    // por e-mail mandado. Não é falha nem e-mail perdido: ignora calado.
    const evento = typeof body?.type === "string" ? body.type : "";
    if (evento && evento !== "email.received") return json({ ok: true, ignorado: evento });

    // Destinatário (a quem foi enviado) — casa com a loja.
    const toAddr = firstAddr(d.to ?? d.to_address ?? d.recipient ?? d.envelope?.to);
    if (!toAddr) {
      // Todo descarte é registrado. Antes o handler devolvia 200 calado em
      // quatro caminhos diferentes, e um e-mail que sumia não deixava rastro
      // nenhum — nem para dizer se a Resend tinha chegado a nos chamar.
      console.error("[resend-inbound] descartado: sem destinatário no payload", {
        evento: body?.type ?? null,
        chaves: Object.keys(d).slice(0, 15),
      });
      return json({ ok: true });
    }

    // Resolve a loja PRIMEIRO (pelo destinatário) — precisamos dela para pegar o
    // signing secret DA LOJA (cada cliente tem o próprio Resend/webhook).
    const storeId = await findStoreByInboundEmail(toAddr);
    if (!storeId) {
      console.error(`[resend-inbound] descartado: ${toAddr} não pertence a nenhuma loja nem à plataforma`);
      return json({ ok: true });
    }

    // A caixa da Vox usa a conta Resend da PLATAFORMA, não a de uma loja — daí
    // o desvio aqui e na busca do corpo mais abaixo.
    const ehPlataforma = storeId === PLATFORM_STORE_ID;

    // Verificação da assinatura Svix com o secret DA LOJA (configurado no painel).
    // NADA de secret global: o env seria de UMA conta só (ex.: Della) e rejeitaria
    // os webhooks das outras lojas. Sem secret configurado -> não verifica (aceita).
    const secret = ehPlataforma ? await getPlatformInboundSecret() : await getInboundSecret(storeId);
    const destino = ehPlataforma ? "plataforma" : `loja ${storeId}`;
    if (secret) {
      const id = req.headers.get("svix-id") ?? "";
      const ts = req.headers.get("svix-timestamp") ?? "";
      const sig = req.headers.get("svix-signature") ?? "";
      if (!verifySvix(secret, id, ts, sig, raw)) {
        // Segredo salvo que não bate com o do endpoint no Resend derruba TODA
        // entrega, sempre em silêncio. Sem esta linha, não há como diferenciar
        // isso de "a Resend nunca nos chamou".
        console.error(
          `[resend-inbound] descartado: assinatura inválida para ${toAddr} (${destino}).` +
            ` Confira o signing secret do endpoint no Resend.`,
          { temSvixId: Boolean(id), temAssinatura: Boolean(sig) },
        );
        return json({ ok: true }); // 200 mesmo assim: forjado não merece retry
      }
    } else {
      console.warn(`[resend-inbound] ${toAddr} (${destino}) sem signing secret — aceito SEM verificação`);
    }

    const from = parseAddr(d.from ?? d.from_address ?? d.sender ?? d.envelope?.from ?? null);

    // ⚠️ O webhook do Resend traz só METADADOS — o corpo (text/html) NÃO vem nele.
    // Buscamos o conteúdo com uma 2ª chamada: GET /emails/receiving/{email_id}.
    const emailId = String(d.email_id ?? d.id ?? d.inbound_email_id ?? "").trim();
    let subject: string | null = d.subject ?? null;
    let textBody: string | null = d.text ?? d.plain ?? d.text_body ?? null;
    let htmlBody: string | null = d.html ?? d.html_body ?? null;

    if (emailId && storeId) {
      const apiKey = ehPlataforma
        ? (await getPlatformEmailConfig())?.apiKey ?? null
        : await getResendApiKey(storeId);
      if (apiKey) {
        try {
          const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) {
            const full = (await r.json()) as Record<string, any>;
            subject = full.subject ?? subject;
            textBody = full.text ?? textBody;
            htmlBody = full.html ?? htmlBody;
          } else {
            console.error("[resend-inbound] buscar conteúdo:", r.status, (await r.text().catch(() => "")).slice(0, 200));
          }
        } catch (e) {
          console.error("[resend-inbound] buscar conteúdo (erro):", e instanceof Error ? e.message : e);
        }
      }
    }

    const stored = await storeInboundEmail({
      toAddr,
      fromAddr: from.addr,
      fromName: from.name,
      subject,
      textBody,
      htmlBody,
      // Guardamos o email_id do Resend (permite re-buscar o conteúdo depois).
      messageId: emailId || d.message_id || d.messageId || d.headers?.["message-id"] || null,
      receivedAt: d.created_at ? new Date(d.created_at) : new Date(),
    });
    console.log(`[resend-inbound] gravado para ${destino}: de ${from.addr} para ${toAddr} (id ${stored})`);
    return json({ ok: true, stored: !!stored });
  } catch (e) {
    // Também era silencioso: JSON malformado ou banco fora sumiam com o e-mail.
    console.error("[resend-inbound] falhou:", e instanceof Error ? e.message : e);
    return json({ ok: true });
  }
}
