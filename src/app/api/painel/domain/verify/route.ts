import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getDomainConfig, markDomainVerified } from "@/lib/settings";
import { verifyVercelDomain, vercelConfigured } from "@/lib/vercel";
import { resolveTxt, Resolver } from "dns/promises";

// Consulta TXT em vários resolvers (fallback, quando não há integração Vercel).
async function lookupTxt(name: string): Promise<string[]> {
  const attempts: Array<() => Promise<string[][]>> = [() => resolveTxt(name)];
  for (const servers of [["8.8.8.8", "8.8.4.4"], ["1.1.1.1", "1.0.0.1"]]) {
    attempts.push(() => {
      const r = new Resolver();
      r.setServers(servers);
      return r.resolveTxt(name);
    });
  }
  const out: string[] = [];
  for (const attempt of attempts) {
    try {
      const records = await attempt();
      for (const chunks of records) out.push(chunks.join("").trim().replace(/^"|"$/g, ""));
    } catch {
      /* tenta o próximo resolver */
    }
  }
  return out;
}

// POST /api/painel/domain/verify
export async function POST() {
  try {
    const { store } = await requireStore();
    const cfg = await getDomainConfig(store.id);
    if (!cfg.customDomain) return json({ error: "Configure um domínio primeiro." }, 400);

    // ── Modo Vercel: a própria Vercel confirma posse + DNS (e emite o SSL). ──
    if (vercelConfigured()) {
      const st = await verifyVercelDomain(cfg.customDomain);
      if (st.registered && st.verified && !st.misconfigured) {
        await markDomainVerified(store.id);
        return json({ ok: true, verified: true });
      }
      if (!st.registered) {
        return json({ ok: false, verified: false, error: st.error || "Domínio ainda não registrado na Vercel. Tente novamente em instantes." });
      }
      if (st.verification.some((v) => v.type.toUpperCase() === "TXT")) {
        return json({ ok: false, verified: false, error: "Adicione o registro TXT de verificação exibido e tente de novo." });
      }
      return json({
        ok: false,
        verified: false,
        error: "O CNAME ainda não aponta para a Vercel (ou está propagando). Confira o registro e aguarde alguns minutos.",
      });
    }

    // ── Fallback (sem integração Vercel): verificação por TXT próprio. ──
    if (!cfg.domainToken) return json({ error: "Configure um domínio primeiro." }, 400);
    const name = `_checkout-verify.${cfg.customDomain}`;
    const values = await lookupTxt(name);
    if (values.length === 0) {
      return json({ ok: false, verified: false, error: "Registro TXT ainda não encontrado. A propagação do DNS pode levar de minutos a horas." });
    }
    if (!values.includes(cfg.domainToken.trim())) {
      return json({ ok: false, verified: false, error: "O valor do registro TXT não confere. Verifique se copiou corretamente." });
    }
    await markDomainVerified(store.id);
    return json({ ok: true, verified: true });
  } catch (err) {
    return handleError(err);
  }
}
