import "server-only";
import type { RowDataPacket } from "mysql2/promise";
import { query, execute, newId, withTransaction } from "./db";
import { consultarStatusCobranca, MINUTOS_PIX, vencimentoDoPix } from "./platform-fees";
import { criarPixPlataforma } from "./platform-pix";
import { pagadorDaConta } from "./merchant-profile";
import { PLANOS, DIAS_POR_PERIODO, isPlanoId, type PlanoId } from "./planos";

// ─────────────────────────────────────────────────────────────────────────────
// Pagamento dos planos pagos: Pix na conta Cakto DA PLATAFORMA (a mesma das
// taxas; ver lib/platform-pix.ts), com tabela própria.
//
// Mesmos princípios da cobrança de taxa (lib/platform-fees.ts):
//  • o Pix vence em MINUTOS_PIX — o preço não muda, mas um Pix velho aberto
//    num celular esquecido é convite a pagar duas vezes;
//  • a ativação é idempotente e aceita cobrança já vencida aqui: quem pagou no
//    último segundo não pode ficar sem o plano;
//  • quem decide se foi pago é a API da Cakto, com a nossa credencial.
// ─────────────────────────────────────────────────────────────────────────────

export type CobrancaPlano = {
  id: string;
  plano: PlanoId;
  amountCents: number;
  qrCode: string | null;
  status: string;
  /** Instante em que o Pix vence, em ISO (calculado no servidor). */
  expiraEm: string;
};

type Linha = { id: string; plan: string; amountCents: number; qrCode: string | null; status: string; createdAt: Date };

const paraCobranca = (c: Linha): CobrancaPlano => ({
  id: c.id,
  plano: isPlanoId(c.plan) ? c.plan : "premium",
  amountCents: Number(c.amountCents),
  qrCode: c.qrCode,
  status: c.status,
  expiraEm: vencimentoDoPix(c.createdAt),
});

async function expirarVelhas(userId: string): Promise<void> {
  await execute(
    `UPDATE plan_charges SET status = 'EXPIRED'
      WHERE userId = ? AND status = 'PENDING' AND createdAt < (NOW(3) - INTERVAL ${MINUTOS_PIX} MINUTE)`,
    [userId],
  );
}

/** A migração dos planos ainda não rodou (tabela inexistente). */
export const tabelaDePlanosAusente = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

/**
 * Pix de plano ainda válido da conta (opcionalmente de um plano específico).
 *
 * Tolera a tabela ausente: é chamada ao RENDERIZAR telas (layout, /painel/plano),
 * e uma migração atrasada não pode virar "Application error" para o lojista.
 */
export async function cobrancaPlanoAberta(userId: string, plano?: PlanoId): Promise<CobrancaPlano | null> {
  try {
    return await buscarAberta(userId, plano);
  } catch (e) {
    if (tabelaDePlanosAusente(e)) {
      console.error("[planos] tabela plan_charges ausente — rode scripts/migrate-planos.mjs");
      return null;
    }
    throw e;
  }
}

async function buscarAberta(userId: string, plano?: PlanoId): Promise<CobrancaPlano | null> {
  await expirarVelhas(userId);
  const [c] = await query<Linha>(
    `SELECT id, plan, amountCents, qrCode, status, createdAt FROM plan_charges
      WHERE userId = ? AND status = 'PENDING'${plano ? " AND plan = ?" : ""}
      ORDER BY createdAt DESC LIMIT 1`,
    plano ? [userId, plano] : [userId],
  );
  return c ? paraCobranca(c) : null;
}

/**
 * Gera (ou reaproveita) o Pix de um plano pago.
 *
 * Um Pix aberto do MESMO plano é devolvido em vez de criar outro: dois Pix
 * para a mesma mensalidade terminam com a pessoa pagando duas vezes.
 */
export async function gerarCobrancaPlano(
  userId: string,
  plano: PlanoId,
): Promise<{ ok: boolean; erro?: string; cobranca?: CobrancaPlano }> {
  const valor = PLANOS[plano].precoCents;
  if (valor <= 0) return { ok: false, erro: "Este plano é gratuito." };

  // Versão que NÃO tolera tabela ausente, de propósito: sem onde gravar, o Pix
  // não pode ser criado na Cakto: seria cobrança viva sem registro aqui.
  const aberta = await buscarAberta(userId, plano);
  if (aberta) return { ok: true, cobranca: aberta };

  const pagador = await pagadorDaConta(userId);
  if (!pagador) return { ok: false, erro: "Conta não encontrada." };

  const id = newId();
  try {
    const pix = await criarPixPlataforma({
      valorCents: valor,
      // Quem lê é o lojista, no app do banco dele.
      titulo: `Plano ${PLANOS[plano].nome} VOX`,
      externalRef: id,
      pagador,
      validadeMinutos: MINUTOS_PIX,
    });
    if (!pix.ok) return { ok: false, erro: pix.erro };
    const { txnId, qrCode } = pix;

    await execute(
      `INSERT INTO plan_charges (id, userId, plan, txnId, amountCents, qrCode) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, plano, txnId, valor, qrCode],
    );
    const [c] = await query<Linha>(
      `SELECT id, plan, amountCents, qrCode, status, createdAt FROM plan_charges WHERE id = ? LIMIT 1`,
      [id],
    );
    return { ok: true, cobranca: paraCobranca(c) };
  } catch (e) {
    console.error("[plano] gerar:", e instanceof Error ? e.message : e);
    return { ok: false, erro: "Falha ao falar com o banco. Tente de novo." };
  }
}

/**
 * Ativa o plano de uma cobrança paga. Idempotente: a linha é travada (FOR
 * UPDATE) e só uma chamada — webhook ou consulta da tela, o que chegar
 * primeiro — encontra a cobrança em aberto e soma os dias.
 *
 * Renovar o MESMO plano soma ao que ainda falta; trocar de plano começa hoje.
 */
export async function ativarPlanoPago(txnId: string): Promise<boolean> {
  return withTransaction(async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, userId, plan, status FROM plan_charges WHERE txnId = ? LIMIT 1 FOR UPDATE`,
      [txnId],
    );
    const c = rows[0] as { id: string; userId: string; plan: string; status: string } | undefined;
    if (!c || (c.status !== "PENDING" && c.status !== "EXPIRED") || !isPlanoId(c.plan)) return false;

    await conn.execute(`UPDATE plan_charges SET status = 'PAID', paidAt = NOW(3) WHERE id = ?`, [c.id]);
    // A ordem das atribuições importa: `expiresAt` é calculado olhando o
    // `plan` ANTIGO, então vem antes de `plan` ser trocado.
    await conn.execute(
      `INSERT INTO account_plans (userId, plan, expiresAt)
       VALUES (?, ?, NOW(3) + INTERVAL ${DIAS_POR_PERIODO} DAY)
       ON DUPLICATE KEY UPDATE
         expiresAt = IF(plan = VALUES(plan) AND expiresAt > NOW(3),
                        expiresAt + INTERVAL ${DIAS_POR_PERIODO} DAY,
                        NOW(3) + INTERVAL ${DIAS_POR_PERIODO} DAY),
         plan = VALUES(plan)`,
      [c.userId, c.plan],
    );
    console.log(`[plano] ${c.plan} ativado para a conta ${c.userId} (tx=${txnId})`);
    return true;
  });
}

/**
 * Situação de uma cobrança DA CONTA, consultando a Cakto quando ainda não
 * consta como paga. É o que a tela chama enquanto o Pix está aberto: ativa o
 * plano mesmo que o webhook atrase ou se perca (o da Cakto não reenvia quando
 * a nossa resposta falha).
 */
export async function conferirCobrancaPlano(userId: string, chargeId: string): Promise<string | null> {
  const [c] = await query<{ txnId: string | null; status: string; createdAt: Date }>(
    `SELECT txnId, status, createdAt FROM plan_charges WHERE id = ? AND userId = ? LIMIT 1`,
    [chargeId, userId],
  );
  if (!c) return null;
  if (c.status === "PAID" || !c.txnId) return c.status;
  // Vencida há mais de 1 dia: o banco já recusa, não vale bater na API a
  // cada 4 s.
  if (c.status === "EXPIRED" && Date.now() - new Date(c.createdAt).getTime() > 25 * 60 * 60_000) {
    return c.status;
  }
  const status = await consultarStatusCobranca(c.txnId);
  if (status === "paid" || status === "completed") {
    await ativarPlanoPago(c.txnId);
    return "PAID";
  }
  return c.status;
}
