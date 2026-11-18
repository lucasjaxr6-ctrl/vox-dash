import { loginSchema } from "@/lib/validation";
import { verifyPassword, DUMMY_HASH } from "@/lib/password";
import { query } from "@/lib/db";
import { createSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { json, handleError } from "@/lib/http";
import { HttpError } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const body = await req.json();
    const data = loginSchema.parse(body);

    const rlIp = rateLimit(`login:ip:${ip}`, 20, 60_000);
    const rlUser = rateLimit(`login:user:${data.email}`, 5, 60_000);
    if (!rlIp.ok || !rlUser.ok) {
      throw new HttpError(429, "Muitas tentativas. Tente mais tarde.");
    }

    const rows = await query<{
      id: string;
      email: string;
      name: string;
      passwordHash: string;
      role: "USER" | "MERCHANT" | "ADMIN";
      banned: number;
    }>(`SELECT id, email, name, passwordHash, role, banned FROM users WHERE email = ? LIMIT 1`, [
      data.email,
    ]);
    const user = rows[0];

    // Sempre roda um hash (mesmo sem usuário) para igualar o tempo de resposta
    // de "email inexistente" e "senha errada" (anti-enumeração).
    const ok = user
      ? await verifyPassword(data.password, user.passwordHash)
      : await verifyPassword(data.password, DUMMY_HASH);

    if (!user || !ok) {
      throw new HttpError(401, "E-mail ou senha incorretos.");
    }
    if (user.banned) {
      throw new HttpError(403, "Esta conta foi suspensa. Fale com o suporte.");
    }

    await createSession(user.id, { userAgent: req.headers.get("user-agent"), ip });
    return json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    return handleError(err);
  }
}
