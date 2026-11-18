import { requireStore } from "@/lib/stores";
import { createProductSchema } from "@/lib/validation";
import { query, execute, newId } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/admin/products -> lista os produtos da loja ativa.
export async function GET() {
  try {
    const { store } = await requireStore();
    const rows = await query<any>(
      `SELECT id, name, priceCents, active, imageUrl, shopifyId, createdAt
       FROM products WHERE storeId = ? ORDER BY createdAt DESC`,
      [store.id],
    );
    return json({ products: rows.map((p) => ({ ...p, active: Boolean(p.active) })) });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/admin/products -> cria produto na loja ativa. priceCents é inteiro.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const data = createProductSchema.parse(body);

    const id = newId();
    await execute(
      `INSERT INTO products (id, storeId, name, description, priceCents, imageUrl, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        store.id,
        data.name,
        data.description ?? null,
        data.priceCents,
        data.imageUrl ?? null,
        data.active === false ? 0 : 1,
      ],
    );
    return json(
      {
        product: {
          id,
          name: data.name,
          priceCents: data.priceCents,
          active: data.active !== false,
        },
      },
      201,
    );
  } catch (err) {
    return handleError(err);
  }
}
