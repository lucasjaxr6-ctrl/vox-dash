import { requireMerchant } from "@/lib/auth";
import { completarCadastroSchema } from "@/lib/validation";
import { withTransaction } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { documentoOuCelularEmUso } from "@/lib/merchant-profile";

// POST /api/painel/cadastro — completa o cadastro (KYC) de conta antiga.
//
// A conta vem SEMPRE da sessão: o schema nem aceita userId, então ninguém
// grava documento na conta de outra pessoa. Celular e perfil entram juntos,
// numa transação, para a tela nunca liberar o painel com metade dos dados.
export async function POST(req: Request) {
  try {
    const user = await requireMerchant();
    const d = completarCadastroSchema.parse(await req.json());

    // Mesma regra do cadastro novo: um CPF/CNPJ e um celular por conta.
    const emUso = await documentoOuCelularEmUso(user.id, d.document, d.phone);
    if (emUso) return json({ error: emUso.mensagem, issues: { [emUso.campo]: [emUso.mensagem] } }, 409);

    await withTransaction(async (conn) => {
      await conn.execute(`UPDATE users SET phone = ? WHERE id = ?`, [d.phone, user.id]);
      await conn.execute(
        `INSERT INTO merchant_profiles
           (userId, documentType, document, cep, street, number, complement, neighborhood, city, state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           documentType = VALUES(documentType), document = VALUES(document), cep = VALUES(cep),
           street = VALUES(street), number = VALUES(number), complement = VALUES(complement),
           neighborhood = VALUES(neighborhood), city = VALUES(city), state = VALUES(state)`,
        [
          user.id,
          d.document.length === 14 ? "CNPJ" : "CPF",
          d.document,
          d.cep,
          d.street,
          d.number,
          d.complement || null,
          d.neighborhood,
          d.city,
          d.state,
        ],
      );
    });

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
