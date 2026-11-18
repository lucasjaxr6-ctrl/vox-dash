import "server-only";
import { query, execute, newId } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Caixa de entrada no painel (Resend Inbound). Uma loja "recebe" no endereço
// configurado em store_settings.inboundEmail; o webhook casa o destinatário do
// e-mail com esse endereço e grava em inbound_emails para o lojista ler.
// ─────────────────────────────────────────────────────────────────────────────

export type InboundEmail = {
  id: string;
  fromAddr: string | null;
  fromName: string | null;
  toAddr: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  isRead: number;
  receivedAt: Date;
};

/**
 * storeId RESERVADO da caixa da plataforma.
 *
 * Ids de loja são UUID, então este valor nunca colide — e toda consulta
 * escopada por loja filtra por um id real, sem alcançar estas linhas.
 */
export const PLATFORM_STORE_ID = "__platform__";

/** Loja dona de um endereço de recebimento (case-insensitive). */
export async function findStoreByInboundEmail(addr: string): Promise<string | null> {
  const clean = addr.trim().toLowerCase();
  if (!clean) return null;
  // 1) Match EXATO do endereço configurado (ex.: contato@delladecor.com).
  const exact = await query<{ storeId: string }>(
    `SELECT storeId FROM store_settings WHERE LOWER(inboundEmail) = ? LIMIT 1`,
    [clean],
  );
  if (exact[0]?.storeId) return exact[0].storeId;
  // 2) Fallback por DOMÍNIO: qualquer e-mail para *@dominio cai na loja dona
  //    daquele domínio — assim as RESPOSTAS dos clientes (que chegam em
  //    noreply@, sac@, etc.) também entram na caixa, não só o endereço exato.
  const domain = clean.split("@")[1];
  if (!domain) return null;
  const byDomain = await query<{ storeId: string }>(
    `SELECT storeId FROM store_settings
     WHERE inboundEmail IS NOT NULL AND LOWER(SUBSTRING_INDEX(inboundEmail, '@', -1)) = ? LIMIT 1`,
    [domain],
  );
  if (byDomain[0]?.storeId) return byDomain[0].storeId;

  // 3) PLATAFORMA, por último: a loja sempre ganha o próprio endereço. Aqui
  //    entra o que chega para a Vox — exato ou qualquer coisa no domínio dela.
  const plat = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM platform_settings
      WHERE id = 1 AND inboundEmail IS NOT NULL
        AND (LOWER(inboundEmail) = ? OR LOWER(SUBSTRING_INDEX(inboundEmail, '@', -1)) = ?)`,
    [clean, domain],
  );
  return Number(plat[0]?.n ?? 0) > 0 ? PLATFORM_STORE_ID : null;
}

/** Grava um e-mail recebido. Retorna o id (ou null se sem loja/destinatário). */
export async function storeInboundEmail(input: {
  toAddr: string;
  fromAddr?: string | null;
  fromName?: string | null;
  subject?: string | null;
  textBody?: string | null;
  htmlBody?: string | null;
  messageId?: string | null;
  receivedAt?: Date;
}): Promise<string | null> {
  const storeId = await findStoreByInboundEmail(input.toAddr);
  if (!storeId) return null;
  const id = newId();
  await execute(
    `INSERT INTO inbound_emails
       (id, storeId, fromAddr, fromName, toAddr, subject, textBody, htmlBody, messageId, receivedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, storeId,
      input.fromAddr ?? null, input.fromName ?? null, input.toAddr,
      (input.subject ?? "").slice(0, 500) || null,
      input.textBody ?? null, input.htmlBody ?? null,
      (input.messageId ?? "").slice(0, 500) || null,
      input.receivedAt ?? new Date(),
    ],
  );
  return id;
}

export async function listInbound(storeId: string, limit = 100): Promise<InboundEmail[]> {
  return query<InboundEmail>(
    `SELECT id, fromAddr, fromName, toAddr, subject, textBody, htmlBody, isRead, receivedAt
     FROM inbound_emails WHERE storeId = ? ORDER BY receivedAt DESC LIMIT ${Math.min(500, Math.max(1, limit))}`,
    [storeId],
  );
}

/**
 * Busca e-mails RECEBIDOS de um contato. Casa por endereço ou por nome.
 *
 * Vai ao banco em vez de filtrar a lista da tela: a caixa carrega só os 100
 * mais recentes, então procurar um cliente de duas semanas atrás não acharia
 * nada. Com ~800 linhas e o índice (storeId, receivedAt) recortando a loja, a
 * varredura do LIKE é barata.
 */
export async function searchInbound(storeId: string, termo: string, limit = 50): Promise<InboundEmail[]> {
  const alvo = `%${escaparLike(termo)}%`;
  return query<InboundEmail>(
    `SELECT id, fromAddr, fromName, toAddr, subject, textBody, htmlBody, isRead, receivedAt
       FROM inbound_emails
      WHERE storeId = ?
        AND (fromAddr LIKE ? ESCAPE '\\\\' OR fromName LIKE ? ESCAPE '\\\\')
      ORDER BY receivedAt DESC LIMIT ${Math.min(200, Math.max(1, limit))}`,
    [storeId, alvo, alvo],
  );
}

/**
 * Neutraliza os curingas do LIKE no texto digitado. Sem isto, um "%" na busca
 * casaria com tudo e um "_" com qualquer caractere.
 */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Um e-mail recebido, para a página de leitura. Sempre escopado à loja. */
export async function getInboundById(storeId: string, id: string): Promise<InboundEmail | null> {
  const rows = await query<InboundEmail>(
    `SELECT id, fromAddr, fromName, toAddr, subject, textBody, htmlBody, isRead, receivedAt
     FROM inbound_emails WHERE id = ? AND storeId = ? LIMIT 1`,
    [id, storeId],
  );
  return rows[0] ?? null;
}

/** Quantos e-mails ainda não lidos. Usa o índice (storeId, receivedAt). */
export async function countInboundUnread(storeId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM inbound_emails WHERE storeId = ? AND isRead = 0`,
    [storeId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function markInboundRead(storeId: string, id: string): Promise<void> {
  await execute(`UPDATE inbound_emails SET isRead = 1 WHERE id = ? AND storeId = ?`, [id, storeId]);
}

export async function getInboundAddress(storeId: string): Promise<string | null> {
  const rows = await query<{ inboundEmail: string | null }>(
    `SELECT inboundEmail FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  return rows[0]?.inboundEmail ?? null;
}

export async function setInboundAddress(storeId: string, addr: string): Promise<void> {
  const clean = addr.trim().toLowerCase().slice(0, 320) || null;
  await execute(`UPDATE store_settings SET inboundEmail = ? WHERE storeId = ?`, [clean, storeId]);
}

/** Signing secret (Svix/whsec_) do webhook Inbound do Resend DA LOJA — decifrado. */
export async function getInboundSecret(storeId: string): Promise<string | null> {
  const rows = await query<{ resendInboundSecretEnc: string | null }>(
    `SELECT resendInboundSecretEnc FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const enc = rows[0]?.resendInboundSecretEnc;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

/** Salva o signing secret da loja (vazio = mantém o atual, não apaga). */
export async function setInboundSecret(storeId: string, secret: string): Promise<void> {
  const clean = (secret || "").trim();
  if (!clean) return; // em branco = manter o já salvo
  await execute(`UPDATE store_settings SET resendInboundSecretEnc = ? WHERE storeId = ?`, [encryptSecret(clean), storeId]);
}
