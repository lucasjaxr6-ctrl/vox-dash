import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { getDomainConfig } from "@/lib/settings";
import { partnerConfigured, startAppmaxInstall, getStoreSandbox } from "@/lib/appmax-partner";

// POST /api/painel/appmax/connect
// Inicia a instalação do app Appmax para a loja ativa: chama /app/authorize e
// devolve a URL onde o lojista autoriza (o retorno cai em /api/appmax/callback).
export async function POST(req: Request) {
  try {
    const { store } = await requireStore();
    if (!(await partnerConfigured(store.id))) {
      return json({ error: "App parceiro Appmax não configurado. Preencha App ID, Client ID (UUID público) e Client Secret na aba Appmax." }, 400);
    }
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host || host.includes("localhost") || host.startsWith("127.")) {
      return json({ error: "Publique a aplicação em HTTPS público antes de conectar a Appmax." }, 400);
    }
    const origin = `${proto}://${host}`;
    const callbackUrl = `${origin}/api/appmax/callback`;

    const dom = await getDomainConfig(store.id);
    // Domínio próprio da loja se houver; senão, o host atual (a Appmax exige ao
    // menos um domínio válido — mandar [] costuma dar 422).
    const domains = dom.customDomain ? [dom.customDomain] : [host];

    let token: string;
    try {
      token = await startAppmaxInstall(store.id, { callbackUrl, domains });
    } catch (e) {
      // Surface a causa REAL (auth do parceiro / erro do /app/authorize) em vez do
      // "Erro interno" genérico — assim dá pra diagnosticar.
      const message = e instanceof Error ? e.message : "Falha ao conectar a Appmax.";
      return json({ error: message }, 502);
    }

    // URL onde o LOJISTA autoriza (admin dele na Appmax). O token vai no PATH:
    // /appstore/integration/{token}. Configurável por env caso mude.
    const sandbox = await getStoreSandbox(store.id);
    const base =
      process.env.APPMAX_AUTHORIZE_URL ||
      (sandbox
        ? "https://breakingcode.sandboxappmax.com.br/appstore/integration"
        : "https://admin.appmax.com.br/appstore/integration");
    const authorizeUrl = `${base.replace(/\/$/, "")}/${token}`;
    return json({ ok: true, authorizeUrl });
  } catch (err) {
    return handleError(err);
  }
}
