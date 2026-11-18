import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Vercel Domains API — registra AUTOMATICAMENTE o domínio do lojista no projeto
// da Vercel (elimina o passo manual no dashboard). Sem isso, um domínio apontado
// para a Vercel devolve "DEPLOYMENT_NOT_FOUND". A Vercel emite o SSL sozinha
// quando o CNAME aponta corretamente.
//
// Env necessárias: VERCEL_TOKEN, VERCEL_PROJECT_ID e (se em time) VERCEL_TEAM_ID.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.vercel.com";

function cfg() {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID || undefined;
  if (!token || !projectId) return null;
  return { token, projectId, teamId };
}

/** True se a integração com a Vercel está configurada (env presentes). */
export function vercelConfigured(): boolean {
  return cfg() !== null;
}

function withTeam(url: string, teamId?: string): string {
  if (!teamId) return url;
  return url + (url.includes("?") ? "&" : "?") + "teamId=" + encodeURIComponent(teamId);
}

function headers(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export type VercelDomainStatus = {
  ok: boolean;
  registered: boolean; // está no projeto
  verified: boolean; // posse confirmada
  misconfigured: boolean; // DNS ainda não aponta para a Vercel
  verification: { type: string; domain: string; value: string }[]; // TXT extra (raro)
  error?: string;
};

const EMPTY: VercelDomainStatus = { ok: false, registered: false, verified: false, misconfigured: true, verification: [] };

/** Lê o status do domínio no projeto (registrado/verificado) + config (DNS ok?). */
export async function getVercelDomainStatus(domain: string): Promise<VercelDomainStatus> {
  const c = cfg();
  if (!c) return { ...EMPTY, error: "Vercel não configurada." };
  try {
    const pRes = await fetch(withTeam(`${API}/v9/projects/${c.projectId}/domains/${domain}`, c.teamId), { headers: headers(c.token) });
    const pData = await pRes.json().catch(() => ({} as any));
    const registered = pRes.ok;
    const verified = Boolean(pData?.verified);
    const verification = Array.isArray(pData?.verification)
      ? pData.verification.map((v: any) => ({ type: String(v.type), domain: String(v.domain), value: String(v.value) }))
      : [];

    let misconfigured = true;
    try {
      const cRes = await fetch(withTeam(`${API}/v6/domains/${domain}/config`, c.teamId), { headers: headers(c.token) });
      const cData = await cRes.json().catch(() => ({} as any));
      if (cRes.ok) misconfigured = Boolean(cData?.misconfigured);
    } catch {
      /* mantém misconfigured=true */
    }

    return { ok: true, registered, verified, misconfigured, verification };
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : "Falha ao consultar a Vercel." };
  }
}

/** Adiciona o domínio ao projeto (idempotente) e retorna o status atual. */
export async function addDomainToVercel(domain: string): Promise<VercelDomainStatus> {
  const c = cfg();
  if (!c) return { ...EMPTY, error: "Vercel não configurada." };
  try {
    const res = await fetch(withTeam(`${API}/v10/projects/${c.projectId}/domains`, c.teamId), {
      method: "POST",
      headers: headers(c.token),
      body: JSON.stringify({ name: domain }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({} as any));
      const code = data?.error?.code as string | undefined;
      // Já existe NESTE projeto -> ok, segue para status.
      const alreadyHere = res.status === 409 || code === "domain_already_exists";
      if (!alreadyHere) {
        // Em uso por OUTRO time/conta da Vercel -> precisa remover de lá antes.
        if (code === "domain_already_in_use" || code === "forbidden") {
          return { ...EMPTY, error: "Este domínio já está registrado em outra conta/projeto da Vercel. Remova-o de lá e tente novamente." };
        }
        return { ...EMPTY, error: data?.error?.message || `Vercel respondeu ${res.status}` };
      }
    }
    return getVercelDomainStatus(domain);
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : "Falha ao registrar na Vercel." };
  }
}

/** Dispara a verificação de posse na Vercel e retorna o status. */
export async function verifyVercelDomain(domain: string): Promise<VercelDomainStatus> {
  const c = cfg();
  if (!c) return { ...EMPTY, error: "Vercel não configurada." };
  try {
    await fetch(withTeam(`${API}/v9/projects/${c.projectId}/domains/${domain}/verify`, c.teamId), {
      method: "POST",
      headers: headers(c.token),
    });
  } catch {
    /* segue para o status mesmo assim */
  }
  return getVercelDomainStatus(domain);
}

/** Remove o domínio do projeto (ao trocar/excluir). Best-effort. */
export async function removeDomainFromVercel(domain: string): Promise<void> {
  const c = cfg();
  if (!c) return;
  try {
    await fetch(withTeam(`${API}/v9/projects/${c.projectId}/domains/${domain}`, c.teamId), {
      method: "DELETE",
      headers: headers(c.token),
    });
  } catch {
    /* ignore */
  }
}
