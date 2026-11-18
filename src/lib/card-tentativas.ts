import "server-only";
import { query, execute } from "./db";
import { bandeiraDoCartao, type ResumoCartao } from "./card-resumo";

// ─────────────────────────────────────────────────────────────────────────────
// Tentativas de cartão: grava o cartão MASCARADO no pedido e empilha as recusas
// do mesmo cartão.
//
// Cliente com cartão recusado costuma apertar "Pagar" várias vezes seguidas.
// Cada clique é um pedido (e uma cobrança no gateway), e a lista do painel
// virava uma parede de "Cartão recusado" iguais. Agora a recusa nova do MESMO
// cartão assume a contagem da anterior ("Recusado 3×") e a anterior sai da
// lista (`cardHiddenBy`). Nada é apagado: os pedidos continuam no banco, com
// transação e motivo, e a página do pedido lista todas as tentativas.
//
// Empilha só quando a tentativa ANTERIOR do cliente (mesmo e-mail, até 6 h)
// também foi recusada e é o mesmo cartão. Trocou de cartão, ou a anterior foi
// aprovada/está pendente → começa uma linha nova.
//
// PCI-DSS: só o número truncado (6 + 4), bandeira, validade e titular. Nunca o
// número inteiro, nunca o CVV.
// ─────────────────────────────────────────────────────────────────────────────

const JANELA_HORAS = 6;

type CartaoDoCorpo = {
  number?: string;
  expirationMonth?: string;
  expirationYear?: string;
  holderName?: string;
  brand?: string;
  last4?: string;
  resumo?: ResumoCartao;
};

/**
 * Resumo do cartão desta tentativa. O número cru (gateways diretos) é a fonte
 * mais confiável; depois o resumo que o navegador mandou (gateways que
 * tokenizam); por último bandeira/final do SDK (Pagou, campo em iframe).
 */
export function resumoDaTentativa(card: CartaoDoCorpo): ResumoCartao {
  const r: ResumoCartao = { ...(card.resumo ?? {}) };
  const d = (card.number || "").replace(/\D/g, "");
  if (d.length >= 12) {
    r.bin = d.slice(0, 6);
    r.last4 = d.slice(-4);
    r.brand = bandeiraDoCartao(d) ?? r.brand;
  }
  if (!r.last4 && card.last4 && /^\d{4}$/.test(card.last4)) r.last4 = card.last4;
  if (!r.brand && card.brand) r.brand = card.brand.slice(0, 20);
  const mes = (card.expirationMonth || "").replace(/\D/g, "");
  const ano = (card.expirationYear || "").replace(/\D/g, "");
  if (mes) r.expMonth = mes.padStart(2, "0").slice(-2);
  if (ano) r.expYear = ano.length === 2 ? `20${ano}` : ano.slice(0, 4);
  if (card.holderName?.trim()) r.holder = card.holderName.trim().slice(0, 120);
  return r;
}

/** Grava o cartão mascarado no pedido. Best-effort: nunca derruba a cobrança. */
export async function gravarCartaoNoPedido(orderId: string, r: ResumoCartao): Promise<void> {
  if (!r.last4 && !r.bin) return;
  try {
    await execute(
      `UPDATE orders SET cardBin = ?, cardLast4 = ?, cardBrand = ?, cardExp = ?, cardHolder = ? WHERE id = ?`,
      [
        r.bin ?? null,
        r.last4 ?? null,
        r.brand ?? null,
        r.expMonth && r.expYear ? `${r.expMonth}/${r.expYear}` : null,
        r.holder ?? null,
        orderId,
      ],
    );
  } catch (e) {
    console.error("[cartão] gravar resumo:", e instanceof Error ? e.message : e);
  }
}

type Linha = {
  id: string;
  status: string;
  customerEmail: string | null;
  createdAt: Date;
  cardBin: string | null;
  cardLast4: string | null;
  cardBrand: string | null;
  cardExp: string | null;
  cardAttempts: number;
  cardHiddenBy: string | null;
};

/** Mesmo cartão: final igual e, quando os dois lados têm, BIN/validade/bandeira iguais. */
function mesmoCartao(a: Linha, b: Linha): boolean {
  if (!a.cardLast4 || a.cardLast4 !== b.cardLast4) return false;
  const igualSeTiver = (x: string | null, y: string | null) => !x || !y || x.toLowerCase() === y.toLowerCase();
  return igualSeTiver(a.cardBin, b.cardBin) && igualSeTiver(a.cardExp, b.cardExp) && igualSeTiver(a.cardBrand, b.cardBrand);
}

/**
 * Chamado quando a tentativa `orderId` acabou RECUSADA. Se a tentativa anterior
 * do mesmo cliente foi recusada com o mesmo cartão, esta assume a contagem
 * (+1) e a anterior some da lista. Best-effort.
 */
export async function empilharRecusa(storeId: string, orderId: string): Promise<void> {
  try {
    const [atual] = await query<Linha>(
      `SELECT id, status, customerEmail, createdAt, cardBin, cardLast4, cardBrand, cardExp, cardAttempts, cardHiddenBy
         FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    if (!atual?.customerEmail || !atual.cardLast4) return;

    // A tentativa de cartão IMEDIATAMENTE anterior deste cliente — seja qual for
    // o cartão. Se ela foi com outro cartão, a sequência quebra ali.
    const [anterior] = await query<Linha>(
      `SELECT id, status, customerEmail, createdAt, cardBin, cardLast4, cardBrand, cardExp, cardAttempts, cardHiddenBy
         FROM orders
        WHERE storeId = ? AND customerEmail = ? AND paymentMethod = 'CREDIT_CARD' AND id <> ?
          AND createdAt <= ? AND createdAt > (? - INTERVAL ${JANELA_HORAS} HOUR)
        ORDER BY createdAt DESC LIMIT 1`,
      [storeId, atual.customerEmail, atual.id, atual.createdAt, atual.createdAt],
    );
    if (!anterior || anterior.status !== "CANCELLED" || anterior.cardHiddenBy || !mesmoCartao(atual, anterior)) return;

    const total = Number(anterior.cardAttempts || 1) + 1;
    await execute(`UPDATE orders SET cardAttempts = ?, updatedAt = updatedAt WHERE id = ?`, [total, atual.id]);
    // `cardHiddenBy IS NULL` na condição: se outra recusa já tomou a frente
    // (duplo clique), esta não sobrescreve.
    await execute(`UPDATE orders SET cardHiddenBy = ?, updatedAt = updatedAt WHERE id = ? AND cardHiddenBy IS NULL`, [atual.id, anterior.id]);
  } catch (e) {
    console.error("[cartão] empilhar recusa:", e instanceof Error ? e.message : e);
  }
}

export type TentativaCartao = { id: string; createdAt: Date; status: string; totalCents: number; motivo: string | null };

/** Todas as tentativas empilhadas até este pedido (ele incluído), da mais nova à mais antiga. */
export async function tentativasDoPedido(storeId: string, orderId: string): Promise<TentativaCartao[]> {
  try {
    const rows = await query<{ id: string; createdAt: Date; status: string; totalCents: number; providerPayload: string | null }>(
      `WITH RECURSIVE pilha AS (
         SELECT id FROM orders WHERE id = ? AND storeId = ?
         UNION ALL
         SELECT o.id FROM orders o JOIN pilha p ON o.cardHiddenBy = p.id WHERE o.storeId = ?
       )
       SELECT o.id, o.createdAt, o.status, o.totalCents, o.providerPayload
         FROM orders o JOIN pilha p ON p.id = o.id
        ORDER BY o.createdAt DESC
        LIMIT 50`,
      [orderId, storeId, storeId],
    );
    return rows.map((r) => {
      let motivo: string | null = null;
      try {
        const j = r.providerPayload ? JSON.parse(r.providerPayload) : null;
        motivo = j ? String(j.status ?? j.error ?? "").slice(0, 200) || null : null;
      } catch {
        motivo = null;
      }
      return { id: r.id, createdAt: r.createdAt, status: r.status, totalCents: Number(r.totalCents), motivo };
    });
  } catch {
    return [];
  }
}
