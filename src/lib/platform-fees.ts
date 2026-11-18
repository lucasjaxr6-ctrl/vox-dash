import "server-only";
import { query, execute, newId } from "./db";
import { criarPixPlataforma, consultarPixPlataforma, ehTxnConsultavel, minimoPixPlataforma } from "./platform-pix";
import { pagadorDaConta } from "./merchant-profile";
import { VENDA_RECUPERADA } from "./abandoned-carts";
import { pctDoPlanoDaLoja, sqlPctDoPlano } from "./plans";

// ─────────────────────────────────────────────────────────────────────────────
// Taxa da plataforma.
//
// Cada venda aprovada gera uma linha em `platform_fees` com a % vigente. O
// saldo em aberto do lojista é a soma das linhas PENDING; quitar é gerar um Pix
// na conta Cakto DA VOX e, quando ele for pago, virar as linhas para PAID.
//
// Princípios que valem para tudo neste arquivo, porque aqui se mexe com o
// dinheiro que o lojista deve:
//
// • IDEMPOTÊNCIA acima de tudo. O webhook de pagamento repete de propósito e a
//   conciliação roda a cada 5 minutos. A gravação da taxa é INSERT IGNORE sobre
//   UNIQUE(orderId): rodar mil vezes dá o mesmo resultado que rodar uma.
//
// • NUNCA derruba a venda. Registrar taxa é assunto nosso; se falhar, o pedido
//   do comprador segue normalmente e o erro vai para o log.
//
// • Sem retroatividade. Só conta venda aprovada depois de `feeStartedAt`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Meia-noite de HOJE no Brasil, expressa na hora do banco (UTC).
 *
 * Mesma convenção do resto do painel (ver lib/admin.ts): o banco guarda UTC e
 * o lojista raciocina em -03:00. Sem a conversão, entre 21h e 00h o "hoje" do
 * banco já é o dia seguinte e a conta sairia do dia errado.
 */
const INICIO_DE_HOJE_BR = `CONVERT_TZ(CONCAT(DATE(CONVERT_TZ(NOW(3),'+00:00','-03:00')),' 00:00:00'),'-03:00','+00:00')`;

export type FeeConfig = {
  /** Percentual PADRÃO da plataforma (ex.: 2.5). Cada loja pode ter o seu. */
  pct: number;
  /** Percentual das vendas RECUPERADAS (ex.: 5). */
  recoveryPct: number;
  /**
   * A partir de quando as vendas contam.
   *
   * NÃO é interruptor — a cobrança é sempre ativa. É um marco: sem ele, um
   * pedido antigo reconciliado semanas depois (o cron roda a cada 5 min)
   * geraria taxa retroativa de uma venda que nunca foi combinada.
   */
  startedAt: Date;
};

/**
 * Config da plataforma, garantindo o marco de início.
 *
 * Se ainda não existe, o marco nasce na meia-noite de HOJE no Brasil — a
 * mesma regra que o dono pediu: tudo que foi vendido hoje conta. A escrita
 * acontece no máximo uma vez na vida da instalação.
 */
export async function getFeeConfig(): Promise<FeeConfig> {
  const ler = () =>
    query<{ feePct: string | number | null; feeRecoveryPct: string | number | null; feeStartedAt: Date | null }>(
      `SELECT feePct, feeRecoveryPct, feeStartedAt FROM platform_settings WHERE id = 1 LIMIT 1`,
    );

  let rows = await ler();
  if (!rows[0]?.feeStartedAt) {
    await execute(`INSERT IGNORE INTO platform_settings (id) VALUES (1)`);
    await execute(
      `UPDATE platform_settings SET feeStartedAt = ${INICIO_DE_HOJE_BR} WHERE id = 1 AND feeStartedAt IS NULL`,
    );
    rows = await ler();
  }

  const pct = Number(rows[0]?.feePct ?? 2.5);
  const rec = Number(rows[0]?.feeRecoveryPct ?? 5);
  return {
    pct: Number.isFinite(pct) ? pct : 2.5,
    recoveryPct: Number.isFinite(rec) ? rec : 5,
    // O fallback nunca deveria acontecer (acabamos de gravar), mas um tipo
    // opcional aqui contaminaria todo o resto do arquivo com checagens.
    startedAt: rows[0]?.feeStartedAt ?? new Date(),
  };
}

/** Percentuais PADRÃO, aplicados a quem não tem taxa individual. */
export async function salvarFeeConfig(input: { pct?: number; recoveryPct?: number }): Promise<void> {
  const sets: string[] = [];
  const params: number[] = [];
  // Teto de 100 e piso de 0: um valor absurdo aqui vira cobrança absurda.
  const limitar = (v: number) => Math.min(100, Math.max(0, v));
  if (typeof input.pct === "number" && Number.isFinite(input.pct)) {
    sets.push("feePct = ?");
    params.push(limitar(input.pct));
  }
  if (typeof input.recoveryPct === "number" && Number.isFinite(input.recoveryPct)) {
    sets.push("feeRecoveryPct = ?");
    params.push(limitar(input.recoveryPct));
  }
  if (!sets.length) return;
  await execute(`INSERT IGNORE INTO platform_settings (id) VALUES (1)`);
  await execute(`UPDATE platform_settings SET ${sets.join(", ")} WHERE id = 1`, params);
}

/**
 * O pedido veio de RECUPERAÇÃO (Pix não pago ou carrinho abandonado)?
 *
 * Usa a MESMA regra de atribuição do painel do lojista
 * (lib/abandoned-carts.ts: janela de RECOVERY_ATTRIBUTION_HOURS). Inventar um
 * critério próprio aqui seria pior que não ter: o lojista veria "10 vendas
 * recuperadas" numa tela e seria cobrado por 12 na outra, e a conta perderia
 * a credibilidade inteira.
 *
 * Para a TAXA não importa qual dos dois baldes creditou a venda — Pix e
 * carrinho custam o mesmo. A precedência do Pix, que existe lá para não contar
 * a mesma venda duas vezes, aqui é irrelevante: é um pedido, uma taxa.
 */
export async function pedidoRecuperado(orderId: string): Promise<boolean> {
  const [r] = await query<{ recuperado: number }>(
    `SELECT ${VENDA_RECUPERADA} AS recuperado FROM orders o WHERE o.id = ? LIMIT 1`,
    [orderId],
  );
  return Number(r?.recuperado ?? 0) === 1;
}

// ── Taxa individual por lojista ──────────────────────────────────────────────
//
// Mora em tabela própria (`store_fee_rates`) e não em store_settings: aquela
// tabela está em ~97% do limite de linha do InnoDB, e uma coluna nova ali é
// risco desnecessário. Sem linha = vale o percentual padrão.

/**
 * Percentuais que valem para ESTA loja.
 *
 * Ordem: taxa individual (acordo feito pelo admin) > taxa do plano da conta >
 * padrão da plataforma.
 *
 * • Normal: o Basic não tem taxa própria — segue a padrão —, então quem foi
 *   migrado para ele não muda de percentual.
 * • Recuperação: todo plano tem a sua (Basic 10%, Premium 6%, Enterprise
 *   4,5% — lib/planos.ts), então a padrão da plataforma só sobra como reserva.
 */
export async function pctDaLoja(
  storeId: string,
): Promise<{ pct: number; recoveryPct: number; individual: boolean }> {
  const [r] = await query<{ pct: string | number | null; recoveryPct: string | number | null }>(
    `SELECT pct, recoveryPct FROM store_fee_rates WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const [padrao, doPlano] = await Promise.all([getFeeConfig(), pctDoPlanoDaLoja(storeId)]);
  const numero = (v: unknown, reserva: number) => {
    const n = Number(v);
    return v !== null && v !== undefined && Number.isFinite(n) ? n : reserva;
  };
  return {
    pct: numero(r?.pct, doPlano.pct ?? padrao.pct),
    // A taxa de recuperação da loja é independente: dá para negociar a normal
    // e manter a de recuperação no plano, e vice-versa.
    recoveryPct: numero(r?.recoveryPct, doPlano.recoveryPct ?? padrao.recoveryPct),
    individual: Boolean(r),
  };
}

/**
 * Define as taxas individuais de uma loja.
 *
 * Cada campo é independente e tem três estados:
 *   • `undefined` — não mexe (permite editar uma taxa sem apagar a outra);
 *   • `null`      — volta ao padrão da plataforma;
 *   • número      — taxa própria.
 *
 * Quando as duas voltam ao padrão, a linha é REMOVIDA: guardar uma linha de
 * "nenhuma exceção" faria a loja parecer ter acordo próprio na listagem.
 *
 * Gravar o padrão vigente no lugar de NULL seria pior que inútil: congelaria a
 * loja no valor de hoje, e ela deixaria de acompanhar a mudança do padrão.
 */
export async function salvarPctDaLoja(
  storeId: string,
  pct?: number | null,
  recoveryPct?: number | null,
): Promise<void> {
  const limitar = (v: number | null) =>
    v === null || !Number.isFinite(v) ? null : Math.min(100, Math.max(0, v));

  const [atual] = await query<{ pct: string | number | null; recoveryPct: string | number | null }>(
    `SELECT pct, recoveryPct FROM store_fee_rates WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const manter = (v: string | number | null | undefined) =>
    v === null || v === undefined ? null : Number(v);

  const novoPct = pct === undefined ? manter(atual?.pct) : limitar(pct);
  const novoRec = recoveryPct === undefined ? manter(atual?.recoveryPct) : limitar(recoveryPct);

  if (novoPct === null && novoRec === null) {
    await execute(`DELETE FROM store_fee_rates WHERE storeId = ?`, [storeId]);
    return;
  }
  await execute(
    `INSERT INTO store_fee_rates (storeId, pct, recoveryPct) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE pct = VALUES(pct), recoveryPct = VALUES(recoveryPct)`,
    [storeId, novoPct, novoRec],
  );
}

/**
 * Registra a taxa de uma venda aprovada. Best-effort e idempotente.
 *
 * Busca o valor do próprio pedido em vez de recebê-lo pronto: a base é a mesma
 * do GMV que o admin já mostra (`totalCents`), então o lojista consegue
 * conferir a conta sozinho, e quem chama não tem como passar o número errado.
 */
export async function registrarTaxa(storeId: string, orderId: string): Promise<void> {
  try {
    const { startedAt } = await getFeeConfig();
    // Percentuais DESTA loja: os individuais quando existem, senão os padrão.
    const taxas = await pctDaLoja(storeId);

    const [pedido] = await query<{ totalCents: number; paidAt: Date | null; status: string }>(
      `SELECT totalCents, paidAt, status FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
      [orderId, storeId],
    );
    if (!pedido) return;
    if (pedido.status !== "PAID" && pedido.status !== "SHIPPED") return;

    // Sem retroatividade: venda paga ANTES de a cobrança ser ligada não gera
    // dívida. Vale também para reconciliação de pedido antigo, que roda a cada
    // 5 minutos e encostaria em venda de semanas atrás.
    if (startedAt && pedido.paidAt && new Date(pedido.paidAt) < new Date(startedAt)) return;

    const base = Math.max(0, Math.round(Number(pedido.totalCents ?? 0)));
    if (base <= 0) return;

    // Venda que voltou por e-mail de recuperação (Pix não pago ou carrinho)
    // paga a taxa maior — é serviço da plataforma que trouxe aquele dinheiro.
    const recuperado = await pedidoRecuperado(orderId);
    const pct = recuperado ? taxas.recoveryPct : taxas.pct;
    if (pct <= 0) return;

    // Arredonda para o centavo mais próximo. Meio centavo a mais numa venda de
    // R$ 100 é irrelevante; o que não pode é acumular viés ao longo de milhares.
    const feeCents = Math.round((base * pct) / 100);
    if (feeCents <= 0) return;

    await execute(
      `INSERT IGNORE INTO platform_fees (id, storeId, orderId, baseCents, ratePct, feeCents, recuperado)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), storeId, orderId, base, pct, feeCents, recuperado ? 1 : 0],
    );
  } catch (e) {
    console.error("[taxa] registrar:", e instanceof Error ? e.message : e);
  }
}

/**
 * Registra de uma vez as taxas das vendas já aprovadas desde o início da
 * cobrança — na prática, as de hoje.
 *
 * Existe porque ligar a cobrança às 15h não pode ignorar o que a loja vendeu
 * de manhã. Um INSERT..SELECT em vez de um laço: são centenas de pedidos por
 * dia, e a idempotência continua sendo o UNIQUE(orderId), então rodar duas
 * vezes não cobra duas vezes.
 *
 * ROUND do MySQL arredonda meio para cima em positivos, igual ao Math.round
 * que `registrarTaxa` usa — as duas portas de entrada dão o mesmo centavo.
 */
export async function backfillTaxas(): Promise<number> {
  const { pct, recoveryPct, startedAt } = await getFeeConfig();

  // A MESMA expressão que o card da dashboard usa — importada, não copiada.
  // Duas cópias da regra foi exatamente o que produziu a divergência anterior.
  const RECUPERADO = VENDA_RECUPERADA;

  // O percentual sai do JOIN, não de uma constante: cada loja pode ter o seu,
  // e uma taxa individual tem que valer também para as vendas preenchidas de
  // uma vez — senão a mesma loja teria linhas com percentuais diferentes no
  // mesmo dia sem motivo.
  // As duas taxas seguem a mesma ordem de `pctDaLoja`: individual > plano > padrão.
  const TAXA = `CASE WHEN ${RECUPERADO} THEN COALESCE(r.recoveryPct, ${sqlPctDoPlano("o.storeId", "recoveryPct")}, ?) ELSE COALESCE(r.pct, ${sqlPctDoPlano("o.storeId")}, ?) END`;
  const p = [recoveryPct, pct];
  const r = await execute(
    `INSERT IGNORE INTO platform_fees (id, storeId, orderId, baseCents, ratePct, feeCents, recuperado)
     SELECT UUID(), o.storeId, o.id, o.totalCents, ${TAXA}, ROUND(o.totalCents * (${TAXA}) / 100), ${RECUPERADO}
       FROM orders o
       LEFT JOIN store_fee_rates r ON r.storeId = o.storeId
      WHERE o.status IN ('PAID','SHIPPED')
        AND o.paidAt IS NOT NULL
        AND o.paidAt >= ?
        AND o.totalCents > 0
        AND ROUND(o.totalCents * (${TAXA}) / 100) > 0`,
    [...p, ...p, startedAt, ...p],
  );
  if (r.affectedRows > 0) console.log(`[taxa] backfill: ${r.affectedRows} venda(s) contabilizada(s)`);
  return r.affectedRows;
}

/**
 * Cancela a taxa de um pedido que deixou de ser venda (estorno, chargeback).
 *
 * Só mexe em linha PENDING: taxa já paga não se desfaz sozinha — isso vira
 * conversa, não UPDATE silencioso.
 */
export async function cancelarTaxa(orderId: string): Promise<void> {
  try {
    await execute(`UPDATE platform_fees SET status = 'CANCELLED' WHERE orderId = ? AND status = 'PENDING'`, [
      orderId,
    ]);
  } catch (e) {
    console.error("[taxa] cancelar:", e instanceof Error ? e.message : e);
  }
}

export type ResumoTaxas = {
  pendentesCents: number;
  pagasCents: number;
  totalCents: number;
  baseCents: number;
  lojasDevendo: number;
  pedidos: number;
};

/** Totais gerais, para os cards do admin. */
export async function resumoTaxas(): Promise<ResumoTaxas> {
  const [r] = await query<{
    pendentes: number;
    pagas: number;
    base: number;
    pedidos: number;
    lojas: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'PENDING' THEN feeCents END), 0) AS pendentes,
       COALESCE(SUM(CASE WHEN status = 'PAID'    THEN feeCents END), 0) AS pagas,
       COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN baseCents END), 0) AS base,
       COALESCE(SUM(status <> 'CANCELLED'), 0) AS pedidos,
       COUNT(DISTINCT CASE WHEN status = 'PENDING' THEN storeId END) AS lojas
     FROM platform_fees`,
  );
  const pendentesCents = Number(r?.pendentes ?? 0);
  const pagasCents = Number(r?.pagas ?? 0);
  return {
    pendentesCents,
    pagasCents,
    totalCents: pendentesCents + pagasCents,
    baseCents: Number(r?.base ?? 0),
    lojasDevendo: Number(r?.lojas ?? 0),
    pedidos: Number(r?.pedidos ?? 0),
  };
}

export type TaxaPorLoja = {
  storeId: string;
  loja: string;
  pendentesCents: number;
  pagasCents: number;
  pedidos: number;
  ultimaEm: Date | null;
  /** Taxa individual, ou null quando a loja usa a padrão. */
  pctIndividual: string | number | null;
  /** Taxa individual de recuperação, ou null quando usa a padrão. */
  recoveryPctIndividual: string | number | null;
};

/**
 * Quem deve quanto, e com que percentual.
 *
 * Parte de `stores` (e não de `platform_fees`) para listar TODAS as lojas:
 * o admin precisa conseguir definir a taxa de uma loja que ainda não vendeu
 * nada — se a lista só tivesse quem já gerou taxa, a primeira venda já sairia
 * com o percentual errado.
 */
export async function taxasPorLoja(): Promise<TaxaPorLoja[]> {
  return query<TaxaPorLoja>(
    `SELECT s.id AS storeId,
            s.name AS loja,
            COALESCE(SUM(CASE WHEN f.status = 'PENDING' THEN f.feeCents END), 0) AS pendentesCents,
            COALESCE(SUM(CASE WHEN f.status = 'PAID'    THEN f.feeCents END), 0) AS pagasCents,
            COALESCE(SUM(f.status <> 'CANCELLED'), 0) AS pedidos,
            MAX(f.createdAt) AS ultimaEm,
            r.pct AS pctIndividual,
            r.recoveryPct AS recoveryPctIndividual
       FROM stores s
       LEFT JOIN platform_fees f ON f.storeId = s.id
       LEFT JOIN store_fee_rates r ON r.storeId = s.id
      GROUP BY s.id, s.name, r.pct, r.recoveryPct
      ORDER BY pendentesCents DESC, pagasCents DESC, s.name`,
  );
}

/**
 * Dias de tolerância antes de suspender o acesso ao painel.
 *
 * Conta a partir da taxa mais antiga em aberto, não do último pagamento: quem
 * paga hoje zera o relógio, quem nunca pagou tem três dias desde a primeira
 * venda cobrada.
 */
export const DIAS_ATE_SUSPENDER = 3;

export type StatusCobranca = {
  /** Acesso ao painel bloqueado por falta de pagamento. */
  suspensa: boolean;
  pendentesCents: number;
  /** Idade da taxa em aberto mais antiga. 0 quando não há nada em aberto. */
  diasEmAberto: number;
  /** Quantos dias faltam para suspender. Negativo depois de suspensa. */
  diasRestantes: number;
  /**
   * Há saldo, mas abaixo do menor Pix possível (R$ 5,00 na Cakto). Ele acumula
   * para a próxima cobrança: sem aviso, sem prazo e sem suspensão.
   */
  abaixoDoMinimo: boolean;
};

/**
 * A loja está suspensa por falta de pagamento?
 *
 * DERIVADO, nunca um campo marcado por rotina. Pagar volta a liberar o painel
 * na mesma hora, sem depender de cron nem de alguém lembrar de desmarcar —
 * e não existe estado "suspenso" que sobreviva ao pagamento por esquecimento.
 *
 * ⚠️ Isto governa SÓ o painel. O checkout, os webhooks e os e-mails seguem
 * funcionando: suspender quem está devendo não pode custar venda ao lojista —
 * seria tirar dele justamente o dinheiro com que ele vai pagar.
 */
export async function statusCobrancaLoja(storeId: string): Promise<StatusCobranca> {
  const minimo = minimoPixPlataforma();
  // O prazo conta de quando o saldo PASSOU A SER PAGÁVEL (a taxa em que a soma
  // acumulada, da mais antiga para a mais nova, atingiu o mínimo), não da
  // primeira taxa. Contando da primeira, uma loja que leva 10 dias para juntar
  // R$ 5,00 seria suspensa no mesmo dia em que ganhasse como pagar, sem aviso.
  const [r] = await query<{ soma: number; dias: number | null }>(
    `SELECT COALESCE((SELECT SUM(feeCents) FROM platform_fees WHERE storeId = ? AND status = 'PENDING'), 0) AS soma,
            (SELECT TIMESTAMPDIFF(DAY, MIN(createdAt), NOW(3))
               FROM (SELECT createdAt,
                            SUM(feeCents) OVER (ORDER BY createdAt, orderId) AS acumulado
                       FROM platform_fees WHERE storeId = ? AND status = 'PENDING') t
              WHERE acumulado >= ?) AS dias`,
    [storeId, storeId, minimo],
  );
  const pendentesCents = Number(r?.soma ?? 0);
  const cobravel = pendentesCents > 0 && pendentesCents >= minimo;
  const diasEmAberto = cobravel ? Math.max(0, Number(r?.dias ?? 0)) : 0;
  return {
    suspensa: cobravel && diasEmAberto >= DIAS_ATE_SUSPENDER,
    pendentesCents,
    diasEmAberto,
    diasRestantes: DIAS_ATE_SUSPENDER - diasEmAberto,
    abaixoDoMinimo: pendentesCents > 0 && !cobravel,
  };
}

export type ResumoLoja = {
  pendentesCents: number;
  pagasCents: number;
  pedidos: number;
  baseCents: number;
};

/** Os números de UMA loja — é o que o lojista vê no painel dele. */
export async function resumoLoja(storeId: string): Promise<ResumoLoja> {
  const [r] = await query<{ pendentes: number; pagas: number; pedidos: number; base: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'PENDING' THEN feeCents END), 0) AS pendentes,
       COALESCE(SUM(CASE WHEN status = 'PAID'    THEN feeCents END), 0) AS pagas,
       COALESCE(SUM(status <> 'CANCELLED'), 0) AS pedidos,
       COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN baseCents END), 0) AS base
     FROM platform_fees WHERE storeId = ?`,
    [storeId],
  );
  return {
    pendentesCents: Number(r?.pendentes ?? 0),
    pagasCents: Number(r?.pagas ?? 0),
    pedidos: Number(r?.pedidos ?? 0),
    baseCents: Number(r?.base ?? 0),
  };
}

export type ItemExtrato = {
  orderId: string;
  baseCents: number;
  ratePct: string | number;
  feeCents: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
  customerName: string | null;
  /** 1 quando a venda veio de e-mail de recuperação (taxa maior). */
  recuperado: number;
};

/**
 * Extrato linha a linha, PAGINADO. Sem isto a taxa vira um número que o
 * lojista tem que aceitar no escuro — com ele, dá para conferir venda por
 * venda.
 *
 * A página é recortada no banco, não na tela: uma loja com centenas de vendas
 * por dia acumula milhares de linhas em poucas semanas, e trazer tudo para
 * mostrar dez seria desperdício que só piora com o tempo.
 */
export async function extratoLoja(
  storeId: string,
  { limit = 10, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ itens: ItemExtrato[]; total: number }> {
  const porPagina = Math.min(100, Math.max(1, limit));
  const pulo = Math.max(0, offset);

  const [itens, [contagem]] = await Promise.all([
    query<ItemExtrato>(
      `SELECT f.orderId, f.baseCents, f.ratePct, f.feeCents, f.status, f.createdAt, f.paidAt,
              f.recuperado, o.customerName
         FROM platform_fees f
         LEFT JOIN orders o ON o.id = f.orderId
        WHERE f.storeId = ?
        ORDER BY f.createdAt DESC, f.orderId DESC
        LIMIT ${porPagina} OFFSET ${pulo}`,
      [storeId],
    ),
    query<{ n: number }>(`SELECT COUNT(*) AS n FROM platform_fees WHERE storeId = ?`, [storeId]),
  ]);
  return { itens, total: Number(contagem?.n ?? 0) };
}

// ── Cobrança via Cakto (conta DA PLATAFORMA) ─────────────────────────────────
//
// O cliente da API e a regra das credenciais (só na Vercel) estão em
// lib/cakto-plataforma.ts. A coluna `platform_settings.pushinpayTokenEnc` é da
// época da PushinPay, está vazia e fica morta de propósito: credencial de
// recebimento da plataforma não ganha caminho de escrita pelo painel.

/** Dono da loja, que é quem paga o Pix da taxa (com o documento do cadastro). */
async function pagadorDaLoja(storeId: string) {
  const [s] = await query<{ ownerUserId: string }>(`SELECT ownerUserId FROM stores WHERE id = ? LIMIT 1`, [storeId]);
  return s ? pagadorDaConta(s.ownerUserId) : null;
}

export type Cobranca = {
  id: string;
  storeId: string;
  txnId: string | null;
  amountCents: number;
  status: string;
  qrCode: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

/**
 * Gera um Pix com TODO o saldo em aberto da loja e amarra as taxas a ele.
 *
 * A ordem importa: a cobrança é criada na Cakto ANTES de marcar as taxas,
 * e as taxas só são amarradas se o Pix nasceu. O contrário deixaria taxa
 * apontando para cobrança que não existe.
 */
/**
 * Validade do Pix da taxa, em minutos.
 *
 * Curta de propósito: o valor é a soma do que está em aberto AGORA, e a loja
 * continua vendendo. Um Pix de ontem cobraria menos do que a dívida de hoje, e
 * pagá-lo deixaria um resto em aberto sem explicação. Vencendo rápido, cada
 * cobrança nasce com o valor atual.
 */
export const MINUTOS_PIX = 15;

/**
 * Quando este Pix vence, em ISO — o que a tela usa para contar o tempo.
 *
 * Calculado no servidor a partir do `createdAt` da cobrança: o relógio do
 * navegador pode estar errado, e contar a partir dele mostraria um prazo que
 * não é o que o banco vai respeitar.
 */
export function vencimentoDoPix(criadoEm: Date | string): string {
  return new Date(new Date(criadoEm).getTime() + MINUTOS_PIX * 60_000).toISOString();
}

/**
 * Solta as taxas presas a Pix que venceu.
 *
 * Sem isto, um Pix não pago prenderia as taxas para sempre: elas continuam
 * PENDING mas com `chargeId` preenchido, então não entrariam numa cobrança
 * nova — e a tela ainda mostraria "Pix aguardando pagamento", deixando o
 * lojista sem como quitar. Bug de travar o pagamento de quem QUER pagar.
 */
async function expirarCobrancasVelhas(storeId: string): Promise<void> {
  const vencidas = await query<{ id: string }>(
    `SELECT id FROM platform_fee_charges
      WHERE storeId = ? AND status = 'PENDING' AND createdAt < (NOW(3) - INTERVAL ${MINUTOS_PIX} MINUTE)`,
    [storeId],
  );
  if (!vencidas.length) return;
  const ids = vencidas.map((v) => v.id);
  const marcadores = ids.map(() => "?").join(",");
  await execute(`UPDATE platform_fee_charges SET status = 'EXPIRED' WHERE id IN (${marcadores})`, ids);
  // Só solta o que ainda não foi pago — taxa paga permanece ligada à cobrança
  // que a quitou, senão o histórico perde o vínculo.
  await execute(
    `UPDATE platform_fees SET chargeId = NULL WHERE chargeId IN (${marcadores}) AND status = 'PENDING'`,
    ids,
  );
  console.log(`[taxa] ${ids.length} cobrança(s) expirada(s) da loja ${storeId}; taxas liberadas`);
}

export async function gerarCobranca(storeId: string): Promise<{ ok: boolean; erro?: string; cobranca?: Cobranca }> {
  await expirarCobrancasVelhas(storeId);

  const [tot] = await query<{ n: number; soma: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(feeCents), 0) AS soma
       FROM platform_fees WHERE storeId = ? AND status = 'PENDING' AND chargeId IS NULL`,
    [storeId],
  );
  const valor = Number(tot?.soma ?? 0);
  if (valor <= 0) return { ok: false, erro: "Esta loja não tem taxa em aberto." };
  const minimo = minimoPixPlataforma();
  if (valor < minimo) {
    const reais = (minimo / 100).toFixed(2).replace(".", ",");
    return { ok: false, erro: `Saldos abaixo de R$ ${reais} ficam para a próxima cobrança.` };
  }

  const pagador = await pagadorDaLoja(storeId);
  if (!pagador) return { ok: false, erro: "Loja não encontrada." };

  const id = newId();
  try {
    const pix = await criarPixPlataforma({
      valorCents: valor,
      // Quem lê é o LOJISTA no app do banco dele: dizer o que é ajuda.
      titulo: "Taxa VOX",
      externalRef: id,
      pagador,
      validadeMinutos: MINUTOS_PIX,
    });
    if (!pix.ok) return { ok: false, erro: pix.erro };
    const { txnId, qrCode } = pix;

    await execute(
      `INSERT INTO platform_fee_charges (id, storeId, txnId, amountCents, qrCode) VALUES (?, ?, ?, ?, ?)`,
      [id, storeId, txnId, valor, qrCode],
    );
    // Amarra exatamente as linhas que entraram na conta.
    await execute(
      `UPDATE platform_fees SET chargeId = ? WHERE storeId = ? AND status = 'PENDING' AND chargeId IS NULL`,
      [id, storeId],
    );

    const [c] = await query<Cobranca>(`SELECT * FROM platform_fee_charges WHERE id = ? LIMIT 1`, [id]);
    return { ok: true, cobranca: c };
  } catch (e) {
    console.error("[taxa] gerar cobrança:", e instanceof Error ? e.message : e);
    return { ok: false, erro: "Não foi possível gerar o Pix agora. Tente de novo." };
  }
}

/**
 * Quita uma cobrança: a cobrança e as taxas dela viram PAID.
 *
 * Idempotente pela cláusula de status — webhook repetido não move nada duas
 * vezes, e o `paidAt` não é reescrito a cada chamada.
 *
 * ⚠️ Aceita cobrança EXPIRED, não só PENDING. Com validade de 15 minutos, um
 * pagamento feito no limite chega com a cobrança já vencida aqui. Recusá-lo
 * seria receber o dinheiro e manter o lojista devendo — o pior desfecho
 * possível deste fluxo.
 */
export async function quitarCobranca(txnId: string): Promise<{ ok: boolean; taxas: number }> {
  const [c] = await query<{ id: string; storeId: string; amountCents: number; status: string }>(
    `SELECT id, storeId, amountCents, status FROM platform_fee_charges
      WHERE txnId = ? AND status IN ('PENDING','EXPIRED') LIMIT 1`,
    [txnId],
  );
  if (!c?.id) return { ok: false, taxas: 0 };

  await execute(
    `UPDATE platform_fee_charges SET status = 'PAID', paidAt = NOW(3)
      WHERE id = ? AND status IN ('PENDING','EXPIRED')`,
    [c.id],
  );

  const r = await execute(
    `UPDATE platform_fees SET status = 'PAID', paidAt = NOW(3) WHERE chargeId = ? AND status = 'PENDING'`,
    [c.id],
  );
  if (r.affectedRows > 0) {
    console.log(`[taxa] cobrança ${txnId} quitada: ${r.affectedRows} taxa(s)`);
    return { ok: true, taxas: r.affectedRows };
  }

  // Sem taxas amarradas: a cobrança venceu e as taxas foram soltas antes de o
  // pagamento chegar. O dinheiro entrou do mesmo jeito, então quita as mais
  // ANTIGAS até cobrir o valor pago. Sem isto o lojista pagaria e continuaria
  // devendo o mesmo valor.
  const abertas = await query<{ orderId: string; feeCents: number }>(
    `SELECT orderId, feeCents FROM platform_fees
      WHERE storeId = ? AND status = 'PENDING'
      ORDER BY createdAt ASC`,
    [c.storeId],
  );
  const alvo = Number(c.amountCents);
  const quitar: string[] = [];
  let soma = 0;
  for (const f of abertas) {
    if (soma + Number(f.feeCents) > alvo) break;
    soma += Number(f.feeCents);
    quitar.push(f.orderId);
  }
  if (!quitar.length) {
    console.error(
      `[taxa] cobrança ${txnId} paga (${alvo}) mas não achei taxa em aberto para quitar na loja ${c.storeId}`,
    );
    return { ok: true, taxas: 0 };
  }
  const marcadores = quitar.map(() => "?").join(",");
  const r2 = await execute(
    `UPDATE platform_fees SET status = 'PAID', paidAt = NOW(3), chargeId = ?
      WHERE orderId IN (${marcadores}) AND status = 'PENDING'`,
    [c.id, ...quitar],
  );
  console.log(
    `[taxa] cobrança ${txnId} paga depois de vencida: ${r2.affectedRows} taxa(s) quitadas por valor (${soma} de ${alvo})`,
  );
  return { ok: true, taxas: r2.affectedRows };
}

/**
 * Pergunta à Cakto o status de uma cobrança nossa ("paid" quando paga).
 *
 * É o que dá confiança ao webhook: um POST forjado na nossa URL não marca taxa
 * como paga, porque a decisão vem da API deles, com a nossa credencial.
 */
export async function consultarStatusCobranca(txnId: string): Promise<string | null> {
  return consultarPixPlataforma(txnId);
}

/**
 * Confere na Cakto os Pix recentes da loja que ainda não constam como pagos.
 *
 * Existe porque o webhook da Cakto não é reenviado quando a nossa resposta
 * falha (deploy, timeout): o pagamento nunca chegaria aqui e o lojista pagaria
 * e continuaria suspenso. Roda sempre que a tela de cobrança abre.
 *
 * Inclui as EXPIRED de até 1 dia: pagamento feito no último segundo chega com
 * a cobrança já vencida aqui, e precisa dar baixa do mesmo jeito.
 */
async function conferirCobrancasDaLoja(storeId: string): Promise<void> {
  const recentes = await query<{ txnId: string | null }>(
    `SELECT txnId FROM platform_fee_charges
      WHERE storeId = ? AND status IN ('PENDING','EXPIRED') AND createdAt > (NOW(3) - INTERVAL 25 HOUR)
      ORDER BY createdAt DESC LIMIT 5`,
    [storeId],
  );
  for (const { txnId } of recentes) {
    if (!ehTxnConsultavel(txnId)) continue;
    if ((await consultarPixPlataforma(txnId!)) === "paid") {
      const r = await quitarCobranca(txnId!);
      console.log(`[taxa] conferência: tx=${txnId} paga, ${r.taxas} taxa(s) quitada(s)`);
    }
  }
}

/**
 * Cobranças em aberto de uma loja, para a tela não gerar Pix duplicado.
 *
 * Confere pagamentos antes (ver conferirCobrancasDaLoja) e expira as vencidas:
 * senão a tela mostraria um Pix velho como se fosse o caminho para pagar.
 */
export async function cobrancasAbertas(storeId: string): Promise<Cobranca[]> {
  try {
    await conferirCobrancasDaLoja(storeId);
  } catch (e) {
    // Conferência é reforço: falhar aqui não pode derrubar a tela de cobrança.
    console.error("[taxa] conferência:", e instanceof Error ? e.message : e);
  }
  await expirarCobrancasVelhas(storeId);
  return query<Cobranca>(
    `SELECT * FROM platform_fee_charges WHERE storeId = ? AND status = 'PENDING' ORDER BY createdAt DESC`,
    [storeId],
  );
}

export type CobrancaDaLoja = Cobranca & { loja: string | null; feeCount: number };

/**
 * Últimas cobranças de TODAS as lojas — o extrato de movimentação do admin.
 *
 * Mostra o que aconteceu de fato (Pix gerado, pago, vencido), que é o que se
 * acompanha no dia a dia. O saldo de cada loja já aparece nos cartões acima; o
 * que faltava era ver o dinheiro se mexendo.
 */
export async function listarCobrancas(limit = 50): Promise<CobrancaDaLoja[]> {
  return query<CobrancaDaLoja>(
    `SELECT c.id, c.storeId, c.txnId, c.amountCents, c.status, c.qrCode, c.createdAt, c.paidAt,
            s.name AS loja,
            (SELECT COUNT(*) FROM platform_fees f WHERE f.chargeId = c.id) AS feeCount
       FROM platform_fee_charges c
       LEFT JOIN stores s ON s.id = c.storeId
      ORDER BY c.createdAt DESC
      LIMIT ${Math.min(200, Math.max(1, limit))}`,
  );
}
