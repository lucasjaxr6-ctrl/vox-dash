import "server-only";
import { query, execute, newId } from "./db";
import { escaparLike } from "./inbound";

// ─────────────────────────────────────────────────────────────────────────────
// E-mails ENVIADOS pela loja (confirmação, rastreio, separação, recuperação,
// respostas). Registramos cada envio para exibir na aba "Enviados" da caixa.
// ─────────────────────────────────────────────────────────────────────────────

export type OutboundEmail = {
  id: string;
  toAddr: string | null;
  subject: string | null;
  htmlBody: string | null;
  textBody: string | null;
  kind: string | null;
  createdAt: Date;
};

/** Registra um e-mail enviado. Best-effort — nunca lança (não derruba o envio). */
export async function logOutbound(
  storeId: string,
  input: { toAddr: string | null; subject: string | null; htmlBody?: string | null; textBody?: string | null; kind?: string; resendId?: string | null },
): Promise<void> {
  try {
    await execute(
      `INSERT INTO outbound_emails (id, storeId, toAddr, subject, htmlBody, textBody, kind, resendId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(), storeId,
        (input.toAddr || "").slice(0, 320) || null,
        (input.subject || "").slice(0, 500) || null,
        input.htmlBody ?? null,
        input.textBody ?? null,
        input.kind || null,
        input.resendId || null,
      ],
    );
  } catch (e) {
    console.error("[logOutbound]", e instanceof Error ? e.message : e);
  }
}

/** Busca e-mails ENVIADOS para um contato. Ver a nota em `searchInbound`. */
export async function searchOutbound(storeId: string, termo: string, limit = 50): Promise<OutboundEmail[]> {
  const alvo = `%${escaparLike(termo)}%`;
  return query<OutboundEmail>(
    `SELECT id, toAddr, subject, htmlBody, textBody, kind, createdAt
       FROM outbound_emails
      WHERE storeId = ? AND toAddr LIKE ? ESCAPE '\\\\'
      ORDER BY createdAt DESC LIMIT ${Math.min(200, Math.max(1, limit))}`,
    [storeId, alvo],
  );
}

/** Um e-mail enviado, para a página de leitura. Sempre escopado à loja. */
export async function getOutboundById(storeId: string, id: string): Promise<OutboundEmail | null> {
  const rows = await query<OutboundEmail>(
    `SELECT id, toAddr, subject, htmlBody, textBody, kind, createdAt
     FROM outbound_emails WHERE id = ? AND storeId = ? LIMIT 1`,
    [id, storeId],
  );
  return rows[0] ?? null;
}

export async function listOutbound(storeId: string, limit = 100): Promise<OutboundEmail[]> {
  return query<OutboundEmail>(
    `SELECT id, toAddr, subject, htmlBody, textBody, kind, createdAt
     FROM outbound_emails WHERE storeId = ? ORDER BY createdAt DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
    [storeId],
  );
}
