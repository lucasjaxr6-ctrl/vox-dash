import "server-only";
import { query, execute } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// E-mail da PLATAFORMA (Vox), separado do e-mail das lojas.
//
// Cada loja tem o próprio Resend, com o domínio dela, para o comprador receber
// a mensagem vinda da marca onde comprou. Este aqui é o inverso: é a Vox
// falando — com lojista, com suporte — e por isso tem chave e remetente
// próprios. Misturar os dois faria um aviso da plataforma chegar assinado pela
// loja do cliente.
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformEmailConfig = {
  apiKey: string;
  fromEmail: string;
  fromName: string;
};

/** Config completa, ou null se faltar chave ou remetente. */
export async function getPlatformEmailConfig(): Promise<PlatformEmailConfig | null> {
  const rows = await query<{
    resendApiKeyEnc: string | null;
    resendFromEmail: string | null;
    resendFromName: string | null;
  }>(
    `SELECT resendApiKeyEnc, resendFromEmail, resendFromName
       FROM platform_settings WHERE id = 1 LIMIT 1`,
  );
  const r = rows[0];
  if (!r?.resendApiKeyEnc || !r?.resendFromEmail) return null;
  try {
    return {
      apiKey: decryptSecret(r.resendApiKeyEnc),
      fromEmail: r.resendFromEmail,
      fromName: r.resendFromName || "Vox",
    };
  } catch {
    return null;
  }
}

/** O que a tela do admin precisa saber — NUNCA devolve a chave nem o segredo. */
export async function getPlatformEmailStatus(): Promise<{
  configurado: boolean;
  fromEmail: string;
  fromName: string;
  inboundEmail: string;
  temSegredoInbound: boolean;
}> {
  const rows = await query<{
    resendApiKeyEnc: string | null;
    resendFromEmail: string | null;
    resendFromName: string | null;
    inboundEmail: string | null;
    resendInboundSecretEnc: string | null;
  }>(
    `SELECT resendApiKeyEnc, resendFromEmail, resendFromName, inboundEmail, resendInboundSecretEnc
       FROM platform_settings WHERE id = 1 LIMIT 1`,
  );
  const r = rows[0];
  return {
    configurado: Boolean(r?.resendApiKeyEnc && r?.resendFromEmail),
    fromEmail: r?.resendFromEmail ?? "",
    fromName: r?.resendFromName ?? "",
    inboundEmail: r?.inboundEmail ?? "",
    temSegredoInbound: Boolean(r?.resendInboundSecretEnc),
  };
}

/** Signing secret (Svix) do webhook Inbound DA PLATAFORMA — decifrado. */
export async function getPlatformInboundSecret(): Promise<string | null> {
  const rows = await query<{ resendInboundSecretEnc: string | null }>(
    `SELECT resendInboundSecretEnc FROM platform_settings WHERE id = 1 LIMIT 1`,
  );
  const enc = rows[0]?.resendInboundSecretEnc;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

export async function savePlatformEmail(input: {
  apiKey?: string;
  fromEmail?: string;
  fromName?: string;
  inboundEmail?: string;
  inboundSecret?: string;
}): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  // Chave ausente = mantém a que está salva (a tela manda vazio quando o admin
  // só quer trocar o remetente). String vazia explícita = remover.
  if (input.apiKey !== undefined) {
    sets.push("resendApiKeyEnc = ?");
    params.push(input.apiKey ? encryptSecret(input.apiKey) : null);
  }
  if (input.fromEmail !== undefined) {
    sets.push("resendFromEmail = ?");
    params.push(input.fromEmail || null);
  }
  if (input.fromName !== undefined) {
    sets.push("resendFromName = ?");
    params.push(input.fromName || null);
  }
  if (input.inboundEmail !== undefined) {
    sets.push("inboundEmail = ?");
    params.push(input.inboundEmail ? input.inboundEmail.trim().toLowerCase().slice(0, 320) : null);
  }
  // Mesma regra da chave: em branco mantém o segredo salvo — a tela nunca o
  // recebe de volta, então mandar vazio significaria apagá-lo sem querer.
  if (input.inboundSecret) {
    sets.push("resendInboundSecretEnc = ?");
    params.push(encryptSecret(input.inboundSecret.trim()));
  }
  if (!sets.length) return;
  await execute(`INSERT IGNORE INTO platform_settings (id) VALUES (1)`);
  await execute(`UPDATE platform_settings SET ${sets.join(", ")} WHERE id = 1`, params);
}

/**
 * Envia um e-mail COMO A PLATAFORMA. Devolve {ok,error} em vez de lançar —
 * quem chama é tela de admin e rotina de fundo, e nenhuma das duas deve cair
 * porque o Resend recusou.
 */
export async function sendPlatformEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Para onde a resposta deve voltar. Padrão: o endereço da caixa de entrada. */
  replyTo?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const cfg = await getPlatformEmailConfig();
  if (!cfg) return { ok: false, error: "E-mail da plataforma não configurado." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: `${cfg.fromName} <${cfg.fromEmail}>`,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      // O Resend explica bem a recusa (domínio não verificado, remetente
      // inválido...). Repassar o texto poupa uma ida ao painel deles.
      return { ok: false, error: data?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Falha de rede." };
  }
}
