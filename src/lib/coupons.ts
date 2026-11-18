import "server-only";
import { query } from "./db";

// ── Validação e cálculo de desconto de cupom (server-side, fonte de verdade) ──

export type CouponType = "PERCENT" | "FIXED";

/** Desconto em centavos. PERCENT: value=1..100. FIXED: value em centavos. */
export function couponDiscountCents(
  type: CouponType,
  value: number,
  subtotalCents: number,
): number {
  if (subtotalCents <= 0) return 0;
  if (type === "PERCENT") {
    const pct = Math.max(0, Math.min(100, value));
    return Math.min(subtotalCents, Math.round((subtotalCents * pct) / 100));
  }
  return Math.min(subtotalCents, Math.max(0, value));
}

type CouponCheckRow = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  active: number;
  minOrderCents: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  isExpired: number;
};

export type CouponValidation =
  | { ok: true; code: string; type: CouponType; value: number; discountCents: number }
  | { ok: false; error: string };

function brl(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Valida um cupom para um subtotal e retorna o desconto, ou um erro amigável. */
export async function validateCoupon(
  storeId: string,
  codeRaw: string,
  subtotalCents: number,
): Promise<CouponValidation> {
  const code = (codeRaw || "").trim().toUpperCase();
  if (!code) return { ok: false, error: "Informe um cupom." };

  // Expiração checada no banco (evita problemas de fuso entre JS e MySQL).
  const rows = await query<CouponCheckRow>(
    `SELECT id, code, type, value, active, minOrderCents, maxRedemptions, timesRedeemed,
            (expiresAt IS NOT NULL AND expiresAt < NOW(3)) AS isExpired
     FROM coupons WHERE storeId = ? AND code = ? LIMIT 1`,
    [storeId, code],
  );
  const c = rows[0];
  if (!c || !c.active) return { ok: false, error: "Cupom inválido." };
  if (c.isExpired) return { ok: false, error: "Cupom expirado." };
  if (c.maxRedemptions != null && c.timesRedeemed >= c.maxRedemptions) {
    return { ok: false, error: "Cupom esgotado." };
  }
  if (c.minOrderCents != null && subtotalCents < c.minOrderCents) {
    return { ok: false, error: `Pedido mínimo de ${brl(c.minOrderCents)} para este cupom.` };
  }

  const discountCents = couponDiscountCents(c.type, c.value, subtotalCents);
  if (discountCents <= 0) return { ok: false, error: "Cupom sem desconto aplicável." };

  return { ok: true, code: c.code, type: c.type, value: c.value, discountCents };
}
