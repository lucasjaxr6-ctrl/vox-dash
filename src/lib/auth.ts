import "server-only";
import { getCurrentUser } from "./session";

export type AuthedUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Erro tipado para respostas de auth/autorização consistentes. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Exige um usuário autenticado. Lança 401 se não houver sessão válida.
 * O objeto retornado é a fonte confiável de identidade (vem do banco).
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Não autenticado");
  return user;
}

/** Exige um usuário com papel ADMIN. Lança 401/403. */
export async function requireAdmin(): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    // 403: autenticado, mas sem permissão.
    throw new HttpError(403, "Acesso negado");
  }
  return user;
}

/** Exige papel MERCHANT (lojista) — ADMIN também passa. Lança 401/403. */
export async function requireMerchant(): Promise<AuthedUser> {
  const user = await requireUser();
  if (user.role !== "MERCHANT" && user.role !== "ADMIN") {
    throw new HttpError(403, "Acesso negado");
  }
  return user;
}
