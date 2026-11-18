import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkMangofyCredentials } from "@/lib/mangofy";

// POST /api/painel/mangofy/test
// Confere API Key + Store Code com uma LEITURA (consulta um pagamento que não
// existe: 404 = credenciais aceitas). Nunca cria cobrança.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkMangofyCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a MangoFy." }, 400);
    return json({ ok: true, message: "Credenciais aceitas pela MangoFy." });
  } catch (err) {
    return handleError(err);
  }
}
