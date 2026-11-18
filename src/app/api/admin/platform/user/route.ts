import { requireAdmin } from "@/lib/auth";
import { destroyAllSessions } from "@/lib/session";
import { query, execute, inPlaceholders } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { z } from "zod";

const schema = z.object({
  action: z.enum(["update", "ban", "unban", "suspend", "unsuspend", "delete"]),
  userId: z.string().min(1).max(64),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(255).optional(),
  role: z.enum(["USER", "MERCHANT", "ADMIN"]).optional(),
});

// Três bloqueios diferentes, de propósito:
//
//   ban       -> impede o LOGIN e derruba as sessões. A pessoa não entra.
//   suspend   -> deixa entrar, bloqueia o PAINEL. Usado para pendência
//                administrativa sem cortar o acesso à conta.
//   (taxa)    -> automático, derivado do saldo em aberto, some com o pagamento.
//
// NENHUM deles desliga o checkout: a loja continua vendendo em qualquer caso.

// POST /api/admin/platform/user — gestão de contas pelo super-admin.
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const body = schema.parse(await req.json());
    const { action, userId } = body;

    if (userId === admin.id && action !== "update") {
      return json({ error: "Você não pode banir/excluir a própria conta." }, 400);
    }

    const rows = await query<{ id: string; role: string }>(`SELECT id, role FROM users WHERE id = ? LIMIT 1`, [userId]);
    const target = rows[0];
    if (!target) return json({ error: "Usuário não encontrado." }, 404);

    if (action === "ban") {
      await execute(`UPDATE users SET banned = 1 WHERE id = ?`, [userId]);
      await destroyAllSessions(userId); // derruba as sessões ativas na hora
      return json({ ok: true });
    }
    if (action === "unban") {
      await execute(`UPDATE users SET banned = 0 WHERE id = ?`, [userId]);
      return json({ ok: true });
    }
    if (action === "suspend" || action === "unsuspend") {
      // Sem derrubar sessão: suspender não expulsa, só tranca o painel. A
      // pessoa continua logada e vê a tela explicando o que aconteceu — o que
      // é o ponto, porque ela precisa saber o que resolver.
      await execute(`UPDATE users SET suspended = ? WHERE id = ?`, [action === "suspend" ? 1 : 0, userId]);
      return json({ ok: true });
    }

    if (action === "update") {
      const sets: string[] = [];
      const params: unknown[] = [];
      if (body.name !== undefined) { sets.push("name = ?"); params.push(body.name || null); }
      if (body.email !== undefined) {
        const dupe = await query<{ id: string }>(`SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1`, [body.email, userId]);
        if (dupe[0]) return json({ error: "Já existe uma conta com este e-mail." }, 400);
        sets.push("email = ?"); params.push(body.email);
      }
      if (body.role !== undefined) {
        // Trava anti-lockout: não deixa REMOVER o último ADMIN.
        if (target.role === "ADMIN" && body.role !== "ADMIN") {
          const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN'`);
          if (Number(n) <= 1) return json({ error: "Não é possível rebaixar o último administrador." }, 400);
        }
        sets.push("role = ?"); params.push(body.role);
      }
      if (!sets.length) return json({ ok: true });
      params.push(userId);
      await execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
      return json({ ok: true });
    }

    // delete: só se NENHUMA loja da conta tiver pedidos (protege dados reais).
    const stores = await query<{ id: string }>(`SELECT id FROM stores WHERE ownerUserId = ?`, [userId]);
    const storeIds = stores.map((s) => s.id);
    if (storeIds.length) {
      const [{ n }] = await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM orders WHERE storeId IN (${inPlaceholders(storeIds.length)})`,
        storeIds,
      );
      if (Number(n) > 0) {
        return json({ error: "Esta conta tem lojas com pedidos. Bana em vez de excluir (evita perder dados)." }, 400);
      }
      await execute(`DELETE FROM products WHERE storeId IN (${inPlaceholders(storeIds.length)})`, storeIds);
      await execute(`DELETE FROM store_settings WHERE storeId IN (${inPlaceholders(storeIds.length)})`, storeIds);
      await execute(`DELETE FROM stores WHERE ownerUserId = ?`, [userId]);
    }
    await execute(`DELETE FROM sessions WHERE userId = ?`, [userId]);
    await execute(`DELETE FROM users WHERE id = ?`, [userId]);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
