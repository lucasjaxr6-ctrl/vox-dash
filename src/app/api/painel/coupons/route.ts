import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { query, execute, newId } from "@/lib/db";
import { createCouponSchema } from "@/lib/validation";

type Row = {
  id: string;
  code: string;
  type: "PERCENT" | "FIXED";
  value: number;
  active: number;
  minOrderCents: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: string | null;
};

function mapCoupon(r: Row) {
  return {
    id: r.id,
    code: r.code,
    type: r.type,
    value: r.value,
    active: !!r.active,
    minOrderCents: r.minOrderCents,
    maxRedemptions: r.maxRedemptions,
    timesRedeemed: r.timesRedeemed,
    expiresAt: r.expiresAt,
  };
}

// GET /api/painel/coupons -> lista todos os cupons.
export async function GET() {
  try {
    const { store } = await requireStore();
    const rows = await query<Row>(
      `SELECT id, code, type, value, active, minOrderCents, maxRedemptions, timesRedeemed, expiresAt
       FROM coupons WHERE storeId = ? ORDER BY createdAt DESC`,
      [store.id],
    );
    return json({ coupons: rows.map(mapCoupon) });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/painel/coupons -> cria um cupom.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const d = createCouponSchema.parse(body);
    const code = d.code.trim().toUpperCase();
    const expiresAt = d.expiresAt ? `${d.expiresAt} 23:59:59` : null;

    const existing = await query<{ id: string }>(
      `SELECT id FROM coupons WHERE storeId = ? AND code = ? LIMIT 1`,
      [store.id, code],
    );
    if (existing[0]) return json({ error: "Já existe um cupom com esse código." }, 409);

    await execute(
      `INSERT INTO coupons (id, storeId, code, type, value, active, minOrderCents, maxRedemptions, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), store.id, code, d.type, d.value, d.active ? 1 : 0, d.minOrderCents ?? null, d.maxRedemptions ?? null, expiresAt],
    );
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
