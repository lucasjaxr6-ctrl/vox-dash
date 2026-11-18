import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { query, execute, newId } from "@/lib/db";
import { createOrderBumpSchema } from "@/lib/validation";

type Row = {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  active: number;
  position: number;
  productName: string | null;
  productPriceCents: number | null;
  productImageUrl: string | null;
};

function mapBump(r: Row) {
  return {
    id: r.id,
    productId: r.productId,
    title: r.title,
    description: r.description,
    active: !!r.active,
    position: r.position,
    product: r.productName
      ? { name: r.productName, priceCents: r.productPriceCents ?? 0, imageUrl: r.productImageUrl }
      : null,
  };
}

// GET /api/painel/order-bumps -> lista os order bumps da loja ativa (com produto).
export async function GET() {
  try {
    const { store } = await requireStore();
    const rows = await query<Row>(
      `SELECT b.id, b.productId, b.title, b.description, b.active, b.position,
              p.name AS productName, p.priceCents AS productPriceCents, p.imageUrl AS productImageUrl
       FROM order_bumps b LEFT JOIN products p ON p.id = b.productId
       WHERE b.storeId = ? ORDER BY b.position ASC, b.createdAt DESC`,
      [store.id],
    );
    return json({ bumps: rows.map(mapBump) });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/painel/order-bumps -> cria um order bump (o produto tem que ser da loja).
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const d = createOrderBumpSchema.parse(await req.json());

    const prod = await query<{ id: string }>(
      `SELECT id FROM products WHERE id = ? AND storeId = ? LIMIT 1`,
      [d.productId, store.id],
    );
    if (!prod[0]) return json({ error: "Produto não encontrado nesta loja." }, 400);

    await execute(
      `INSERT INTO order_bumps (id, storeId, productId, title, description, active, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), store.id, d.productId, d.title, d.description || null, d.active === false ? 0 : 1, d.position ?? 0],
    );
    return json({ ok: true }, 201);
  } catch (err) {
    return handleError(err);
  }
}
