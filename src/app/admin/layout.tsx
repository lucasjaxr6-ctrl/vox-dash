import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin, HttpError } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import { PLATFORM_STORE_ID, countInboundUnread } from "@/lib/inbound";

export const dynamic = "force-dynamic";

// Título estático — ver a nota em src/app/painel/layout.tsx: sem ele a aba
// mostra a URL enquanto a página dinâmica carrega.
export const metadata: Metadata = { title: "VOX" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Gate único de todo o /admin/*: só ADMIN entra.
  let userName: string | null = null;
  let userEmail: string | null = null;
  try {
    const user = await requireAdmin();
    userName = user.name ?? null;
    userEmail = user.email ?? null;
  } catch (e) {
    // Só falta de sessão ou de permissão manda para o login. Erro de banco
    // sobe para a tela de erro: mandar ao login quem está logado só confunde
    // (ver a mesma nota em src/app/painel/layout.tsx).
    if (e instanceof HttpError) redirect("/login");
    throw e;
  }

  // Contador do menu. Uma contagem indexada por página do admin é barata, e sem
  // ela não haveria como saber que chegou e-mail sem abrir a caixa.
  const naoLidos = await countInboundUnread(PLATFORM_STORE_ID).catch(() => 0);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('vox-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}" }} />
      <AdminShell naoLidos={naoLidos} userName={userName} userEmail={userEmail}>{children}</AdminShell>
    </>
  );
}
