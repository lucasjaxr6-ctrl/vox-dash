import "server-only";
import { randomUUID } from "crypto";
import { query, execute } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Fluxo de INSTALAÇÃO do app PARCEIRO Appmax (multi-merchant).
//   1) /app/authorize (Bearer do parceiro) -> token de uso único.
//   2) merchant autoriza -> Appmax redireciona pro callback com ?token=.
//   3) /app/client/generate {token} -> client_id/secret DO MERCHANT (por loja).
//   4) chamadas de cobrança usam o token do MERCHANT + header external-id.
// O app parceiro (app_id + client_id/secret) é da PLATAFORMA, fica em env.
// ─────────────────────────────────────────────────────────────────────────────

const PROD = { api: "https://api.appmax.com.br", auth: "https://auth.appmax.com.br/oauth2/token" };
const SANDBOX = { api: "https://api.sandboxappmax.com.br", auth: "https://auth.sandboxappmax.com.br/oauth2/token" };

export function appmaxEnv(sandbox?: boolean) {
  const s = sandbox ?? (process.env.APPMAX_SANDBOX === "1");
  return s ? SANDBOX : PROD;
}

/** Flag sandbox da loja (usada para escolher os endpoints prod vs sandbox). */
export async function getStoreSandbox(storeId: string): Promise<boolean> {
  const rows = await query<{ appmaxSandbox: number }>(
    `SELECT appmaxSandbox FROM store_settings WHERE storeId = ? LIMIT 1`, [storeId],
  );
  return (rows[0]?.appmaxSandbox ?? 0) === 1;
}
function envPartner() {
  return {
    appId: process.env.APPMAX_APP_ID ?? "",
    clientId: process.env.APPMAX_PARTNER_CLIENT_ID ?? "",
    clientSecret: process.env.APPMAX_PARTNER_CLIENT_SECRET ?? "",
  };
}

/**
 * Credenciais do app PARCEIRO desta loja. Se a loja configurou as suas (App ID +
 * Client ID + Client Secret), usa elas; senão, cai no env da plataforma (Vercel)
 * — assim lojas antigas (ex.: Della) seguem no app parceiro do env.
 */
async function getStorePartner(storeId: string): Promise<{ appId: string; clientId: string; clientSecret: string; sandbox: boolean }> {
  const rows = await query<{ appmaxAppId: string | null; appmaxPartnerClientId: string | null; appmaxPartnerClientSecretEnc: string | null; appmaxSandbox: number }>(
    `SELECT appmaxAppId, appmaxPartnerClientId, appmaxPartnerClientSecretEnc, appmaxSandbox FROM store_settings WHERE storeId = ? LIMIT 1`,
    [storeId],
  );
  const s = rows[0];
  const sandbox = (s?.appmaxSandbox ?? 0) === 1;
  if (s?.appmaxAppId && s.appmaxPartnerClientId && s.appmaxPartnerClientSecretEnc) {
    try {
      return { appId: s.appmaxAppId, clientId: s.appmaxPartnerClientId, clientSecret: decryptSecret(s.appmaxPartnerClientSecretEnc), sandbox };
    } catch {
      /* secret corrompido -> cai no env */
    }
  }
  return { ...envPartner(), sandbox };
}

/** A loja (ou o env, como fallback) tem app parceiro configurado? */
export async function partnerConfigured(storeId: string): Promise<boolean> {
  const p = await getStorePartner(storeId);
  return !!(p.appId && p.clientId && p.clientSecret);
}

/** Token do app PARCEIRO (client_credentials) — credenciais da LOJA ou do env. */
export async function getPartnerToken(storeId: string): Promise<string> {
  const p = await getStorePartner(storeId);
  if (!p.clientId || !p.clientSecret) {
    throw new Error("App parceiro Appmax não configurado (nem na loja, nem no env).");
  }
  const res = await fetch(appmaxEnv(p.sandbox).auth, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: p.clientId, client_secret: p.clientSecret }),
  });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data?.access_token) {
    throw new Error(`Auth do parceiro Appmax falhou: ${data?.message || data?.error || res.status}`);
  }
  return String(data.access_token);
}

/** external_id (UUID) da loja — cria e persiste se ainda não houver. */
export async function getOrCreateExternalId(storeId: string): Promise<string> {
  const rows = await query<{ appmaxExternalId: string | null }>(
    `SELECT appmaxExternalId FROM store_settings WHERE storeId = ? LIMIT 1`, [storeId],
  );
  if (rows[0]?.appmaxExternalId) return rows[0].appmaxExternalId;
  const id = randomUUID();
  await execute(`UPDATE store_settings SET appmaxExternalId = ? WHERE storeId = ?`, [id, storeId]);
  return id;
}

/** Passo 1: inicia a instalação. Guarda o token->loja e devolve o token. */
export async function startAppmaxInstall(storeId: string, opts: { callbackUrl: string; domains: string[] }): Promise<string> {
  await getOrCreateExternalId(storeId);
  const p = await getStorePartner(storeId);
  const token = await getPartnerToken(storeId);
  const res = await fetch(`${appmaxEnv(p.sandbox).api}/app/authorize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      app_id: p.appId,
      external_key: storeId, // nossa referência da loja
      url_callback: opts.callbackUrl,
      domain_names: opts.domains,
    }),
  });
  const data = await res.json().catch(() => ({} as any));
  const installToken = data?.data?.token ?? data?.token;
  if (!res.ok || !installToken) {
    console.error("[appmax authorize]", res.status, JSON.stringify(data).slice(0, 500));
    // Expõe o motivo REAL (422 = validação): message + campos de errors.
    const errs = data?.errors && typeof data.errors === "object"
      ? Object.entries(data.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" | ")
      : "";
    const detail = [data?.message, errs].filter(Boolean).join(" — ") || `HTTP ${res.status}`;
    throw new Error(`Falha ao iniciar a instalação Appmax: ${detail}`);
  }
  await execute(`UPDATE store_settings SET appmaxInstallToken = ? WHERE storeId = ?`, [String(installToken), storeId]);
  return String(installToken);
}

/** Passo 2: resolve a loja a partir do token do callback. */
export async function findStoreByInstallToken(token: string): Promise<string | null> {
  const rows = await query<{ storeId: string }>(
    `SELECT storeId FROM store_settings WHERE appmaxInstallToken = ? LIMIT 1`, [token],
  );
  return rows[0]?.storeId ?? null;
}

/** Passo 3: troca o token pelas credenciais do MERCHANT e salva na loja. */
export async function finishAppmaxInstall(storeId: string, token: string): Promise<void> {
  const partnerToken = await getPartnerToken(storeId);
  const sandbox = await getStoreSandbox(storeId);
  const res = await fetch(`${appmaxEnv(sandbox).api}/app/client/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${partnerToken}`, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json().catch(() => ({} as any));
  const client = data?.data?.client ?? data?.client ?? {};
  const clientId = client?.client_id;
  const clientSecret = client?.client_secret;
  if (!res.ok || !clientId || !clientSecret) {
    // O corpo inteiro vai para o log como TEXTO: com o objeto, o log da Vercel
    // mostrava só `errors: {…}` e o motivo real se perdia.
    console.error(`[appmax generate] ${res.status} ${JSON.stringify(data).slice(0, 1500)}`);
    // Mesmo formato do /app/authorize: message + cada campo de `errors`.
    const errs = data?.errors && typeof data.errors === "object"
      ? Object.entries(data.errors).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v}`).join(" | ")
      : "";
    const detail = [data?.message, errs].filter(Boolean).join(" — ") || `HTTP ${res.status}`;
    throw new Error(`A Appmax recusou gerar as credenciais da loja (${res.status}): ${detail}`);
  }
  await getOrCreateExternalId(storeId);
  await execute(
    `UPDATE store_settings
       SET appmaxMerchantClientIdEnc = ?, appmaxMerchantClientSecretEnc = ?, appmaxInstallToken = NULL, appmaxConnectedAt = NOW(3)
     WHERE storeId = ?`,
    [encryptSecret(String(clientId)), encryptSecret(String(clientSecret)), storeId],
  );
}
