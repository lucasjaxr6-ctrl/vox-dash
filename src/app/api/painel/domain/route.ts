import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getDomainConfig, setCustomDomain, type DomainConfig } from "@/lib/settings";
import { setDomainSchema } from "@/lib/validation";
import { query } from "@/lib/db";
import { limiteDeDominios } from "@/lib/plans";
import { PLANOS } from "@/lib/planos";
import { randomBytes } from "crypto";
import { addDomainToVercel, getVercelDomainStatus, removeDomainFromVercel, vercelConfigured } from "@/lib/vercel";

const TARGET =
  process.env.PLATFORM_DOMAIN_TARGET || "cname.vercel-dns.com";

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// O checkout usa um subdomínio (CNAME, sem A/apex). O lojista ESCOLHE o
// subdomínio que quiser (checkout, seguro, pay...). Respeitamos exatamente o que
// ele digitar; se vier só o domínio raiz, completamos com "checkout." por padrão.
const DEFAULT_SUBDOMAIN = "checkout";
// Detecta domínio-raiz (apex) SEM subdomínio, cobrindo TLDs de 2 níveis comuns
// no Brasil (com.br, net.br...). Só nesses casos prefixamos o padrão.
function isApex(host: string): boolean {
  const parts = host.split(".");
  if (parts.length <= 2) return true; // sualoja.com
  if (parts.length === 3 && /^(com|net|org|gov|edu|co|adv|eco|art)$/.test(parts[parts.length - 2])) return true; // sualoja.com.br
  return false;
}
function ensureSubdomain(host: string): string {
  return isApex(host) ? `${DEFAULT_SUBDOMAIN}.${host}` : host;
}

// Monta a resposta unindo o estado do banco + (se configurado) o status na Vercel.
async function buildResponse(cfg: DomainConfig) {
  const label = cfg.customDomain ? cfg.customDomain.split(".")[0] : null;
  const base = {
    customDomain: cfg.customDomain,
    verified: cfg.domainVerified,
    verifiedAt: cfg.domainVerifiedAt,
    cnameTarget: TARGET,
    cnameHost: label,
    vercelManaged: vercelConfigured(),
    misconfigured: false,
    txtHost: null as string | null,
    txtValue: null as string | null,
  };

  if (!cfg.customDomain) return base;

  if (vercelConfigured()) {
    const st = await getVercelDomainStatus(cfg.customDomain);
    // TXT só aparece quando a Vercel EXIGE (domínio já usado em outra conta) — raro.
    const txt = st.verification.find((v) => v.type.toUpperCase() === "TXT");
    return {
      ...base,
      verified: cfg.domainVerified || (st.registered && st.verified && !st.misconfigured),
      misconfigured: st.misconfigured,
      txtHost: txt ? txt.domain : null,
      txtValue: txt ? txt.value : null,
    };
  }

  // Fallback (sem a integração Vercel): TXT de posse próprio + verificação por DNS.
  return {
    ...base,
    txtHost: `_checkout-verify.${label}`,
    txtValue: cfg.domainToken,
  };
}

// GET /api/painel/domain -> domínio atual + instruções de DNS (+ status Vercel).
export async function GET() {
  try {
    const { store } = await requireStore();
    return json(await buildResponse(await getDomainConfig(store.id)));
  } catch (err) {
    return handleError(err);
  }
}

// PUT /api/painel/domain -> salva o domínio e registra AUTOMATICAMENTE na Vercel.
export async function PUT(req: Request) {
  try {
    const { store } = await requireStore();
    const body = await req.json();
    const { domain } = setDomainSchema.parse(body);
    const normalized = normalizeDomain(domain);

    const current = await getDomainConfig(store.id);

    // Limpar o domínio.
    if (!normalized) {
      if (current.customDomain) await removeDomainFromVercel(current.customDomain);
      await setCustomDomain(store.id, null, null);
      return json(await buildResponse(await getDomainConfig(store.id)));
    }
    if (!HOSTNAME_RE.test(normalized)) {
      return json({ error: "Domínio inválido. Ex.: sualoja.com" }, 400);
    }

    const full = ensureSubdomain(normalized);
    if (!HOSTNAME_RE.test(full)) return json({ error: "Domínio inválido." }, 400);

    // customDomain é único globalmente (chave de resolução pública).
    const taken = await query<{ storeId: string }>(
      `SELECT storeId FROM store_settings WHERE customDomain = ? AND storeId <> ? LIMIT 1`,
      [full, store.id],
    );
    if (taken[0]) return json({ error: "Este domínio já está em uso por outra loja." }, 409);

    // Limite de domínios do plano. Só barra quando a loja GANHA um domínio:
    // trocar o de uma loja que já tem um não aumenta o uso.
    if (!current.customDomain) {
      const lim = await limiteDeDominios(store.id);
      if (!lim.ok) {
        return json(
          {
            error: `Seu plano ${PLANOS[lim.plano].nome} permite ${lim.limite} ${lim.limite === 1 ? "domínio" : "domínios"}, e sua conta já usa ${lim.usados}. Mude de plano em Início → Plano para adicionar mais.`,
          },
          403,
        );
      }
    }

    // Trocou de domínio: remove o antigo da Vercel.
    if (current.customDomain && current.customDomain !== full) {
      await removeDomainFromVercel(current.customDomain);
    }

    const token = "checkout-verify=" + randomBytes(16).toString("hex");
    await setCustomDomain(store.id, full, token);

    // Registra na Vercel (automático). Se falhar, o domínio fica salvo e
    // devolvemos um aviso — o lojista pode "Verificar" de novo depois.
    let vercelError: string | undefined;
    if (vercelConfigured()) {
      const res = await addDomainToVercel(full);
      if (!res.ok && res.error) vercelError = res.error;
    }

    const out = await buildResponse(await getDomainConfig(store.id));
    return json(vercelError ? { ...out, vercelError } : out);
  } catch (err) {
    return handleError(err);
  }
}
