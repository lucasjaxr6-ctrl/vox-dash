import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { vitrineDoDominio } from "@/lib/stores";
import Landing from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "VOX | Checkout transparente para Shopify",
  description:
    "Checkout transparente para Shopify com domínio próprio, múltiplos gateways, Smart Routing, recuperação de vendas e visão da operação em tempo real.",
  openGraph: {
    title: "VOX | Infraestrutura de checkout para Shopify",
    description: "Seu checkout não deveria parar porque um gateway parou.",
    type: "website",
  },
};

// A barra do navegador do celular acompanha o hero (branco, modo claro).
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

// Raiz do site: SEMPRE a landing, com ou sem login (decisão do dono). Quem já
// tem sessão vê "Ir para o painel" no lugar de "Entrar" e cai direto no lugar
// certo, sem passar pelo login de novo.
//
// Exceção: no domínio de checkout de uma loja (checkout.loja.com.br) a raiz
// é dela, não da VOX. Quem abre ali é cliente da loja e volta para a vitrine.
export default async function Home() {
  const vitrine = await vitrineDoDominio((await headers()).get("host"));
  if (vitrine) redirect(vitrine);

  const user = await getCurrentUser().catch(() => null);
  const entrar =
    user?.role === "ADMIN"
      ? { href: "/admin", rotulo: "Ir para o admin" }
      : user?.role === "MERCHANT"
        ? { href: "/painel/inicio", rotulo: "Ir para o painel" }
        : { href: "/login", rotulo: "Entrar" };
  return <Landing entrarHref={entrar.href} entrarRotulo={entrar.rotulo} />;
}
