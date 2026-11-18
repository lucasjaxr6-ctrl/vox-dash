import "server-only";
import { query } from "./db";
import { isEmailKindEnabled, type EmailKind } from "./settings";
import { sendOrderPaidEmail, sendPixEmail, sendPixRecoveryEmail, sendSeparationEmail, sendTrackingEmail } from "./email";
import { rotuloKind } from "./email-kinds";
import { agendadosDoPedido, cancelarAgendado } from "./email-agenda";

// ─────────────────────────────────────────────────────────────────────────────
// E-mails de UM pedido, para a aba "E-mails" do detalhe da venda: o que dá para
// reenviar e o que já foi enviado.
//
// Fica num lugar só porque a página (que mostra) e a rota (que envia) precisam
// da mesma regra de "faz sentido agora": reenviar "Pagamento confirmado" num
// pedido que não foi pago confundiria o cliente.
// ─────────────────────────────────────────────────────────────────────────────

export type TipoEmailPedido = "pix" | "pixrecovery" | "paid" | "separation" | "tracking";

type Pedido = {
  status: string;
  paymentMethod: string | null;
  pixQrCode: string | null;
  trackingCode: string | null;
  customerEmail: string | null;
};

const CATALOGO: Array<{
  tipo: TipoEmailPedido;
  nome: string;
  descricao: string;
  /** Interruptor em E-mails › Configuração. */
  config: EmailKind;
  /** `kind` gravado em outbound_emails (inclui nomes antigos). */
  registros: string[];
  /** Motivo de não fazer sentido agora, ou null. */
  bloqueio: (p: Pedido) => string | null;
}> = [
  {
    tipo: "pix",
    nome: "Pix gerado",
    descricao: "O código Pix para o cliente pagar.",
    config: "pix",
    registros: ["pix_generated"],
    bloqueio: (p) =>
      p.paymentMethod !== "PIX" || !p.pixQrCode ? "Só para pedido no Pix." : p.status !== "PENDING" ? "O Pix já não está pendente." : null,
  },
  {
    tipo: "pixrecovery",
    nome: "Lembrete de Pix",
    descricao: "Avisa que o Pix ainda está valendo, com o link para pagar.",
    config: "pixrecovery",
    registros: ["pix_recovery", "recovery"],
    bloqueio: (p) =>
      p.paymentMethod !== "PIX" || !p.pixQrCode ? "Só para pedido no Pix." : p.status !== "PENDING" ? "O Pix já não está pendente." : null,
  },
  {
    tipo: "paid",
    nome: "Pagamento confirmado",
    descricao: "Confirma a compra com os itens e o valor.",
    config: "paid",
    registros: ["order_paid"],
    bloqueio: (p) => (p.status === "PAID" || p.status === "SHIPPED" ? null : "Só depois do pagamento aprovado."),
  },
  {
    tipo: "separation",
    nome: "Pedido em preparação",
    descricao: "Avisa que o pedido está sendo separado.",
    config: "separation",
    registros: ["separation"],
    bloqueio: (p) => (p.status === "PAID" || p.status === "SHIPPED" ? null : "Só depois do pagamento aprovado."),
  },
  {
    tipo: "tracking",
    nome: "Pedido postado",
    descricao: "Envia o código de rastreio.",
    config: "tracking",
    registros: ["tracking"],
    bloqueio: (p) => (p.trackingCode ? null : "Informe o código na aba Rastreamento."),
  },
];

const ROTULO_CONFIG: Record<EmailKind, string> = {
  pix: "Pix gerado",
  paid: "Pagamento confirmado",
  separation: "Pedido em preparação",
  tracking: "Pedido postado",
  recovery: "Recuperação de carrinho",
  pixrecovery: "Pix não pago",
};

export type OpcaoEmail = {
  tipo: TipoEmailPedido;
  nome: string;
  descricao: string;
  /** Motivo de estar indisponível (pedido no estado errado ou e-mail desligado). */
  bloqueio: string | null;
  ultimoEnvio: Date | null;
  /** Na fila, esperando o tempo configurado. */
  agendadoPara: Date | null;
};

export type EnvioDoPedido = { id: string; nome: string; assunto: string | null; quando: Date };

async function lerPedido(storeId: string, orderId: string): Promise<(Pedido & { createdAt: Date }) | null> {
  const [p] = await query<Pedido & { createdAt: Date }>(
    `SELECT status, paymentMethod, pixQrCode, trackingCode, customerEmail, createdAt
       FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [orderId, storeId],
  );
  return p ?? null;
}

/**
 * Envios para o e-mail do cliente desde a criação do pedido. O registro de
 * envio não guarda o pedido, então é por destinatário e data: um cliente com
 * outro pedido depois deste vê os dois, o que na prática é o que o lojista quer
 * saber ("o que esse cliente recebeu").
 */
async function enviosDoCliente(storeId: string, email: string, desde: Date) {
  return query<{ id: string; kind: string | null; subject: string | null; createdAt: Date }>(
    `SELECT id, kind, subject, createdAt FROM outbound_emails
      WHERE storeId = ? AND LOWER(toAddr) = LOWER(?) AND createdAt >= (? - INTERVAL 2 MINUTE)
      ORDER BY createdAt DESC LIMIT 30`,
    [storeId, email, desde],
  );
}

/** O que a aba mostra: as opções de reenvio e o histórico. */
export async function emailsDoPedido(
  storeId: string,
  orderId: string,
): Promise<{ email: string | null; opcoes: OpcaoEmail[]; enviados: EnvioDoPedido[] }> {
  const p = await lerPedido(storeId, orderId);
  if (!p) return { email: null, opcoes: [], enviados: [] };
  const [envios, ligados, agendados] = await Promise.all([
    p.customerEmail ? enviosDoCliente(storeId, p.customerEmail, p.createdAt) : Promise.resolve([]),
    Promise.all(CATALOGO.map((c) => isEmailKindEnabled(storeId, c.config))),
    agendadosDoPedido(storeId, orderId),
  ]);
  const opcoes = CATALOGO.map((c, i) => ({
    tipo: c.tipo,
    nome: c.nome,
    descricao: c.descricao,
    bloqueio:
      (!p.customerEmail ? "O pedido não tem e-mail do cliente." : null) ??
      c.bloqueio(p) ??
      (ligados[i] ? null : `Desligado em E-mails › Configuração.`),
    ultimoEnvio: envios.find((e) => e.kind && c.registros.includes(e.kind))?.createdAt ?? null,
    agendadoPara: agendados.find((a) => a.kind === c.config)?.sendAt ?? null,
  }));
  const enviados = envios.map((e) => ({ id: e.id, nome: rotuloKind(e.kind) ?? "E-mail", assunto: e.subject, quando: e.createdAt }));
  return { email: p.customerEmail, opcoes, enviados };
}

/** Reenvia UM e-mail do pedido, conferindo antes se ele faz sentido agora. */
export async function reenviarEmailDoPedido(storeId: string, orderId: string, tipo: TipoEmailPedido): Promise<{ ok: boolean; error?: string }> {
  const c = CATALOGO.find((x) => x.tipo === tipo);
  if (!c) return { ok: false, error: "Tipo de e-mail desconhecido." };
  const p = await lerPedido(storeId, orderId);
  if (!p) return { ok: false, error: "Pedido não encontrado." };
  if (!p.customerEmail) return { ok: false, error: "O pedido não tem e-mail do cliente." };
  const bloqueio = c.bloqueio(p);
  if (bloqueio) return { ok: false, error: bloqueio };
  if (!(await isEmailKindEnabled(storeId, c.config))) {
    return { ok: false, error: `O e-mail "${ROTULO_CONFIG[c.config]}" está desligado em E-mails › Configuração.` };
  }

  // Agora, não agendado: no reenvio o lojista quer que chegue já.
  const envio = await (() => {
    switch (tipo) {
      case "pix":
        return sendPixEmail(storeId, orderId);
      case "pixrecovery":
        return sendPixRecoveryEmail(storeId, orderId);
      case "paid":
        return sendOrderPaidEmail(storeId, orderId);
      case "separation":
        return sendSeparationEmail(storeId, orderId);
      case "tracking":
        return sendTrackingEmail(storeId, orderId, p.trackingCode!);
    }
  })();
  // Já chegou: o que estava na fila não pode chegar de novo depois.
  if (envio.ok) await cancelarAgendado(storeId, orderId, c.config);
  return envio;
}
