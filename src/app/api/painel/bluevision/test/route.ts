import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkBluevisionCredentials } from "@/lib/bluevision";

// POST /api/painel/bluevision/test
// Confere a Secret Key e se a conta pode cobrar, só com LEITURAS. Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkBluevisionCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a Blue Vision." }, 400);
    return json({ ok: true, message: "Chave aceita pela Blue Vision." });
  } catch (err) {
    return handleError(err);
  }
}
