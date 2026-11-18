import "server-only";
import { query, execute } from "./db";
import { getPaymentRouting, getShopifyCredentials } from "./settings";
import type { EtapaRota } from "./onboarding-rotas";

// ─────────────────────────────────────────────────────────────────────────────
// Configuração inicial da loja (Shopify · Domínio · Gateway · Resend).
//
// Enquanto não termina, o painel só abre o Início e as telas das etapas
// pendentes. Ao terminar, a loja é marcada em `store_onboarding` e fica
// liberada DE VEZ: se depois o gateway cair ou o domínio parar de responder, a
// etapa volta a aparecer pendente no Início, mas o painel não trava de novo —
// travar Vendas de uma loja em operação por um gateway bloqueado seria tirar o
// lojista do ar justo quando ele mais precisa.
//
// Lojas que já existiam antes desta regra foram marcadas como concluídas pela
// migração (scripts/migrate-onboarding.mjs).
// ─────────────────────────────────────────────────────────────────────────────

export type EtapaId = "shopify" | "dominio" | "gateway" | "resend";

export type Etapa = EtapaRota & {
  id: EtapaId;
  titulo: string;
  desc: string;
  href: string;
  acao: string;
};

/** As quatro etapas, cada uma conferida no dado real. */
export async function etapasDaLoja(storeId: string): Promise<Etapa[]> {
  const [shopify, routing, [cfg], [prod]] = await Promise.all([
    getShopifyCredentials(storeId).then((c) => !!c),
    getPaymentRouting(storeId),
    query<{ domainVerified: number; temResend: number }>(
      // Resend "conectado" = a mesma regra de envio de getResendConfig: ligado,
      // com chave e remetente. Chave salva com o envio desligado não manda e-mail.
      `SELECT domainVerified,
              (resendEnabled = 1 AND resendApiKeyEnc IS NOT NULL AND resendApiKeyEnc <> ''
                AND resendFromEmail IS NOT NULL AND resendFromEmail <> '') AS temResend
         FROM store_settings WHERE storeId = ? LIMIT 1`,
      [storeId],
    ),
    query<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE storeId = ?`, [storeId]),
  ]);

  // Shopify em dois tempos: conectar e ter os produtos. A conexão já sincroniza
  // sozinha; se não vier nada, o próximo passo é o botão de sincronizar.
  const shopifyHref = shopify ? "/painel/produtos" : "/painel/shopify";
  return [
    {
      id: "shopify",
      titulo: "Shopify",
      desc: shopify ? "Sincronize os produtos da sua Shopify." : "Conecte sua loja Shopify ao checkout.",
      feito: shopify && Number(prod?.n ?? 0) > 0,
      href: shopifyHref,
      acao: shopify ? "Sincronizar" : "Conectar",
      rotas: [shopifyHref],
    },
    {
      id: "dominio",
      titulo: "Domínio",
      desc: "Configure o domínio do checkout da sua loja.",
      feito: Number(cfg?.domainVerified ?? 0) === 1,
      href: "/painel/dominio",
      acao: "Configurar",
      rotas: ["/painel/dominio"],
    },
    {
      id: "gateway",
      titulo: "Gateway",
      desc: "Configure seu gateway de pagamentos.",
      feito: Boolean(routing.pixProvider || routing.cardProvider),
      href: "/painel/pagamentos",
      acao: "Instalar",
      rotas: ["/painel/pagamentos", "/painel/pagamentos/*"],
    },
    {
      id: "resend",
      titulo: "E-mails (Resend)",
      desc: "Conecte o Resend para enviar Pix, confirmação e rastreio aos clientes.",
      feito: Number(cfg?.temResend ?? 0) === 1,
      href: "/painel/emails",
      acao: "Conectar",
      rotas: ["/painel/emails"],
    },
  ];
}

const tabelaAusente = (e: unknown) => (e as { code?: string })?.code === "ER_NO_SUCH_TABLE";

/**
 * A loja já terminou a configuração (alguma vez)? Uma consulta barata — roda
 * em toda navegação do painel.
 *
 * Sem a tabela (migração atrasada) responde "sim": é melhor deixar alguém
 * entrar sem passar pelo passo a passo do que trancar todos os lojistas.
 */
export async function onboardingConcluido(storeId: string): Promise<boolean> {
  try {
    const [r] = await query<{ ok: number }>(`SELECT 1 AS ok FROM store_onboarding WHERE storeId = ? LIMIT 1`, [storeId]);
    return Boolean(r);
  } catch (e) {
    if (tabelaAusente(e)) {
      console.error("[onboarding] tabela store_onboarding ausente — rode scripts/migrate-onboarding.mjs");
      return true;
    }
    throw e;
  }
}

/**
 * Situação completa. Quando as quatro etapas acabaram de ficar prontas, grava
 * a conclusão — é o que destrava o painel.
 */
export async function statusOnboarding(storeId: string): Promise<{ concluido: boolean; etapas: Etapa[] }> {
  const [concluido, etapas] = await Promise.all([onboardingConcluido(storeId), etapasDaLoja(storeId)]);
  if (concluido) return { concluido, etapas };
  if (etapas.every((e) => e.feito)) {
    await execute(`INSERT IGNORE INTO store_onboarding (storeId) VALUES (?)`, [storeId]);
    return { concluido: true, etapas };
  }
  return { concluido: false, etapas };
}
