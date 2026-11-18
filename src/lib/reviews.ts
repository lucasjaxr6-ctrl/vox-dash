import "server-only";
import { query } from "./db";

// Avaliações ativas para exibir no checkout.
export type PublicReview = {
  id: string;
  name: string;
  stars: number;
  text: string;
  photoUrl: string | null;
};

export async function getActiveReviews(storeId: string): Promise<PublicReview[]> {
  return query<PublicReview>(
    `SELECT id, name, stars, text, photoUrl
     FROM reviews WHERE storeId = ? AND active = 1
     ORDER BY position ASC, createdAt DESC
     LIMIT 50`,
    [storeId],
  );
}
