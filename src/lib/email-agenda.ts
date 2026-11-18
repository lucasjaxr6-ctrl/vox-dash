import "server-only";
import { execute, newId, query } from "./db";
import { getDomainConfig, getEmailTempos, getResendConfig } from "./settings";
import { sendOrderPaidEmail, sendPixEmail, sendSeparationEmail, sendTrackingEmail } from "./email";

// ─────────────────────────────────────────────────────────────────────────────
// Quando sai cada e-mail do pedido, conforme o tempo que o lojista escolheu em
// E-mails › Configuração.
//
// Na hora: envia direto, como sempre foi. Com espera: entra na fila
// `emails_agendados`, e o relógio de /api/cron/recovery (a cada minuto) envia.
//
// A fila existe em vez do `scheduled_at` do Resend porque, com espera longa, o
// pedido muda enquanto o e-mail aguarda. Aqui a decisão é na hora de enviar: quem
// foi estornado não recebe "em preparação", e quem já pagou não recebe "Pix gerado".
// ─────────────────────────────────────────────────────────────────────────────

export type KindAgendavel = "pix" | "paid" | "separation" | "tracking";
type Resultado = { ok: boolean; error?: string; agendado?: boolean };

const LOTE = 40;
/** O mesmo relógio ainda varre a recuperação de cada loja, e a rota tem 60 s. */
const TEMPO_MAX_MS = 30_000;
const RETENTATIVA_MIN = 5;
const MAX_TENTATIVAS = 5;
/** O Resend recusa acima de 2 envios por segundo na mesma conta. */
const FOLGA_MESMA_LOJA_MS = 550;

function enviarAgora(storeId: string, orderId: string, kind: KindAgendavel, codigo?: string | null): Promise<Resultado> {
  switch (kind) {
    case "pix":
      return sendPixEmail(storeId, orderId);
    case "paid":
      return sendOrderPaidEmail(storeId, orderId);
    case "separation":
      return sendSeparationEmail(storeId, orderId);
    case "tracking":
      return codigo ? sendTrackingEmail(storeId, orderId, codigo) : Promise.resolve({ ok: false, error: "Pedido sem código de rastreio." });
  }
}

/**
 * Envia agora ou agenda, conforme o tempo configurado na loja. Nunca lança: e-mail
 * não pode derrubar pagamento nem despacho.
 */
export async function dispararEmail(storeId: string, orderId: string, kind: KindAgendavel, codigo?: string | null): Promise<Resultado> {
  try {
    const minutos = (await getEmailTempos(storeId))[kind];
    if (minutos <= 0) return await enviarAgora(storeId, orderId, kind, codigo);

    // Desligado, sem Resend ou sem destinatário não adianta agendar, e no rastreio o
    // lojista precisa ver o erro na hora. O envio direto devolve a mensagem certa.
    const [pedido] = await query<{ customerEmail: string | null }>(`SELECT customerEmail FROM orders WHERE id = ? AND storeId = ? LIMIT 1`, [orderId, storeId]);
    if (!pedido?.customerEmail || !(await getResendConfig(storeId, kind))) {
      return await enviarAgora(storeId, orderId, kind, codigo);
    }

    // `minutos` é inteiro validado em lerTempos. A chave única evita dois agendamentos
    // do mesmo e-mail; se o evento se repetir (código de rastreio trocado), vale o novo.
    await execute(
      `INSERT INTO emails_agendados (id, storeId, orderId, kind, sendAt)
       VALUES (?, ?, ?, ?, NOW(3) + INTERVAL ${minutos} MINUTE)
       ON DUPLICATE KEY UPDATE sendAt = NOW(3) + INTERVAL ${minutos} MINUTE, status = 'PENDING', attempts = 0, lastError = NULL`,
      [newId(), storeId, orderId, kind],
    );
    return { ok: true, agendado: true };
  } catch (e) {
    console.error("[dispararEmail]", kind, e instanceof Error ? e.message : e);
    // Sem a fila, antes cedo do que nunca.
    return enviarAgora(storeId, orderId, kind, codigo).catch((erro) => ({ ok: false, error: erro instanceof Error ? erro.message : "Falha ao enviar." }));
  }
}

/** Motivo de este e-mail não fazer mais sentido, ou null. */
async function motivoParaNaoEnviar(item: { storeId: string; orderId: string; kind: KindAgendavel }): Promise<string | null> {
  const [p] = await query<{ status: string; customerEmail: string | null; pixQrCode: string | null; trackingCode: string | null; pixValido: number }>(
    `SELECT status, customerEmail, pixQrCode, trackingCode,
            (COALESCE(pixExpiresAt, DATE_ADD(createdAt, INTERVAL 30 MINUTE)) > NOW(3)) AS pixValido
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [item.orderId, item.storeId],
  );
  if (!p) return "Pedido não encontrado.";
  if (!p.customerEmail) return "Pedido sem e-mail do cliente.";
  if (!(await getResendConfig(item.storeId, item.kind))) return "E-mail desligado ou Resend não configurado.";
  switch (item.kind) {
    case "pix":
      if (p.status !== "PENDING") return "O Pix já não está pendente.";
      if (!p.pixQrCode) return "Pedido sem código Pix.";
      if (Number(p.pixValido) === 1) return null;
      // Vencido sai com o botão para gerar outro, que só existe com domínio próprio.
      // Sem ele, tentar de novo não adianta.
      const dominio = await getDomainConfig(item.storeId);
      return dominio.customDomain && dominio.domainVerified ? null : "O Pix venceu e a loja não tem domínio próprio verificado.";
    case "paid":
      return p.status === "PAID" || p.status === "SHIPPED" ? null : "Pagamento desfeito antes do envio.";
    // "Em preparação" depois de "postado" contaria a história de trás para frente.
    case "separation":
      return p.status === "PAID" ? null : "O pedido saiu de preparação antes do envio.";
    case "tracking":
      if (p.status === "CANCELLED") return "Pedido cancelado antes do envio.";
      return p.trackingCode ? null : "Pedido sem código de rastreio.";
  }
}

/** Envia o que venceu. Chamada pelo relógio de /api/cron/recovery. */
export async function enviarEmailsAgendados(): Promise<{ enviados: number; pulados: number; falhas: number }> {
  const placar = { enviados: 0, pulados: 0, falhas: 0 };
  const inicio = Date.now();
  const fila = await query<{ id: string; storeId: string; orderId: string; kind: KindAgendavel; attempts: number }>(
    `SELECT id, storeId, orderId, kind, attempts FROM emails_agendados
      WHERE status = 'PENDING' AND sendAt <= NOW(3)
      ORDER BY sendAt ASC LIMIT ${LOTE}`,
  );

  let ultimaLoja: string | null = null;
  for (const item of fila) {
    if (Date.now() - inicio > TEMPO_MAX_MS) break;

    // Reserva empurrando o horário: duas rodadas juntas não pegam o mesmo item, e se
    // o processo morrer aqui no meio, ele volta sozinho na próxima tentativa.
    const reserva = await execute(
      `UPDATE emails_agendados SET sendAt = NOW(3) + INTERVAL ${RETENTATIVA_MIN} MINUTE, attempts = attempts + 1
        WHERE id = ? AND status = 'PENDING' AND sendAt <= NOW(3)`,
      [item.id],
    );
    if (reserva.affectedRows !== 1) continue;

    try {
      const motivo = await motivoParaNaoEnviar(item);
      if (motivo) {
        await execute(`UPDATE emails_agendados SET status = 'SKIPPED', lastError = ? WHERE id = ?`, [motivo, item.id]);
        placar.pulados++;
        continue;
      }

      if (ultimaLoja === item.storeId) await new Promise((ok) => setTimeout(ok, FOLGA_MESMA_LOJA_MS));
      ultimaLoja = item.storeId;

      // O código de agora, não o da hora do agendamento: o lojista pode ter corrigido.
      let codigo: string | null = null;
      if (item.kind === "tracking") {
        const [o] = await query<{ trackingCode: string | null }>(`SELECT trackingCode FROM orders WHERE id = ? LIMIT 1`, [item.orderId]);
        codigo = o?.trackingCode ?? null;
      }
      const envio = await enviarAgora(item.storeId, item.orderId, item.kind, codigo);
      if (envio.ok) {
        await execute(`UPDATE emails_agendados SET status = 'SENT', lastError = NULL WHERE id = ?`, [item.id]);
        placar.enviados++;
      } else {
        const esgotou = Number(item.attempts) + 1 >= MAX_TENTATIVAS;
        await execute(`UPDATE emails_agendados SET status = ?, lastError = ? WHERE id = ?`, [esgotou ? "FAILED" : "PENDING", String(envio.error ?? "Falha ao enviar.").slice(0, 255), item.id]);
        console.error("[email agendado]", item.kind, item.orderId, envio.error);
        placar.falhas++;
      }
    } catch (e) {
      // O item fica PENDING com o horário já empurrado: tenta de novo sozinho.
      console.error("[email agendado]", item.kind, item.orderId, e instanceof Error ? e.message : e);
      placar.falhas++;
    }
  }
  return placar;
}

/** O que está na fila deste pedido, para a aba E-mails. */
export async function agendadosDoPedido(storeId: string, orderId: string): Promise<{ kind: string; sendAt: Date }[]> {
  try {
    return await query<{ kind: string; sendAt: Date }>(
      `SELECT kind, sendAt FROM emails_agendados WHERE orderId = ? AND storeId = ? AND status = 'PENDING'`,
      [orderId, storeId],
    );
  } catch {
    return [];
  }
}

/** Reenvio manual já entregou: o agendado não pode chegar de novo. */
export async function cancelarAgendado(storeId: string, orderId: string, kind: string): Promise<void> {
  try {
    await execute(`UPDATE emails_agendados SET status = 'CANCELLED' WHERE orderId = ? AND storeId = ? AND kind = ? AND status = 'PENDING'`, [orderId, storeId, kind]);
  } catch (e) {
    console.error("[cancelarAgendado]", e instanceof Error ? e.message : e);
  }
}
