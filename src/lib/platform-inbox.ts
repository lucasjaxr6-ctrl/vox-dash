import "server-only";
import { query, execute, newId } from "./db";
import { PLATFORM_STORE_ID } from "./inbound";
import { getPlatformEmailConfig, getPlatformEmailStatus } from "./platform-email";

// ─────────────────────────────────────────────────────────────────────────────
// Caixa da Vox: BUSCA ATIVA na Resend, além do webhook.
//
// O webhook é instantâneo, mas silencioso quando falha — endpoint sem o evento
// de recebimento, segredo trocado, deploy fora do ar — e o e-mail simplesmente
// não aparece. A Resend, porém, guarda tudo que recebeu ("stores your emails
// even if you don't configure a webhook, or if your webhook endpoint is down")
// e lista em GET /emails/receiving.
//
// Então o webhook vira otimização, não dependência: se ele entregou, ótimo; se
// não, a próxima abertura da caixa traz o que faltou. A deduplicação usa o
// messageId (o id da Resend), que é o mesmo que o webhook grava — os dois
// caminhos nunca duplicam um e-mail.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.resend.com";

type ItemRecebido = {
  id: string;
  from?: string | null;
  to?: string[] | string | null;
  subject?: string | null;
  created_at?: string | null;
};

/**
 * Extrai "nome" e endereço de um "Fulano <a@b.com>".
 *
 * Aceita objeto além de string: a documentação diz que vem string, mas se um
 * dia vier `{email,name}` o `String(obj)` viraria "[object Object]", o filtro
 * de domínio não casaria e a caixa ficaria vazia — o mesmo sintoma que estamos
 * corrigindo, e igualmente mudo.
 */
function separarRemetente(v: unknown): { addr: string | null; name: string | null } {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const addr = (o.email ?? o.address ?? o.addr) as string | undefined;
    return {
      addr: addr ? String(addr).trim().toLowerCase() : null,
      name: typeof o.name === "string" ? o.name : null,
    };
  }
  const s = String(v ?? "").trim();
  if (!s) return { addr: null, name: null };
  const m = /^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) return { name: m[1].trim() || null, addr: m[2].trim().toLowerCase() };
  return { name: null, addr: s.toLowerCase() };
}

function comoLista(v: unknown): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => separarRemetente(x).addr ?? "").filter(Boolean);
}

async function resend(cfg: { apiKey: string }, caminho: string) {
  const r = await fetch(`${API}${caminho}`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Resend ${caminho} -> ${r.status} ${txt.slice(0, 200)}`);
  }
  return r.json() as Promise<any>;
}

/**
 * Puxa da Resend os e-mails recebidos que ainda não estão na caixa.
 *
 * Nunca lança: é chamada no carregamento da página e uma instabilidade da
 * Resend não pode derrubar a tela — a caixa continua mostrando o que já tem.
 */
export async function sincronizarCaixaPlataforma(
  maxCorpos = 25,
): Promise<{ novos: number; erro?: string }> {
  const cfg = await getPlatformEmailConfig();
  if (!cfg) return { novos: 0, erro: "E-mail da plataforma não configurado." };

  try {
    const { inboundEmail } = await getPlatformEmailStatus();
    const dominio = inboundEmail.split("@")[1] ?? "";

    const lista = await resend(cfg, "/emails/receiving?limit=100");
    const itens: ItemRecebido[] = Array.isArray(lista?.data) ? lista.data : [];
    if (itens.length === 0) return { novos: 0 };

    // Só o que é da caixa da Vox. A conta da Resend pode, um dia, hospedar
    // outro domínio; o filtro evita puxar e-mail que não é nosso.
    const meus = dominio
      ? itens.filter((i) => comoLista(i.to).some((a) => a === inboundEmail || a.endsWith(`@${dominio}`)))
      : itens;
    if (meus.length === 0) {
      // A Resend tem e-mails, nenhum bateu com o nosso domínio. Ou são de outro
      // domínio da mesma conta, ou o destinatário vem num formato que não
      // reconhecemos — imprimir um exemplo evita depurar no escuro.
      console.warn(
        `[caixa-vox] ${itens.length} recebido(s) na Resend, nenhum para ${inboundEmail || "(endereço não configurado)"}.`,
        { exemploDestino: itens[0]?.to ?? null },
      );
      return { novos: 0 };
    }

    // Um SELECT só com todos os ids, em vez de um por e-mail.
    const ids = meus.map((i) => i.id).filter(Boolean);
    if (ids.length === 0) return { novos: 0 }; // `IN ()` é erro de sintaxe
    const marcadores = ids.map(() => "?").join(",");
    const jaTem = await query<{ messageId: string }>(
      `SELECT messageId FROM inbound_emails
        WHERE storeId = ? AND messageId IN (${marcadores})`,
      [PLATFORM_STORE_ID, ...ids],
    );
    const conhecidos = new Set(jaTem.map((r) => r.messageId));
    // Do mais antigo para o mais novo, para a caixa ficar na ordem certa.
    const faltando = meus.filter((i) => !conhecidos.has(i.id)).reverse();
    if (faltando.length === 0) return { novos: 0 };

    let novos = 0;
    // O corpo exige uma chamada por e-mail, então há um teto por rodada. O que
    // sobrar entra na próxima — nada se perde, a Resend guarda.
    for (const item of faltando.slice(0, maxCorpos)) {
      let texto: string | null = null;
      let html: string | null = null;
      try {
        const cheio = await resend(cfg, `/emails/receiving/${encodeURIComponent(item.id)}`);
        texto = cheio?.text ?? null;
        html = cheio?.html ?? null;
      } catch (e) {
        // Sem o corpo ainda vale gravar: assunto e remetente já dizem que
        // chegou. O corpo pode ser buscado depois.
        console.error("[caixa-vox] corpo não veio:", e instanceof Error ? e.message : e);
      }
      const de = separarRemetente(item.from);
      const para = comoLista(item.to)[0] ?? inboundEmail ?? null;
      await execute(
        `INSERT INTO inbound_emails
           (id, storeId, fromAddr, fromName, toAddr, subject, textBody, htmlBody, messageId, receivedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(), PLATFORM_STORE_ID,
          de.addr, de.name, para,
          (item.subject ?? "").slice(0, 500) || null,
          texto, html,
          item.id,
          item.created_at ? new Date(item.created_at) : new Date(),
        ],
      );
      novos++;
    }
    return { novos };
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Falha ao falar com a Resend.";
    console.error("[caixa-vox] sincronizar:", erro);
    return { novos: 0, erro };
  }
}
