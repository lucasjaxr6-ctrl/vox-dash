import { requireStore } from "@/lib/stores";
import { updatePixelsSchema } from "@/lib/validation";
import { getPixelsForMerchant, setPixels } from "@/lib/settings";
import { json, handleError } from "@/lib/http";
import { conferirTokenMeta } from "@/lib/meta-compra";

// GET /api/painel/pixels -> lista de pixels da loja ativa (sem token).
export async function GET() {
  try {
    const { store } = await requireStore();
    return json({ pixels: await getPixelsForMerchant(store.id) });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/painel/pixels -> salva a lista (validada por Zod).
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const parsed = updatePixelsSchema.parse(body);
    // Token novo da Meta é conferido aqui: errado, a compra pelo servidor falharia
    // calada, com o painel dizendo "CAPI ativa".
    for (const p of parsed.pixels) {
      if (p.type !== "meta" || !p.accessToken?.trim()) continue;
      const erro = await conferirTokenMeta(p.pixelId, p.accessToken.trim());
      if (erro) return json({ error: erro }, 400);
    }
    await setPixels(store.id, parsed.pixels);
    return json({ ok: true, pixels: await getPixelsForMerchant(store.id) });
  } catch (err) {
    return handleError(err);
  }
}
