import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { sendAbandonedCartEmail } from "@/lib/email";
import { z } from "zod";

// POST /api/painel/carrinhos/recuperar -> manda o e-mail de recuperação de UM
// carrinho. Só o lojista dispara; não há envio automático.
const schema = z.object({ cartId: z.string().trim().min(1).max(64) });

export async function POST(req: Request) {
  try {
    // `requireStore` amarra o envio à loja ATIVA — o cartId vem do navegador, e
    // sem isso alguém poderia mandar e-mail usando o carrinho de outra loja.
    const { store } = await requireStore();
    const { cartId } = schema.parse(await req.json());

    const r = await sendAbandonedCartEmail(store.id, cartId);
    if (!r.ok) return json({ error: r.error ?? "Falha ao enviar." }, 400);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
