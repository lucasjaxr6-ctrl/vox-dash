import { requireStore } from "@/lib/stores";
import { updateSettingsSchema } from "@/lib/validation";
import { getSettingsForAdmin, updateStoreSettings } from "@/lib/settings";
import { json, handleError } from "@/lib/http";

// GET /api/admin/settings -> estado das configurações da loja ativa (sem expor segredos).
export async function GET() {
  try {
    const { store } = await requireStore();
    return json({ settings: await getSettingsForAdmin(store.id) });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/admin/settings -> salva configurações + credenciais da loja ativa.
// Os segredos são criptografados em settings.ts antes de ir ao banco.
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const data = updateSettingsSchema.parse(body);
    await updateStoreSettings(store.id, data);
    return json({ settings: await getSettingsForAdmin(store.id) });
  } catch (err) {
    return handleError(err);
  }
}
