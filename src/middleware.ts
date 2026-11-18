import { NextRequest, NextResponse } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// O middleware roda no Edge (sem banco). A AUTORIZAÇÃO REAL acontece em cada
// handler (que valida a sessão no banco). Aqui fazemos a defesa CSRF de borda:
// em requisições que ALTERAM estado, o Origin precisa ser o MESMO host da
// requisição (same-origin). Não depende de variável de ambiente — funciona em
// qualquer porta/host (localhost, 127.0.0.1, produção...).
// ─────────────────────────────────────────────────────────────────────────────

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Os cookies de sessão e de loja eram SameSite=Strict até 27/10/2026 (o motivo
// da troca está em lib/session.ts). Os já gravados continuam Strict até o
// lojista entrar de novo, e isso pode nunca acontecer: quem cai no login por
// causa deles volta ao painel sem digitar a senha (o login vê a sessão e
// redireciona). Então a regravação como Lax acontece aqui, na próxima visita
// ao painel. Pode sair quando todo cookie antigo tiver vencido: a sessão dura
// SESSION_TTL_SECONDS (7 dias por padrão).
const TTL_SESSAO = Math.max(1, Math.floor(Number(process.env.SESSION_TTL_SECONDS ?? 604800)));

function regravarComoLax(req: NextRequest, res: NextResponse) {
  const base = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };
  const sessao = req.cookies.get("bs_session")?.value;
  if (sessao) res.cookies.set("bs_session", sessao, { ...base, maxAge: TTL_SESSAO });
  const loja = req.cookies.get("bs_store")?.value;
  if (loja) res.cookies.set("bs_store", loja, base);
  return res;
}

export function middleware(req: NextRequest) {
  // Painel: entrega a rota ao layout (que não a recebe como parâmetro). É com
  // ela que o layout trava as seções enquanto a configuração da loja está
  // pendente, e que o login sabe para onde voltar. Só INFORMA a rota: quem
  // decide é o layout, com a sessão.
  if (req.nextUrl.pathname.startsWith("/painel")) {
    const headers = new Headers(req.headers);
    headers.set("x-pathname", req.nextUrl.pathname);
    return regravarComoLax(req, NextResponse.next({ request: { headers } }));
  }
  if (req.nextUrl.pathname.startsWith("/admin")) {
    return regravarComoLax(req, NextResponse.next());
  }

  if (MUTATING.has(req.method) && req.nextUrl.pathname.startsWith("/api/")) {
    // Webhooks externos (Shopify) são validados por HMAC no próprio handler.
    // O health check da Appmax também é público (não muda estado) e recebe POST
    // sem Origin same-origin, então fica de fora da defesa CSRF.
    const p = req.nextUrl.pathname;
    const isPublicApi = p.startsWith("/api/webhooks/") || p === "/api/appmax/health";
    if (!isPublicApi) {
      const origin = req.headers.get("origin");
      const host = req.headers.get("host");
      // same-origin: o host do Origin tem que bater com o Host da requisição.
      if (!origin || !host || new URL(origin).host !== host) {
        return NextResponse.json(
          { error: "Origem não permitida" },
          { status: 403 },
        );
      }
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/painel/:path*", "/admin/:path*"],
};
