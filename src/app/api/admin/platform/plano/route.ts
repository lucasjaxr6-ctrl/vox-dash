import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { definirPlanoPeloAdmin, MAX_DIAS_ADMIN, planoDaConta } from "@/lib/plans";
import { PLANOS, PLANOS_IDS } from "@/lib/planos";

// PUT /api/admin/platform/plano { userId, plano, dias }
//
// O admin define o plano de uma conta. Plano pago vale por `dias` a partir de
// agora; Basic não vence. Só ADMIN — e a conta alvo vem do corpo de propósito:
// aqui quem decide é o operador da plataforma, não o dono da conta.
const schema = z
  .object({
    userId: z.string().min(1).max(191),
    plano: z.enum(PLANOS_IDS),
    dias: z.number().int().min(1).max(MAX_DIAS_ADMIN).optional(),
  })
  .refine((v) => PLANOS[v.plano].precoCents === 0 || typeof v.dias === "number", {
    message: "Informe por quantos dias o plano fica ativo.",
    path: ["dias"],
  });

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const { userId, plano, dias } = schema.parse(await req.json());

    const [conta] = await query<{ id: string }>(`SELECT id FROM users WHERE id = ? LIMIT 1`, [userId]);
    if (!conta) return json({ error: "Conta não encontrada." }, 404);

    await definirPlanoPeloAdmin(userId, plano, dias ?? 1);
    const atual = await planoDaConta(userId);
    console.log(`[planos] admin definiu ${plano}${dias ? ` por ${dias} dia(s)` : ""} para a conta ${userId}`);
    return json({ ok: true, plano: atual });
  } catch (err) {
    return handleError(err);
  }
}
