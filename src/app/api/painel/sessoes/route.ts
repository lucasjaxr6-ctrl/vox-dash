import { getCurrentUser, revokeMySession, destroyCurrentSession, getCurrentSessionId } from "@/lib/session";
import { json, handleError } from "@/lib/http";

// DELETE /api/painel/sessoes  { id }
// Encerra UMA sessão da própria conta.
//
// A identidade vem do cookie (getCurrentUser), nunca do corpo — e o `userId`
// entra no WHERE do DELETE. Sem isso, mandar o id de uma sessão alheia
// derrubaria o acesso de outra pessoa.
export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: "Não autenticado." }, 401);

    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    if (!id || typeof id !== "string") return json({ error: "Sessão não informada." }, 400);

    // Encerrar a PRÓPRIA sessão é logout: apaga e limpa o cookie, senão o
    // navegador seguiria mandando um cookie que não vale mais.
    if (id === (await getCurrentSessionId())) {
      await destroyCurrentSession();
      return json({ ok: true, loggedOut: true });
    }

    const ok = await revokeMySession(user.id, id);
    // Resposta idêntica para "não existe" e "não é sua": confirmar a diferença
    // entregaria a existência de sessões de outras contas.
    if (!ok) return json({ error: "Sessão não encontrada." }, 404);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
