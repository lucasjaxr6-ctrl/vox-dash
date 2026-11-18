import "server-only";
import { query, execute, newId, withTransaction } from "./db";
import { PLANOS, PLANOS_IDS, isPlanoId, type PlanoId } from "./planos";

// ─────────────────────────────────────────────────────────────────────────────
// Plano da CONTA (Basic / Premium / Enterprise).
//
// Mora por conta, não por loja: o limite de domínios conta as lojas da mesma
// conta, e uma pessoa com três lojas paga um plano, não três.
//
// O plano que VALE é derivado na leitura, nunca marcado por rotina: plano pago
// vencido vale como Basic na hora, sem depender de cron. Vencer não congela
// nada — a loja segue vendendo, só volta para a taxa e os limites do Basic.
// ─────────────────────────────────────────────────────────────────────────────

export type PlanoDaConta = {
  /** A conta já passou pela escolha (ou foi migrada para o Basic). */
  escolhido: boolean;
  /** Plano em vigor agora. Pago vencido = Basic. */
  plano: PlanoId;
  /** Plano contratado, mesmo que vencido. Null antes da escolha. */
  contratado: PlanoId | null;
  expiraEm: Date | null;
  /** Contratou um plano pago e o período acabou. */
  vencido: boolean;
};

const SEM_ESCOLHA: PlanoDaConta = { escolhido: false, plano: "basic", contratado: null, expiraEm: null, vencido: false };

/**
 * Migração ainda não rodou. O painel tem que seguir como era (Basic, sem tela
 * de planos) em vez de cair para todos os lojistas por causa de uma tabela.
 */
const tabelaAusente = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";
const SEM_TABELA: PlanoDaConta = { escolhido: true, plano: "basic", contratado: "basic", expiraEm: null, vencido: false };

function interpretar(r: { plan: string | null; expiresAt: Date | string | null } | undefined): PlanoDaConta {
  if (!r?.plan) return SEM_ESCOLHA;
  const contratado: PlanoId = isPlanoId(r.plan) ? r.plan : "basic";
  const expiraEm = r.expiresAt ? new Date(r.expiresAt) : null;
  const pago = PLANOS[contratado].precoCents > 0;
  const vencido = pago && (!expiraEm || expiraEm.getTime() <= Date.now());
  return { escolhido: true, plano: vencido ? "basic" : contratado, contratado, expiraEm, vencido };
}

export async function planoDaConta(userId: string): Promise<PlanoDaConta> {
  try {
    const [r] = await query<{ plan: string; expiresAt: Date | null }>(
      `SELECT plan, expiresAt FROM account_plans WHERE userId = ? LIMIT 1`,
      [userId],
    );
    return interpretar(r);
  } catch (e) {
    if (tabelaAusente(e)) {
      console.error("[planos] tabela account_plans ausente — rode scripts/migrate-planos.mjs");
      return SEM_TABELA;
    }
    throw e;
  }
}

/** Plano em vigor do DONO da loja. Uma consulta só: roda a cada venda aprovada. */
export async function planoDaLoja(storeId: string): Promise<PlanoDaConta> {
  try {
    const [r] = await query<{ plan: string | null; expiresAt: Date | null }>(
      `SELECT p.plan, p.expiresAt
         FROM stores s LEFT JOIN account_plans p ON p.userId = s.ownerUserId
        WHERE s.id = ? LIMIT 1`,
      [storeId],
    );
    return interpretar(r);
  } catch (e) {
    if (tabelaAusente(e)) return SEM_TABELA;
    throw e;
  }
}

/**
 * Taxa por pedido do plano da loja, ou null quando vale a padrão da plataforma
 * (Basic, ou conta que ainda não escolheu).
 */
export async function pctDoPlanoDaLoja(storeId: string): Promise<{ pct: number | null; recoveryPct: number }> {
  const p = PLANOS[(await planoDaLoja(storeId)).plano];
  return { pct: p.pct, recoveryPct: p.recoveryPct };
}

/**
 * A mesma regra de `pctDoPlanoDaLoja` em SQL, para o preenchimento em lote das
 * taxas. Gerada a partir de PLANOS para as duas portas de entrada nunca
 * discordarem do percentual. NULL = segue a padrão da plataforma.
 *
 * Replica `interpretar`: plano pago vencido vale como Basic, e conta sem linha
 * em account_plans também é Basic.
 *
 * `storeIdCol` é uma coluna do SQL de quem chama (nunca entrada do usuário).
 */
export function sqlPctDoPlano(storeIdCol: string, campo: "pct" | "recoveryPct" = "pct"): string {
  const valor = (id: PlanoId) => PLANOS[id][campo];
  const casos = PLANOS_IDS.filter((id) => valor(id) !== null)
    .map((id) => `WHEN '${id}' THEN ${Number(valor(id))}`)
    .join(" ");
  if (!casos) return "NULL";
  const pagos = PLANOS_IDS.filter((id) => PLANOS[id].precoCents > 0)
    .map((id) => `'${id}'`)
    .join(",");
  const emVigor = pagos
    ? `(CASE WHEN p.plan IN (${pagos}) AND (p.expiresAt IS NULL OR p.expiresAt <= NOW(3)) THEN 'basic' ELSE p.plan END)`
    : "p.plan";
  const doPlano = `(SELECT CASE ${emVigor} ${casos} END
             FROM stores s JOIN account_plans p ON p.userId = s.ownerUserId
            WHERE s.id = ${storeIdCol} LIMIT 1)`;
  const basic = valor("basic");
  return basic === null ? doPlano : `COALESCE(${doPlano}, ${Number(basic)})`;
}

/** Coloca a conta no Basic (sem vencimento). */
export async function ativarBasic(userId: string): Promise<void> {
  await execute(
    `INSERT INTO account_plans (userId, plan, expiresAt) VALUES (?, 'basic', NULL)
     ON DUPLICATE KEY UPDATE plan = 'basic', expiresAt = NULL`,
    [userId],
  );
}

/**
 * A loja pode ganhar um domínio próprio?
 *
 * Conta as OUTRAS lojas da conta que já têm domínio. Trocar o domínio de uma
 * loja que já tem um nunca é barrado — não aumenta o uso. E quem já passou do
 * limite antes dos planos existirem mantém o que tem: só não adiciona mais.
 */
export async function limiteDeDominios(
  storeId: string,
): Promise<{ ok: boolean; usados: number; limite: number; plano: PlanoId }> {
  const { plano } = await planoDaLoja(storeId);
  const limite = PLANOS[plano].dominios;
  const [r] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM store_settings ss JOIN stores s ON s.id = ss.storeId
      WHERE s.ownerUserId = (SELECT ownerUserId FROM stores WHERE id = ? LIMIT 1)
        AND ss.storeId <> ?
        AND ss.customDomain IS NOT NULL AND ss.customDomain <> ''`,
    [storeId, storeId],
  );
  const usados = Number(r?.n ?? 0);
  return { ok: usados < limite, usados, limite, plano };
}

// ── Admin ───────────────────────────────────────────────────────────────────

/** Teto de dias que o admin pode conceder de uma vez (10 anos). */
export const MAX_DIAS_ADMIN = 3650;

/**
 * O ADMIN define o plano de uma conta. Pago: vale por `dias` a partir de agora
 * (substitui a validade atual — o admin vê a data final antes de salvar).
 * Basic: sem vencimento.
 *
 * Fica registrado em `plan_charges` com status ADMIN e valor zero: é o
 * histórico da assinatura, e a tela de Assinaturas mostra a origem do plano
 * (Pix ou concedido pelo admin) a partir dele. Status ADMIN nunca é olhado
 * pelo fluxo de Pix (que só mexe em PENDING/EXPIRED), então não há risco de
 * esta linha ser "quitada" ou expirada por engano.
 */
export async function definirPlanoPeloAdmin(userId: string, plano: PlanoId, dias: number): Promise<void> {
  const pago = PLANOS[plano].precoCents > 0;
  const d = Math.min(MAX_DIAS_ADMIN, Math.max(1, Math.round(dias)));
  await withTransaction(async (conn) => {
    if (pago) {
      await conn.execute(
        `INSERT INTO account_plans (userId, plan, expiresAt) VALUES (?, ?, NOW(3) + INTERVAL ${d} DAY)
         ON DUPLICATE KEY UPDATE plan = VALUES(plan), expiresAt = VALUES(expiresAt)`,
        [userId, plano],
      );
    } else {
      await conn.execute(
        `INSERT INTO account_plans (userId, plan, expiresAt) VALUES (?, 'basic', NULL)
         ON DUPLICATE KEY UPDATE plan = 'basic', expiresAt = NULL`,
        [userId],
      );
    }
    await conn.execute(
      `INSERT INTO plan_charges (id, userId, plan, txnId, amountCents, qrCode, status, paidAt)
       VALUES (?, ?, ?, NULL, 0, NULL, 'ADMIN', NOW(3))`,
      [newId(), userId, plano],
    );
  });
}

export type Assinatura = {
  userId: string;
  nome: string | null;
  email: string;
  lojas: number;
  /** Plano contratado (null = ainda não escolheu). */
  contratado: PlanoId | null;
  /** Plano em vigor agora (pago vencido = basic). */
  plano: PlanoId;
  expiraEm: Date | null;
  vencido: boolean;
  /** Dias até vencer (negativo = venceu há N dias). Null sem vencimento. */
  diasRestantes: number | null;
  /** Total pago em Pix de plano. */
  pagoCents: number;
  /** Origem da última ativação: Pix ou concedido pelo admin. */
  origem: "pix" | "admin" | null;
  ultimaAtivacao: Date | null;
};

/** Todas as contas de lojista com a situação da assinatura — a aba do admin. */
export async function listarAssinaturas(): Promise<Assinatura[]> {
  const rows = await query<{
    id: string;
    name: string | null;
    email: string;
    plan: string | null;
    expiresAt: Date | null;
    lojas: number;
    pagoCents: number;
    origem: string | null;
    ultima: Date | null;
  }>(
    `SELECT u.id, u.name, u.email, p.plan, p.expiresAt,
            (SELECT COUNT(*) FROM stores s WHERE s.ownerUserId = u.id) AS lojas,
            (SELECT COALESCE(SUM(c.amountCents), 0) FROM plan_charges c
              WHERE c.userId = u.id AND c.status = 'PAID') AS pagoCents,
            (SELECT c.status FROM plan_charges c
              WHERE c.userId = u.id AND c.status IN ('PAID','ADMIN')
              ORDER BY c.paidAt DESC LIMIT 1) AS origem,
            (SELECT MAX(c.paidAt) FROM plan_charges c
              WHERE c.userId = u.id AND c.status IN ('PAID','ADMIN')) AS ultima
       FROM users u
       LEFT JOIN account_plans p ON p.userId = u.id
      WHERE u.role IN ('MERCHANT','ADMIN')`,
  );
  return rows.map((r) => {
    const st = interpretar(r);
    const diasRestantes = st.expiraEm ? Math.ceil((st.expiraEm.getTime() - Date.now()) / 86_400_000) : null;
    return {
      userId: r.id,
      nome: r.name,
      email: r.email,
      lojas: Number(r.lojas ?? 0),
      contratado: st.contratado,
      plano: st.plano,
      expiraEm: st.expiraEm,
      vencido: st.vencido,
      diasRestantes: PLANOS[st.contratado ?? "basic"].precoCents > 0 ? diasRestantes : null,
      pagoCents: Number(r.pagoCents ?? 0),
      origem: r.origem === "PAID" ? "pix" : r.origem === "ADMIN" ? "admin" : null,
      ultimaAtivacao: r.ultima ? new Date(r.ultima) : null,
    };
  });
}

/** Lojas da conta com domínio configurado — para o cartão do plano. */
export async function dominiosEmUso(userId: string): Promise<number> {
  const [r] = await query<{ n: number }>(
    `SELECT COUNT(*) AS n
       FROM store_settings ss JOIN stores s ON s.id = ss.storeId
      WHERE s.ownerUserId = ? AND ss.customDomain IS NOT NULL AND ss.customDomain <> ''`,
    [userId],
  );
  return Number(r?.n ?? 0);
}
