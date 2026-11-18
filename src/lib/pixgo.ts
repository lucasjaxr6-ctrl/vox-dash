import "server-only";
import crypto from "crypto";
import { getPixgoCredentials } from "./settings";
import { comoHorarioDeBrasilia } from "./datas";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração PixGo (pixgo.org) — SOMENTE Pix. API REST server-to-server.
// Base: https://pixgo.org/api/v1  ·  Auth: header X-API-Key: pk_...
//  - Criar: POST /payment/create  (amount em REAIS; receiver_cpf OBRIGATÓRIO)
//  - Status: GET /payment/{id}/status  (data.status)
//  - Webhook: assinado HMAC-SHA256 de `${timestamp}.${rawBody}` com o Webhook Secret.
// Status: pending / completed / expired / cancelled (webhook: refunded).
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://pixgo.org/api/v1";

export function normalizePixgoStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "completed":
    case "paid":
      return "APPROVED";
    case "refunded":
      return "REFUNDED";
    // expired/cancelled: em Pix NÃO cancelamos o pedido (fica recuperável) -> no-op.
    default:
      return "PENDING";
  }
}

type Address = { cep?: string; street?: string; number?: string; neighborhood?: string; complement?: string; city?: string; uf?: string };

function addressLine(a: Address | undefined): string | undefined {
  if (!a) return undefined;
  const parts = [
    [a.street, a.number].filter(Boolean).join(", "),
    a.neighborhood, a.city, a.uf,
    (a.cep || "").replace(/\D/g, ""),
  ].map((s) => (s || "").toString().trim()).filter(Boolean);
  const line = parts.join(", ").slice(0, 500);
  return line.length >= 10 ? line : undefined;
}

/** Cria uma cobrança Pix na PixGo. `amountCents` é convertido para REAIS. */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    payerIp?: string;
    address?: Address;
    postbackUrl?: string;
    externalReference?: string;
    items?: { name: string; quantity: number; unitPriceCents: number }[];
  },
): Promise<PixCharge> {
  const creds = await getPixgoCredentials(storeId);
  if (!creds) throw new Error("PixGo não configurada. Informe a chave de API no painel.");

  const doc = (input.customer.document || "").replace(/\D/g, "");
  const body: Record<string, unknown> = {
    // Valor em REAIS (a PixGo NÃO usa centavos). 2 casas decimais.
    amount: Math.round(input.amountCents) / 100,
    description: (input.description || "Pedido").slice(0, 200),
    // receiver_cpf = documento de QUEM VAI PAGAR (o cliente). Obrigatório e trava
    // a titularidade do QR (só esse CPF/CNPJ pode pagar).
    receiver_cpf: doc,
    receiver_name: (input.customer.name || "").slice(0, 100) || undefined,
    receiver_email: input.customer.email || undefined,
    receiver_phone: (input.customer.phone || "").replace(/\D/g, "") || undefined,
    receiver_address: addressLine(input.address),
  };
  if (input.externalReference) body.external_id = input.externalReference.slice(0, 50);
  if (input.postbackUrl) body.webhook_url = input.postbackUrl;

  const res = await fetch(`${API_BASE}/payment/create`, {
    method: "POST",
    headers: { "X-API-Key": creds.apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data?.success === false) {
    console.error("[pixgo] criar", res.status, JSON.stringify(data).slice(0, 300));
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`Falha ao gerar o Pix: ${msg}`);
  }

  const d = data?.data ?? data ?? {};
  const qrCode = String(d.qr_code ?? d.qrcode ?? "");
  if (!qrCode) throw new Error("PixGo não retornou o código Pix (copia e cola).");
  return {
    id: String(d.payment_id ?? d.id ?? ""),
    status: normalizePixgoStatus(d.status),
    qrCode,
    qrCodeUrl: d.qr_image_url ? String(d.qr_image_url) : null,
    // Mesmo cuidado da Appmax: data sem fuso vinda de gateway brasileiro é
    // horário de Brasília. Os 2 pedidos que temos mostram o mesmo deslocamento
    // de −3h. Se um dia vier com fuso na string, a função deixa intacta.
    expiresAt: comoHorarioDeBrasilia(d.expires_at ? String(d.expires_at) : null),
  };
}

/** Consulta o status normalizado de um pagamento PixGo (ou null). */
export async function getPixgoTransactionStatus(storeId: string, paymentId: string): Promise<string | null> {
  const creds = await getPixgoCredentials(storeId);
  if (!creds) return null;
  try {
    const res = await fetch(`${API_BASE}/payment/${encodeURIComponent(paymentId)}/status`, {
      headers: { "X-API-Key": creds.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    // 200 e 410 (estado final) são válidos; qualquer outro = desconhecido.
    if (!res.ok && res.status !== 410) return null;
    const data = await res.json().catch(() => null);
    const st = data?.data?.status ?? data?.status;
    return typeof st === "string" ? normalizePixgoStatus(st) : null;
  } catch {
    return null;
  }
}

/** Verifica a assinatura HMAC-SHA256 do webhook: hex de `${timestamp}.${rawBody}`. */
export function verifyPixgoWebhook(secret: string, timestamp: string, signature: string, rawBody: string): boolean {
  if (!secret || !timestamp || !signature) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
