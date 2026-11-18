import { requireUser, HttpError } from "@/lib/auth";
import { updateProfileSchema } from "@/lib/validation";
import { query, execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/profile -> dados do PRÓPRIO usuário logado.
export async function GET() {
  try {
    const user = await requireUser();
    return json({ user });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/profile -> atualiza o PRÓPRIO perfil.
//
// ⭐ PONTO CRÍTICO ⭐ O schema NÃO aceita userId/ownerId. O WHERE usa SEMPRE
// `user.id` derivado do token de sessão. Mesmo que o atacante envie outro id no
// corpo, é ignorado. => Impossível editar o perfil de outro usuário.
export async function PUT(req: Request) {
  try {
    const user = await requireUser();
    const body = await req.json();
    const data = updateProfileSchema.parse(body);

    // Fragmentos de SET vêm de whitelist fixa; valores vão parametrizados.
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) {
      sets.push("name = ?");
      params.push(data.name);
    }
    if (data.cpf !== undefined) {
      sets.push("cpf = ?");
      params.push(data.cpf);
    }
    if (data.phone !== undefined) {
      sets.push("phone = ?");
      params.push(data.phone);
    }

    if (sets.length) {
      params.push(user.id); // WHERE id = ? (sempre da sessão)
      try {
        await execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
      } catch (e: any) {
        if (e?.code === "ER_DUP_ENTRY") {
          throw new HttpError(409, "CPF já cadastrado.");
        }
        throw e;
      }
    }

    const rows = await query(
      `SELECT id, email, name, cpf, phone FROM users WHERE id = ? LIMIT 1`,
      [user.id],
    );
    return json({ user: rows[0] });
  } catch (err) {
    return handleError(err);
  }
}
