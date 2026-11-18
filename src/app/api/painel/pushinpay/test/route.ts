import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { checkPushinpayCredentials } from "@/lib/pushinpay";

// POST /api/painel/pushinpay/test
// Confere se o token da PushinPay responde, consultando a CONTA
// (GET /api/account). Nunca cria cobrança — testar integração não pode gerar
// movimento na conta do lojista — e não consome o limite de consulta de
// transação (1 por minuto) que eles aplicam.
export async function POST() {
  try {
    const { store } = await requireStore();
    const r = await checkPushinpayCredentials(store.id);
    if (!r.ok) return json({ error: r.error ?? "Falha ao falar com a PushinPay." }, 400);
    return json({ ok: true, message: "Token aceito pela PushinPay." });
  } catch (err) {
    return handleError(err);
  }
}
