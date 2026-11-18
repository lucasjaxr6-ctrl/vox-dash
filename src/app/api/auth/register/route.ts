import { registerSchema } from "@/lib/validation";
import { hashPassword } from "@/lib/password";
import { query, newId, withTransaction } from "@/lib/db";
import { createSession } from "@/lib/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { json, handleError } from "@/lib/http";
import { HttpError } from "@/lib/auth";
import { documentoOuCelularEmUso } from "@/lib/merchant-profile";

// POST /api/auth/register — cadastro do lojista (as duas etapas da tela,
// enviadas juntas).
//
// Conta, loja e perfil (documento + endereço) nascem numa TRANSAÇÃO: ou entra
// tudo, ou nada. Sem isso, uma falha no meio deixaria uma conta sem loja ou
// sem endereço — e um e-mail "já cadastrado" que a pessoa não consegue usar.
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const rl = rateLimit(`register:${ip}`, 5, 60_000);
    if (!rl.ok) throw new HttpError(429, "Muitas tentativas. Tente mais tarde.");

    const data = registerSchema.parse(await req.json());
    const passwordHash = await hashPassword(data.password);

    const existing = await query<{ id: string }>(`SELECT id FROM users WHERE email = ? LIMIT 1`, [data.email]);
    if (existing.length) {
      // Mensagem genérica (mitiga enumeração de contas).
      throw new HttpError(409, "Não foi possível concluir o cadastro.");
    }

    // Um CPF/CNPJ e um celular por conta. Volta como `issues` do campo para a
    // tela levar a pessoa à etapa certa (celular é da 1ª, documento da 2ª).
    const emUso = await documentoOuCelularEmUso(null, data.document, data.phone);
    if (emUso) return json({ error: emUso.mensagem, issues: { [emUso.campo]: [emUso.mensagem] } }, 409);

    const id = newId();
    const storeId = newId();
    try {
      await withTransaction(async (conn) => {
        await conn.execute(
          `INSERT INTO users (id, email, name, passwordHash, phone, role)
           VALUES (?, ?, ?, ?, ?, 'MERCHANT')`,
          [id, data.email, data.name, passwordHash, data.phone],
        );
        // A loja já nasce com o nome informado — o layout do painel só cria
        // "Minha loja" para contas antigas que entraram sem nenhuma.
        await conn.execute(`INSERT INTO stores (id, ownerUserId, name) VALUES (?, ?, ?)`, [storeId, id, data.storeName]);
        await conn.execute(`INSERT INTO store_settings (storeId) VALUES (?)`, [storeId]);
        await conn.execute(
          `INSERT INTO merchant_profiles
             (userId, documentType, document, cep, street, number, complement, neighborhood, city, state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            data.document.length === 14 ? "CNPJ" : "CPF",
            data.document,
            data.cep,
            data.street,
            data.number,
            data.complement || null,
            data.neighborhood,
            data.city,
            data.state,
          ],
        );
      });
    } catch (e: any) {
      // Corrida: o índice UNIQUE do e-mail garante a integridade.
      if (e?.code === "ER_DUP_ENTRY") {
        throw new HttpError(409, "Não foi possível concluir o cadastro.");
      }
      throw e;
    }

    await createSession(id, { userAgent: req.headers.get("user-agent"), ip });
    return json({ user: { id, email: data.email, name: data.name, role: "MERCHANT" } }, 201);
  } catch (err) {
    return handleError(err);
  }
}
