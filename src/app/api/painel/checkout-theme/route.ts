import { requireStore } from "@/lib/stores";
import { checkoutThemeSchema } from "@/lib/validation";
import { getCheckoutTheme, setCheckoutTheme } from "@/lib/settings";
import { json, handleError } from "@/lib/http";

// GET /api/painel/checkout-theme -> tema da loja ativa (ou null).
export async function GET() {
  try {
    const { store } = await requireStore();
    return json({ theme: await getCheckoutTheme(store.id) });
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/painel/checkout-theme -> salva o tema (validado por Zod).
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const theme = checkoutThemeSchema.parse(body?.theme ?? body);
    await setCheckoutTheme(store.id, theme);
    return json({ ok: true, theme });
  } catch (err) {
    return handleError(err);
  }
}
