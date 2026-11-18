import { requireStore } from "@/lib/stores";
import { query, execute } from "@/lib/db";
import { json, handleError } from "@/lib/http";

// GET /api/painel/live -> visitantes ao vivo da loja ativa (últimos ~45s).
// Limpa oportunisticamente linhas antigas (> 15 min).
export async function GET() {
  try {
    const { store } = await requireStore();

    // Limpa sessões paradas (sem bater há >15min). NÃO apagamos as que ainda
    // batem: o filtro de createdAt (abaixo) já exclui do count as abas esquecidas
    // — e apagá-las faria o próximo beat re-inserir com createdAt novo (voltariam
    // a contar). Assim o createdAt do fantasma fica velho e ele some pra sempre.
    await execute(
      `DELETE FROM live_sessions WHERE storeId = ? AND updatedAt < DATE_SUB(NOW(3), INTERVAL 15 MINUTE)`,
      [store.id],
    );

    // "Online agora": bateu nos últimos 45s E a sessão começou há no máx 30 min.
    // Um comprador real não fica horas no checkout — o teto de 30 min derruba as
    // abas esquecidas que batem o dia inteiro (o createdAt não muda no beat).
    const rows = await query<{ scope: string; step: number; state: string | null; city: string | null }>(
      `SELECT scope, step, state, city FROM live_sessions
       WHERE storeId = ?
         AND updatedAt > DATE_SUB(NOW(3), INTERVAL 45 SECOND)
         AND createdAt > DATE_SUB(NOW(3), INTERVAL 30 MINUTE)`,
      [store.id],
    );

    const online = rows.length;
    const loja = rows.filter((r) => r.scope === "store").length;
    const checkout = rows.filter((r) => r.scope === "checkout").length;

    // Funil (passo máximo alcançado): dados=1, endereço=2, pagamento=3, comprou=4.
    const funnel = {
      dados: rows.filter((r) => r.step >= 1).length,
      endereco: rows.filter((r) => r.step >= 2).length,
      pagamento: rows.filter((r) => r.step >= 3).length,
      comprou: rows.filter((r) => r.step >= 4).length,
    };

    const countBy = (key: "state" | "city") => {
      const map = new Map<string, number>();
      for (const r of rows) {
        const v = r[key];
        if (v) map.set(v, (map.get(v) ?? 0) + 1);
      }
      return [...map.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
    };

    const visitors = rows.map((r) => ({
      city: r.city,
      state: r.state,
      scope: r.scope,
      step: r.step,
    }));

    return json({ online, loja, checkout, funnel, states: countBy("state"), cities: countBy("city"), visitors });
  } catch (err) {
    return handleError(err);
  }
}
