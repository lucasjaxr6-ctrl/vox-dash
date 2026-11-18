import { getCurrentUser } from "@/lib/session";
import { json, handleError } from "@/lib/http";

// Retorna o usuário logado (ou null). Útil para o frontend saber o estado de auth.
export async function GET() {
  try {
    const user = await getCurrentUser();
    return json({ user });
  } catch (err) {
    return handleError(err);
  }
}
