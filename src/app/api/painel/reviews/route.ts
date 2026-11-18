import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { query, execute, newId } from "@/lib/db";
import { createReviewSchema } from "@/lib/validation";

type Row = {
  id: string;
  name: string;
  stars: number;
  text: string;
  photoUrl: string | null;
  position: number;
  active: number;
};

function mapReview(r: Row) {
  return { ...r, active: !!r.active };
}

// GET /api/painel/reviews -> lista todas as avaliações.
export async function GET() {
  try {
    const { store } = await requireStore();
    const rows = await query<Row>(
      `SELECT id, name, stars, text, photoUrl, position, active
       FROM reviews WHERE storeId = ? ORDER BY position ASC, createdAt DESC`,
      [store.id],
    );
    return json({ reviews: rows.map(mapReview) });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/painel/reviews -> cria uma avaliação.
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const d = createReviewSchema.parse(body);
    await execute(
      `INSERT INTO reviews (id, storeId, name, stars, text, photoUrl, position, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId(), store.id, d.name, d.stars, d.text, d.photoUrl || null, d.position, d.active ? 1 : 0],
    );
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
