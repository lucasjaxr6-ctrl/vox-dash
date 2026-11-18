import { NextResponse } from "next/server";
import { findStoreByInstallToken, finishAppmaxInstall } from "@/lib/appmax-partner";

// GET /api/appmax/callback?token=...
// Retorno da autorização do merchant (redirect 302 do navegador dele). Casamos o
// token com a loja (guardado no /app/authorize), trocamos por credenciais do
// merchant e voltamos pro painel com o status.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  // O motivo da falha volta para o painel: "Falha ao concluir" sozinho não
  // dizia ao lojista (nem a nós) o que corrigir.
  const back = (status: string, motivo?: string) =>
    NextResponse.redirect(
      `${url.origin}/painel/pagamentos/appmax?appmax=${status}${motivo ? `&motivo=${encodeURIComponent(motivo.slice(0, 300))}` : ""}`,
    );

  if (!token) return back("erro", "A Appmax voltou sem o token de instalação.");
  try {
    const storeId = await findStoreByInstallToken(token);
    if (!storeId) return back("nao_encontrado");
    await finishAppmaxInstall(storeId, token);
    return back("conectado");
  } catch (e) {
    console.error("[appmax callback]", e instanceof Error ? e.message : e);
    return back("erro", e instanceof Error ? e.message : undefined);
  }
}
