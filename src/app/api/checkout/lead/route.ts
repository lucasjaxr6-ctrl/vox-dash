import { headers } from "next/headers";
import { after } from "next/server";
import { json, handleError } from "@/lib/http";
import { notifyCartAbandoned } from "@/lib/notifications";
import { leadSchema } from "@/lib/validation";
import { query, execute, newId, inPlaceholders } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";

// POST /api/checkout/lead -> registra/atualiza um carrinho abandonado (lead) do
// checkout público. Chamado enquanto o cliente digita os dados, ANTES de gerar o
// Pix. Best-effort: nunca deve derrubar o checkout. Dedupe por (storeId, sessionId).
//
// Regra de ouro: nomes/preços dos itens vêm do BANCO (nunca do frontend). O
// frontend só manda productId + quantidade.
export async function POST(req: Request) {
  try {
    const store = await resolveStoreByHost((await headers()).get("host"));
    if (!store) return json({ ok: false }, 404);

    const d = leadSchema.parse(await req.json());

    const email = (d.email || "").trim();
    const phoneDigits = (d.phone || "").replace(/\D/g, "");
    // Sem contato mínimo ainda: ignora (não polui a lista de recuperação).
    if (!email && phoneDigits.length < 8) return json({ ok: true });

    // Snapshot dos itens com preço/nome do banco.
    let itemsJson: string | null = null;
    let totalCents = 0;
    if (d.items?.length) {
      const ids = [...new Set(d.items.map((i) => i.productId))];
      const products = await query<{ id: string; name: string; priceCents: number }>(
        `SELECT id, name, priceCents FROM products
         WHERE active = 1 AND storeId = ? AND id IN (${inPlaceholders(ids.length)})`,
        [store.id, ...ids],
      );
      const byId = new Map(products.map((p) => [p.id, p]));
      const snap: { productId: string; name: string; quantity: number; priceCents: number }[] = [];
      for (const it of d.items) {
        const p = byId.get(it.productId);
        if (p) {
          snap.push({ productId: p.id, name: p.name, quantity: it.quantity, priceCents: p.priceCents });
          totalCents += p.priceCents * it.quantity;
        }
      }
      if (snap.length) itemsJson = JSON.stringify(snap);
    }

    const leadId = newId();
    const res = await execute(
      `INSERT INTO abandoned_carts
         (id, storeId, sessionId, name, email, document, phone, address, itemsJson, totalCents, step, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         email = VALUES(email),
         document = VALUES(document),
         phone = VALUES(phone),
         address = COALESCE(VALUES(address), address),
         itemsJson = COALESCE(VALUES(itemsJson), itemsJson),
         totalCents = VALUES(totalCents),
         step = GREATEST(step, VALUES(step)),
         -- não reabre um lead já convertido (Pix gerado).
         status = IF(status = 'CONVERTED', 'CONVERTED', 'OPEN'),
         updatedAt = NOW(3)`,
      [
        leadId, store.id, d.sessionId,
        d.name || null, email || null, d.cpf || null, d.phone || null,
        d.address ? JSON.stringify(d.address) : null,
        itemsJson, totalCents, d.step || 1,
      ],
    );

    // Webhook de carrinho abandonado SÓ na criação do lead. No MySQL o upsert
    // devolve 1 quando insere e 2 quando atualiza — sem esse filtro o webhook
    // dispararia a cada tecla, já que o lead é salvo enquanto o cliente digita.
    // Vai em after() para não segurar a resposta do checkout.
    if (res.affectedRows === 1) {
      after(async () => {
        try {
          await notifyCartAbandoned(store.id, {
            id: leadId, name: d.name, email, phone: d.phone, totalCents,
          });
        } catch {
          /* nunca derruba o checkout */
        }
      });
    }

    // NADA de e-mail aqui. Enquanto o cliente preenche, ele não abandonou nada
    // — criar um envio neste momento encheria o Resend de e-mails que quase
    // sempre seriam cancelados depois, e bastaria UM cancelamento falhar para
    // quem comprou receber "você deixou algo no carrinho".
    // Quem dispara é a varredura em /api/live/beat, quando o carrinho fica
    // mesmo em silêncio.

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
