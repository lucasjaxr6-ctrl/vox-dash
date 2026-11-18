import { headers } from "next/headers";
import { json, handleError } from "@/lib/http";
import { applyCouponSchema } from "@/lib/validation";
import { validateCoupon } from "@/lib/coupons";
import { resolveStoreByHost } from "@/lib/stores";

// POST /api/checkout/coupon -> valida um cupom (da loja do domínio) para o subtotal.
// Público (cliente do checkout). A validação definitiva ocorre no fechamento
// do pedido (server-side) ao gerar o pagamento.
export async function POST(req: Request) {
  try {
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return json({ ok: false, error: "Loja não encontrada." }, 404);

    const body = await req.json();
    const { code, subtotalCents } = applyCouponSchema.parse(body);
    const result = await validateCoupon(store.id, code, subtotalCents);
    // Sempre 200; o cliente lê result.ok.
    return json(result);
  } catch (err) {
    return handleError(err);
  }
}
