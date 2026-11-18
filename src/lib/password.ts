import bcrypt from "bcryptjs";

// Custo do bcrypt. 12 é um bom equilíbrio (2025/2026). Aumente conforme o hardware.
// Para segurança máxima, considere migrar para argon2id (pacote "argon2").
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

// bcrypt.compare é resistente a timing attacks por design.
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Hash "fantasma" usado para mitigar enumeração de usuários por timing:
// quando o e-mail não existe, ainda comparamos contra um hash fixo para
// que o tempo de resposta de "usuário inexistente" ≈ "senha errada".
export const DUMMY_HASH =
  "$2a$12$9Ch51VydN7gWpF1y4Ps1NOEbN62/yipaa0ZIYNXuNYU6w9218Rn8e";
