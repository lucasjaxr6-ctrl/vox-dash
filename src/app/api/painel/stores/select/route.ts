import { setActiveStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { z } from "zod";

const selectSchema = z.object({ storeId: z.string().min(1).max(191) });

// POST /api/painel/stores/select -> define a loja ativa (cookie), validando posse.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { storeId } = selectSchema.parse(body);
    await setActiveStore(storeId);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
