import "server-only";
import { cookies, headers } from "next/headers";
import crypto from "crypto";
import { query, execute, newId } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// MODELO DE SESSÃO (coração da segurança)
//  - Token OPACO aleatório (32 bytes) vai no cookie httpOnly.
//  - No banco guardamos só o SHA-256 do token (nunca o token em si).
//  - A identidade (userId) vem SEMPRE daqui, JAMAIS de campo do frontend.
//  - httpOnly (anti-XSS) + SameSite=Lax + Secure (HTTPS). O anti-CSRF é o
//    middleware: toda escrita em /api exige Origin do mesmo host.
//
// Lax, não Strict (desde 27/10/2026). Com Strict o navegador NÃO manda o
// cookie quando o painel é aberto por um link de fora (WhatsApp, e-mail,
// retorno da Shopify): o lojista logado caía no login e só entrava depois de
// atualizar a página algumas vezes. Lax manda o cookie nessa navegação e
// continua segurando-o em POST vindo de outro site.
// ─────────────────────────────────────────────────────────────────────────────

const COOKIE_NAME = "bs_session";
// Inteiro saneado (constante controlada pelo servidor) — pode ir literal no SQL.
const TTL_SECONDS = Math.max(
  1,
  Math.floor(Number(process.env.SESSION_TTL_SECONDS ?? 604800)),
);

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  role: "USER" | "MERCHANT" | "ADMIN";
  /**
   * Conta suspensa pelo admin: ENTRA, mas o painel fica bloqueado.
   *
   * Diferente de `banned`, que impede o login e por isso nem chega aqui —
   * a consulta já o filtra. Quem decide o que fazer com este campo é o
   * layout do painel; o checkout não o consulta.
   */
  suspended: number;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(ip)
    .digest("hex");
}

/**
 * Localização da requisição, a partir dos cabeçalhos que a borda já injeta.
 * Best-effort: fora da Vercel eles não existem e a sessão fica sem localização.
 * A cidade vem percent-encoded (acentos), por isso o decode.
 */
async function geoFromHeaders(): Promise<{ city: string | null; region: string | null; country: string | null }> {
  try {
    const h = await headers();
    const dec = (v: string | null) => {
      if (!v) return null;
      try {
        return decodeURIComponent(v).slice(0, 110) || null;
      } catch {
        return v.slice(0, 110);
      }
    };
    return {
      city: dec(h.get("x-vercel-ip-city")),
      region: dec(h.get("x-vercel-ip-country-region")),
      country: dec(h.get("x-vercel-ip-country")),
    };
  } catch {
    return { city: null, region: null, country: null };
  }
}

/** Cria uma sessão e grava o cookie httpOnly. Expiração calculada no banco. */
export async function createSession(
  userId: string,
  meta?: { userAgent?: string | null; ip?: string | null },
): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const id = newId();
  const th = sha256(token);
  const ua = meta?.userAgent ?? null;
  const iph = hashIp(meta?.ip ?? null);
  const geo = await geoFromHeaders();
  // ipHash = uso interno (privacidade); ip em texto = visão de sessões no admin
  // (são contas do painel, não clientes do checkout).
  try {
    await execute(
      `INSERT INTO sessions (id, tokenHash, userId, expiresAt, userAgent, ipHash, ip, city, region, country)
       VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ${TTL_SECONDS} SECOND), ?, ?, ?, ?, ?, ?)`,
      [id, th, userId, ua, iph, meta?.ip ?? null, geo.city, geo.region, geo.country],
    );
  } catch {
    // Colunas `ip`/`city`/`region`/`country` podem não existir ainda (migrações
    // migrate-session-ip / migrate-session-geo pendentes). NÃO quebra o login.
    await execute(
      `INSERT INTO sessions (id, tokenHash, userId, expiresAt, userAgent, ipHash)
       VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ${TTL_SECONDS} SECOND), ?, ?)`,
      [id, th, userId, ua, iph],
    );
  }

  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

/**
 * Retorna o usuário autenticado a partir do cookie de sessão — ou null.
 * Única fonte de identidade do servidor. A expiração é filtrada no próprio SQL.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await query<SessionUser>(
    // `suspended` vem junto, mas NÃO filtra: suspenso entra e vê a tela
    // explicando o bloqueio. Quem não entra é o banido — por isso só `banned`
    // está na condição.
    `SELECT u.id AS id, u.email AS email, u.name AS name,
            u.cpf AS cpf, u.phone AS phone, u.role AS role, u.suspended AS suspended
     FROM sessions s JOIN users u ON u.id = s.userId
     WHERE s.tokenHash = ? AND s.expiresAt > NOW(3) AND u.banned = 0
     LIMIT 1`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

/** Id da sessão atual (para destacá-la na lista de sessões do admin). */
export async function getCurrentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await query<{ id: string }>(
    `SELECT id FROM sessions WHERE tokenHash = ? AND expiresAt > NOW(3) LIMIT 1`,
    [sha256(token)],
  );
  return rows[0]?.id ?? null;
}

/** Invalida a sessão atual (logout) e limpa o cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await execute(`DELETE FROM sessions WHERE tokenHash = ?`, [sha256(token)]);
  }
  store.delete(COOKIE_NAME);
}

export type ActiveSession = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  createdAt: Date;
  expiresAt: Date;
  current: boolean;
};

/**
 * Sessões ATIVAS do usuário logado, da mais recente para a mais antiga.
 *
 * Filtra por `userId` no SQL — nunca por algo vindo do cliente. E não devolve
 * `tokenHash`: com ele, ver a própria tela viraria um jeito de roubar a sessão.
 */
export async function listMySessions(userId: string): Promise<ActiveSession[]> {
  const currentId = await getCurrentSessionId();
  try {
    const rows = await query<Omit<ActiveSession, "current">>(
      `SELECT id, userAgent, ip, city, region, country, createdAt, expiresAt
         FROM sessions
        WHERE userId = ? AND expiresAt > NOW(3)
        ORDER BY createdAt DESC
        LIMIT 50`,
      [userId],
    );
    return rows.map((r) => ({ ...r, current: r.id === currentId }));
  } catch {
    // Migração de geo pendente: a tela continua funcionando sem localização.
    const rows = await query<Omit<ActiveSession, "current" | "city" | "region" | "country">>(
      `SELECT id, userAgent, ip, createdAt, expiresAt
         FROM sessions
        WHERE userId = ? AND expiresAt > NOW(3)
        ORDER BY createdAt DESC
        LIMIT 50`,
      [userId],
    );
    return rows.map((r) => ({ ...r, city: null, region: null, country: null, current: r.id === currentId }));
  }
}

/**
 * Encerra UMA sessão do próprio usuário.
 *
 * O `userId` entra no WHERE: sem ele, quem descobrisse o id de uma sessão
 * alheia poderia derrubar a sessão de outra pessoa. Devolve false quando nada
 * foi apagado (id inexistente ou de outro dono) — a rota não diferencia os dois
 * casos para não confirmar a existência de sessões alheias.
 */
export async function revokeMySession(userId: string, sessionId: string): Promise<boolean> {
  const r = await execute(`DELETE FROM sessions WHERE id = ? AND userId = ?`, [sessionId, userId]);
  return r.affectedRows > 0;
}

/** Invalida TODAS as sessões de um usuário (ex.: após troca de senha). */
export async function destroyAllSessions(userId: string): Promise<void> {
  await execute(`DELETE FROM sessions WHERE userId = ?`, [userId]);
}

// Sessões expiradas podem ser limpas por um job periódico:
//   DELETE FROM sessions WHERE expiresAt <= NOW(3);
