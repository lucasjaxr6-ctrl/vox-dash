import "server-only";
import crypto from "crypto";
import { getPinPaySecret } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração PinPay (gateway Pix). A secret key (sk_) NÃO vem do .env: é
// configurada pelo lojista no painel e fica criptografada. Tudo server-side.
// Docs: POST /pix (cobrança) e GET /transactions (status — ver observação abaixo).
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.usepinpay.com/functions/v1/api-v1";

// Mapeia o status da PinPay para o vocabulário interno (mesmo do Transfyre/MP):
// APPROVED / DECLINED / REFUNDED / CHARGEBACK / PENDING.
export function normalizePinPayStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    case "chargeback":
      return "CHARGEBACK";
    case "failed":
    case "expired":
      return "DECLINED";
    default:
      return "PENDING"; // pending, processing
  }
}

/**
 * Cria uma cobrança Pix na PinPay. `externalReference` (id do pedido) e
 * `checkoutUrl` são OBRIGATÓRIOS pela PinPay — sem eles a cobrança é recusada.
 */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference: string;
    checkoutUrl: string;
  },
): Promise<PixCharge> {
  const secret = await getPinPaySecret(storeId);
  if (!secret) throw new Error("PinPay não configurada. Configure a secret key no painel.");

  const doc = (input.customer.document || "").replace(/\D/g, "");
  const res = await fetch(`${API_BASE}/pix`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      amount: input.amountCents,
      description: input.description,
      customer: {
        name: input.customer.name,
        email: input.customer.email,
        document: { number: doc },
      },
      metadata: {
        external_reference: input.externalReference,
        checkout_url: input.checkoutUrl,
      },
    }),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = data?.message || data?.error || `PinPay respondeu ${res.status}`;
    throw new Error(`Falha ao gerar Pix: ${msg}`);
  }

  return {
    id: String(data.id),
    status: normalizePinPayStatus(data.status),
    qrCode: String(data.pix?.qr_code ?? ""),
    // Não guardamos a URL do QR (o checkout gera a imagem do copia-e-cola).
    qrCodeUrl: null,
    expiresAt: data.pix?.expires_at ? String(data.pix.expires_at) : null,
  };
}

/**
 * Consulta o status normalizado de uma cobrança Pix da PinPay (ou null).
 *
 * ⚠️ A API da PinPay NÃO tem GET por id que funcione: `GET /pix/{id}` e
 * `GET /transactions/{id}` devolvem "Transação não encontrada" MESMO para ids
 * válidos, e os filtros `?id=` / `?external_reference=` da listagem são
 * ignorados. O único jeito confiável de ler o status é PAGINAR a lista
 * `GET /transactions` (mais recentes primeiro) e casar pelo id. A cobrança-alvo
 * quase sempre está na 1ª página (é recente). Sem isso, Pix pago nunca era
 * confirmado no checkout.
 */
export async function getPinPayPaymentStatus(storeId: string, id: string): Promise<string | null> {
  const secret = await getPinPaySecret(storeId);
  if (!secret) return null;
  const LIMIT = 100;
  for (let offset = 0; offset <= 400; offset += LIMIT) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/transactions?limit=${LIMIT}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const list: any[] = Array.isArray(data?.data) ? data.data : [];
    if (list.length === 0) break;
    const tx = list.find((t) => t?.id === id || t?.external_reference === id);
    if (tx && typeof tx.status === "string") return normalizePinPayStatus(tx.status);
    if (list.length < LIMIT) break; // última página
  }
  return null; // ainda não processada (ou fora do alcance da paginação)
}
