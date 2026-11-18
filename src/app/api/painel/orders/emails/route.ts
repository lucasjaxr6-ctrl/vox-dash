import { z } from "zod";
import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { reenviarEmailDoPedido } from "@/lib/emails-do-pedido";

// POST /api/painel/orders/emails  { orderId, tipo }
// Reenvia um e-mail do pedido ao cliente (aba E-mails do detalhe da venda).
// O pedido é buscado DENTRO da loja ativa (lib/emails-do-pedido.ts), então
// um orderId de outra loja dá "Pedido não encontrado".
const schema = z.object({
  orderId: z.string().trim().min(1).max(64),
  tipo: z.enum(["pix", "pixrecovery", "paid", "separation", "tracking"]),
});

export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const { orderId, tipo } = schema.parse(await req.json());

    // Clique repetido não pode virar dez e-mails iguais na caixa do cliente.
    const rl = rateLimit(`reenvio-email:${store.id}:${orderId}:${tipo}`, 3, 10 * 60_000);
    if (!rl.ok) return json({ error: "Esse e-mail já foi reenviado várias vezes agora. Aguarde alguns minutos." }, 429);

    const r = await reenviarEmailDoPedido(store.id, orderId, tipo);
    if (!r.ok) return json({ error: r.error ?? "Não foi possível enviar." }, 400);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
