import "server-only";
import { cookies } from "next/headers";
import { query, execute, newId } from "./db";
import { getCurrentUser } from "./session";
import { requireMerchant, HttpError, type AuthedUser } from "./auth";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-loja: cada conta (user) pode ter várias lojas. A "loja ativa" do painel
// fica num cookie (bs_store) e é SEMPRE revalidada contra a posse do usuário
// logado — nunca se confia no cookie sozinho. O checkout público resolve a loja
// pelo domínio próprio verificado (customDomain).
// ─────────────────────────────────────────────────────────────────────────────

const STORE_COOKIE = "bs_store";

export interface Store {
  id: string;
  ownerUserId: string;
  name: string;
}

/** Lojas da conta (mais recentes primeiro). */
export async function getStoresForOwner(userId: string): Promise<Store[]> {
  return query<Store>(
    `SELECT id, ownerUserId, name FROM stores
     WHERE ownerUserId = ? ORDER BY createdAt ASC`,
    [userId],
  );
}

/** Cria uma loja + sua linha de configuração (1:1) e retorna a loja. */
export async function createStore(userId: string, name: string): Promise<Store> {
  const id = newId();
  const cleanName = (name || "").trim().slice(0, 191) || "Minha loja";
  await execute(`INSERT INTO stores (id, ownerUserId, name) VALUES (?, ?, ?)`, [
    id,
    userId,
    cleanName,
  ]);
  await execute(`INSERT INTO store_settings (storeId) VALUES (?)`, [id]);
  return { id, ownerUserId: userId, name: cleanName };
}

/**
 * Loja ativa do painel para o usuário logado. Usa o cookie se válido (e da posse
 * do usuário); senão cai para a primeira loja da conta. Null se a conta não tem
 * nenhuma loja (ou não há usuário).
 */
export async function getActiveStore(): Promise<Store | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const selected = (await cookies()).get(STORE_COOKIE)?.value;

  // ADMIN pode "impersonar" qualquer loja (super-admin da plataforma): se o
  // cookie aponta pra uma loja existente, usa ela mesmo sem ser o dono.
  if (user.role === "ADMIN" && selected) {
    const any = await query<Store>(`SELECT id, ownerUserId, name FROM stores WHERE id = ? LIMIT 1`, [selected]);
    if (any[0]) return any[0];
  }

  const stores = await getStoresForOwner(user.id);
  if (stores.length === 0) return null;

  if (selected) {
    const match = stores.find((s) => s.id === selected);
    if (match) return match;
  }
  return stores[0];
}

/** Exige merchant logado + uma loja ativa. Lança 400 se a conta não tem loja. */
export async function requireStore(): Promise<{ user: AuthedUser; store: Store }> {
  const user = await requireMerchant();
  const store = await getActiveStore();
  if (!store) {
    throw new HttpError(400, "Crie uma loja primeiro.");
  }
  return { user, store };
}

/** Define a loja ativa no cookie, validando a posse antes. Lança 403/404.
 *  ADMIN pode definir QUALQUER loja (impersonação do super-admin). */
export async function setActiveStore(storeId: string): Promise<void> {
  const user = await requireMerchant();
  const rows = await query<{ id: string }>(
    user.role === "ADMIN"
      ? `SELECT id FROM stores WHERE id = ? LIMIT 1`
      : `SELECT id FROM stores WHERE id = ? AND ownerUserId = ? LIMIT 1`,
    user.role === "ADMIN" ? [storeId] : [storeId, user.id],
  );
  if (!rows[0]) throw new HttpError(404, "Loja não encontrada");
  // Lax pelo mesmo motivo do cookie de sessão (lib/session.ts): com Strict, o
  // painel aberto por link de fora vinha sem ele e mostrava a primeira loja.
  (await cookies()).set(STORE_COOKIE, storeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Resolve a loja do checkout PÚBLICO pelo Host da requisição: precisa de um
 * customDomain verificado. Retorna null se nenhum domínio bater.
 */
export async function resolveStoreByHost(host: string | null): Promise<Store | null> {
  if (!host) return null;
  const domain = host.split(":")[0].trim().toLowerCase(); // tira porta
  if (!domain) return null;
  const rows = await query<Store>(
    `SELECT s.id, s.ownerUserId, s.name
     FROM store_settings ss JOIN stores s ON s.id = ss.storeId
     WHERE ss.customDomain = ? AND ss.domainVerified = 1 AND s.suspended = 0
     LIMIT 1`,
    [domain],
  );
  return rows[0] ?? null;
}

/**
 * Para onde mandar quem abre a RAIZ do domínio de checkout de uma loja
 * (checkout.loja.com.br/). Null quando o Host não é de loja nenhuma, ou seja,
 * é o domínio da própria VOX.
 *
 * Quem chega ali é cliente da loja: não pode ver a landing da VOX. Volta para
 * a vitrine, pelo .myshopify.com, que a Shopify redireciona para o domínio
 * principal da loja. Sem Shopify válida, vai para o domínio pai do checkout
 * (o domínio do checkout é sempre um subdomínio, ver api/painel/domain).
 *
 * Não exige domínio verificado nem loja ativa, ao contrário de
 * resolveStoreByHost: aqui não se vende nada, só se tira a landing do caminho.
 * O .myshopify.com é validado porque veio do painel e, sem isso, viraria
 * redirecionamento para qualquer site.
 */
export async function vitrineDoDominio(host: string | null): Promise<string | null> {
  if (!host) return null;
  const domain = host.split(":")[0].trim().toLowerCase(); // tira porta
  if (!domain) return null;
  const [r] = await query<{ shop: string | null }>(
    `SELECT shopifyStoreDomain AS shop FROM store_settings WHERE customDomain = ? LIMIT 1`,
    [domain],
  );
  if (!r) return null;
  const shop = (r.shop || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return `https://${shop}`;
  return `https://${domain.split(".").slice(1).join(".")}`;
}
