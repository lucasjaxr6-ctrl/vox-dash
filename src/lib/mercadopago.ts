import "server-only";
import crypto from "crypto";
import { getMercadoPagoAccessToken } from "./settings";
import type { PixCharge, PixCustomer } from "./pix-types";

// ─────────────────────────────────────────────────────────────────────────────
// Integração Mercado Pago (Pix). O access token NÃO vem do .env: é configurado
// pelo lojista no painel e fica criptografado em repouso. Tudo server-side.
// Docs: POST /v1/payments (payment_method_id=pix) e GET /v1/payments/{id}.
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE = "https://api.mercadopago.com";

// Mapeia o status do Mercado Pago para o vocabulário interno usado pelo resto do
// app (mesmo do Transfyre): APPROVED / DECLINED / REFUNDED / CHARGEBACK / PENDING.
export function normalizeMpStatus(status: string | undefined): string {
  switch ((status || "").toLowerCase()) {
    case "approved":
      return "APPROVED";
    case "rejected":
    case "cancelled":
      return "DECLINED";
    case "refunded":
      return "REFUNDED";
    case "charged_back":
      return "CHARGEBACK";
    default:
      return "PENDING"; // pending, in_process, authorized...
  }
}

/**
 * Cria uma cobrança Pix no Mercado Pago. `amountCents` = valor final em centavos.
 * Enviamos o MÁXIMO de dados coerentes (endereço, telefone, itens, external_reference,
 * IP real do comprador): o antifraude do MP pune transações com dados pobres.
 */
export async function createPixCharge(
  storeId: string,
  input: {
    amountCents: number;
    customer: PixCustomer;
    description?: string;
    externalReference?: string;
    statementDescriptor?: string;
    payerIp?: string;
    notificationUrl?: string;
    additionalInfo?: CardAdditionalInfo;
  },
): Promise<PixCharge> {
  const token = await getMercadoPagoAccessToken(storeId);
  if (!token) {
    throw new Error("Mercado Pago não configurado. Configure o access token no painel.");
  }

  const parts = input.customer.name.trim().split(/\s+/);
  const firstName = parts[0] || input.customer.name;
  const lastName = parts.slice(1).join(" ") || ".";
  const doc = (input.customer.document || "").replace(/\D/g, "");

  const body: Record<string, unknown> = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    payment_method_id: "pix",
    description: input.description,
    payer: {
      email: input.customer.email,
      first_name: firstName,
      last_name: lastName,
      identification: doc ? { type: doc.length > 11 ? "CNPJ" : "CPF", number: doc } : undefined,
    },
  };
  // Identificação única do pedido (o MP exige e usa p/ detectar duplicidade).
  if (input.externalReference) body.external_reference = input.externalReference;
  // URL de notificação (webhook) — o MP avisa aqui quando o Pix é pago.
  if (input.notificationUrl) body.notification_url = input.notificationUrl;
  // Como aparece no extrato do pagador (o MP corta em ~22 chars, sem acento).
  if (input.statementDescriptor) body.statement_descriptor = input.statementDescriptor;
  // Itens + endereço + telefone do comprador (peso alto no score do antifraude).
  const additional = mapAdditionalInfo(input.additionalInfo);
  if (additional) body.additional_info = additional;

  const res = await fetch(`${API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Chave de idempotência: evita cobrança duplicada em re-tentativas.
      "X-Idempotency-Key": crypto.randomUUID(),
      // IP real do comprador — sem isso o MP só enxerga o IP do nosso servidor.
      ...(isPlausibleIp(input.payerIp) ? { "X-Forwarded-For": input.payerIp } : {}),
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    // Bloqueio de política/risco da conta MP (não é erro de dados do cliente).
    if (res.status === 403 || data?.blocked_by === "PolicyAgent" || String(data?.code || "").includes("POLICIES")) {
      throw new Error("Pix temporariamente indisponível. Tente novamente em alguns minutos ou use o cartão.");
    }
    const msg = data?.message || data?.error || `Mercado Pago respondeu ${res.status}`;
    throw new Error(`Falha ao gerar Pix: ${msg}`);
  }

  const tx = data?.point_of_interaction?.transaction_data ?? {};
  const qrCode = String(tx.qr_code ?? "");
  // NÃO guardamos a imagem base64 do QR (é enorme e estoura o VARCHAR(512) da
  // coluna pixQrCodeUrl). O checkout gera o QR a partir do copia-e-cola.
  return {
    id: String(data.id),
    status: normalizeMpStatus(data.status),
    qrCode,
    qrCodeUrl: null,
    expiresAt: data.date_of_expiration ? String(data.date_of_expiration) : null,
  };
}

export type CardPaymentResult = {
  id: string;
  status: string; // normalizado (APPROVED / PENDING / DECLINED / ...)
  statusDetail: string; // motivo (útil quando recusado)
  // Desafio 3DS 2.0: presente quando status_detail = pending_challenge. O cliente
  // renderiza o desafio do banco (iframe) para autenticar e aprovar a compra.
  threeDs?: { externalResourceUrl: string; creq: string };
};

/**
 * Cria uma cobrança de CARTÃO no Mercado Pago com o token gerado no navegador
 * (tokenização client-side — o número do cartão NUNCA passa pelo nosso servidor).
 * `amountCents` = valor final já com desconto/frete calculado no servidor.
 */
export type CardAdditionalInfo = {
  items?: { id?: string; title: string; description?: string; categoryId?: string; quantity: number; unitPriceCents: number }[];
  payer?: { firstName?: string; lastName?: string; phone?: { areaCode: string; number: string }; address?: { zip?: string; street?: string; number?: string } };
  shipmentAddress?: { zip?: string; street?: string; number?: string; city?: string; state?: string };
};

/** Converte nosso `additional_info` (camelCase) para o formato do MP (snake_case). */
function mapAdditionalInfo(ai?: CardAdditionalInfo): Record<string, unknown> | undefined {
  if (!ai) return undefined;
  const additional: Record<string, unknown> = {};
  if (ai.items?.length) {
    additional.items = ai.items.map((it) => ({
      id: it.id,
      title: it.title,
      description: it.description || it.title,
      category_id: it.categoryId || "others",
      quantity: it.quantity,
      unit_price: Number((it.unitPriceCents / 100).toFixed(2)),
    }));
  }
  if (ai.payer) {
    const p: Record<string, unknown> = {};
    if (ai.payer.firstName) p.first_name = ai.payer.firstName;
    if (ai.payer.lastName) p.last_name = ai.payer.lastName;
    if (ai.payer.phone) p.phone = { area_code: ai.payer.phone.areaCode, number: ai.payer.phone.number };
    if (ai.payer.address) p.address = { zip_code: ai.payer.address.zip, street_name: ai.payer.address.street, street_number: ai.payer.address.number };
    if (Object.keys(p).length) additional.payer = p;
  }
  if (ai.shipmentAddress) {
    additional.shipments = {
      receiver_address: {
        zip_code: ai.shipmentAddress.zip,
        street_name: ai.shipmentAddress.street,
        street_number: ai.shipmentAddress.number,
        city_name: ai.shipmentAddress.city,
        state_name: ai.shipmentAddress.state,
      },
    };
  }
  return Object.keys(additional).length ? additional : undefined;
}

/** IP plausível (v4/v6) para mandar no X-Forwarded-For — evita header lixo. */
function isPlausibleIp(ip?: string): ip is string {
  return !!ip && ip.length <= 45 && /^[0-9a-fA-F:.]+$/.test(ip) && ip !== "0.0.0.0";
}

export async function createCardPayment(
  storeId: string,
  input: {
    amountCents: number;
    token: string;
    installments: number;
    paymentMethodId: string;
    issuerId?: string;
    description?: string;
    externalReference?: string;
    notificationUrl?: string;
    payer: { email: string; document: string; firstName?: string; lastName?: string };
    deviceId?: string; // impressão digital do dispositivo (antifraude)
    additionalInfo?: CardAdditionalInfo;
  },
): Promise<CardPaymentResult> {
  const token = await getMercadoPagoAccessToken(storeId);
  if (!token) throw new Error("Mercado Pago não configurado.");

  const doc = (input.payer.document || "").replace(/\D/g, "");
  const body: Record<string, unknown> = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    token: input.token,
    description: input.description,
    installments: Math.max(1, Math.min(12, Math.round(input.installments) || 1)),
    payment_method_id: input.paymentMethodId,
    // 3DS 2.0 "optional": em transação de risco o MP pede a autenticação do banco
    // (desafio) em vez de recusar. Baixo risco aprova direto, sem fricção.
    three_d_secure_mode: "optional",
    payer: {
      email: input.payer.email,
      identification: doc ? { type: doc.length > 11 ? "CNPJ" : "CPF", number: doc } : undefined,
      ...(input.payer.firstName ? { first_name: input.payer.firstName } : {}),
      ...(input.payer.lastName ? { last_name: input.payer.lastName } : {}),
    },
  };
  if (input.issuerId) body.issuer_id = input.issuerId;
  if (input.externalReference) body.external_reference = input.externalReference;
  if (input.notificationUrl) body.notification_url = input.notificationUrl;

  // additional_info: dados ricos melhoram a pontuação do antifraude do MP.
  const additional = mapAdditionalInfo(input.additionalInfo);
  if (additional) body.additional_info = additional;

  const res = await fetch(`${API_BASE}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": crypto.randomUUID(),
      ...(input.deviceId ? { "X-meli-session-id": input.deviceId } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok) {
    const msg = data?.message || data?.error || `Mercado Pago respondeu ${res.status}`;
    throw new Error(msg);
  }
  const tds = data?.three_ds_info;
  return {
    id: String(data.id),
    status: normalizeMpStatus(data.status),
    statusDetail: String(data.status_detail ?? ""),
    ...(tds?.external_resource_url && tds?.creq
      ? { threeDs: { externalResourceUrl: String(tds.external_resource_url), creq: String(tds.creq) } }
      : {}),
  };
}

/** Consulta o status normalizado de um pagamento do Mercado Pago (ou null). */
export async function getMercadoPagoPaymentStatus(storeId: string, paymentId: string): Promise<string | null> {
  const token = await getMercadoPagoAccessToken(storeId);
  if (!token) return null;
  const res = await fetch(`${API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({} as any));
  return typeof data?.status === "string" ? normalizeMpStatus(data.status) : null;
}
