import type { Metadata } from "next";
import "./globals.css";

// O favicon e o ícone do iOS vêm de `src/app/icon.png` e `apple-icon.png`:
// o Next os detecta pelo nome e injeta as tags sozinho.
//
// Este título vale para o PAINEL, o admin e o login. As páginas de loja
// (checkout, obrigado, Pix, rastreio) sobrescrevem com o nome da LOJA via
// `storeMetadata` — o comprador tem que ver a marca onde comprou, não a nossa.
export const metadata: Metadata = {
  title: "VOX",
  description: "VOX — checkout seguro",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning`: o script de tema do painel grava `data-theme`
    // no <html> ANTES de o React carregar (é o que evita o flash do tema
    // errado). Sem isto, toda página do painel acusava divergência de
    // hidratação no <html>. Vale só para os atributos deste elemento.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Poppins:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700&family=Rubik:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
