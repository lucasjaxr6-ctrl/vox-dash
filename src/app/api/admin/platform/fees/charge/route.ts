import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { json, handleError } from "@/lib/http";
import { gerarCobranca } from "@/lib/platform-fees";

// POST /api/admin/platform/fees/charge
// Gera o Pix com todo o saldo em aberto de uma loja, na conta da plataforma.
const schema = z.object({ storeId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  try {
    await requireAdmin();
    const { storeId } = schema.parse(await req.json());
    const r = await gerarCobranca(storeId);
    if (!r.ok) return json({ error: r.erro ?? "Falha ao gerar a cobrança." }, 400);
    return json({ ok: true, cobranca: r.cobranca });
  } catch (err) {
    return handleError(err);
  }
}
