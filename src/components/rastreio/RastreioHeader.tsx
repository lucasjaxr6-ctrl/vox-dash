import type { Theme } from "@/lib/checkout-theme";
import { LinhaDoTopo } from "@/components/checkout/ui";

/** Cabeçalho das telas de rastreio — mesma marca do checkout. */
export default function RastreioHeader({ theme, storeName }: { theme: Theme; storeName: string }) {
  return (
    <header className="border-b border-gray-100" style={{ background: theme.header.bg }}>
      <LinhaDoTopo
        posicao={theme.header.logoPosition}
        className="mx-auto max-w-5xl px-4 py-5"
        marca={
          <a href="/rastreio" className={`flex min-w-0 items-center ${theme.header.logoPosition === "center" ? "[&>img]:max-w-full" : ""}`}>
            {theme.header.showLogo && theme.header.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={theme.header.logoUrl}
                alt={storeName}
                className="w-auto max-w-[65%] object-contain"
                // Maior que no checkout: lá a altura é apertada de propósito para
                // o formulário caber na primeira tela. Aqui a pessoa chegou pelo
                // e-mail e a marca é o que diz que ela está no lugar certo.
                style={{ height: Math.max(52, Math.round((theme.header.logoHeight || 40) * 1.4)) }}
              />
            ) : (
              <span className="text-xl font-bold text-gray-800">{storeName}</span>
            )}
          </a>
        }
        direita={
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Rastreamento
          </span>
        }
      />
    </header>
  );
}
