import "server-only";
import { query } from "./db";

// Order bumps ativos para exibir no checkout (só os cujo produto está ativo).
export type PublicOrderBump = {
  id: string;
  productId: string;
  title: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
};

export async function getActiveOrderBumps(storeId: string): Promise<PublicOrderBump[]> {
  return query<PublicOrderBump>(
    `SELECT b.id, b.productId, b.title, b.description,
            p.priceCents AS priceCents, p.imageUrl AS imageUrl
     FROM order_bumps b JOIN products p ON p.id = b.productId
     WHERE b.storeId = ? AND b.active = 1 AND p.active = 1
     ORDER BY b.position ASC, b.createdAt DESC
     LIMIT 10`,
    [storeId],
  );
}
