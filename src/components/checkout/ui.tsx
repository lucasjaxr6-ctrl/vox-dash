"use client";

import React from "react";
import { COR_PADRAO_SELO_SEGURO, type Theme } from "@/lib/checkout-theme";

// ── Arredondamento global das bordas do checkout ─────────────────────────────
//
// Uma escala só (0 = cantos retos, 100 = o arredondado original do Charm)
// controlada em Personalizar → Bordas.
//
// A implementação REESCREVE as utilidades do Tailwind dentro do escopo do
// checkout, em vez de trocar a classe de cada elemento. São dezenas de usos de
// `rounded-*`: trocar um por um seria garantir que alguém esquecesse metade.
// `.vox-corners .rounded-lg` (0,2,0) vence `.rounded-lg` (0,1,0) por
// especificidade, sem precisar de !important.
//
// `rounded-full` fica de FORA de propósito: é o que mantém avatar, radio, selo
// e o círculo das etapas redondos. Quadrar um avatar não é "borda mais
// quadrada", é defeito. Os campos "pill" do Charm, que também usam rounded-full
// mas DEVEM responder à escala, são marcados com `vox-pill`.
export const CORNERS_CLASS = "vox-corners";

/** Marcador para elementos "pill" que devem acompanhar a escala. */
export const PILL_CLASS = "vox-pill";

export function CornerStyle({ roundness }: { roundness: number }) {
  const f = Math.max(0, Math.min(100, Number(roundness) || 0)) / 100;
  const px = (n: number) => `${Math.round(n * f * 100) / 100}px`;
  return (
    <style>{`
.${CORNERS_CLASS} .rounded-2xl{border-radius:${px(16)}}
.${CORNERS_CLASS} .rounded-xl{border-radius:${px(12)}}
.${CORNERS_CLASS} .rounded-lg{border-radius:${px(8)}}
.${CORNERS_CLASS} .rounded-md{border-radius:${px(6)}}
.${CORNERS_CLASS} .rounded-sm{border-radius:${px(2)}}
.${CORNERS_CLASS} .rounded{border-radius:${px(4)}}
.${CORNERS_CLASS} .rounded-t-2xl{border-top-left-radius:${px(16)};border-top-right-radius:${px(16)};border-bottom-left-radius:0;border-bottom-right-radius:0}
.${CORNERS_CLASS} .rounded-l-lg{border-top-left-radius:${px(8)};border-bottom-left-radius:${px(8)}}
.${CORNERS_CLASS} .rounded-l-md{border-top-left-radius:${px(6)};border-bottom-left-radius:${px(6)}}
.${CORNERS_CLASS} .rounded-r-full{border-top-right-radius:${px(22)};border-bottom-right-radius:${px(22)}}
.${CORNERS_CLASS} .${PILL_CLASS}{border-radius:${px(22)}}
.${CORNERS_CLASS} .rounded-l-none{border-top-left-radius:0;border-bottom-left-radius:0}
`}</style>
  );
}

/**
 * Dados da empresa no rodapé (Personalizar → Rodapé e extras). Só aparece o
 * que a loja preencheu; sem nada preenchido, não desenha nada. Texto puro, sem
 * link: no checkout, telefone e e-mail clicáveis só tiram o cliente da compra.
 */
export function DadosDaEmpresa({ footer, className = "" }: { footer: Theme["footer"]; className?: string }) {
  const nome = footer.companyName?.trim();
  const cnpj = footer.cnpj?.trim();
  const endereco = footer.address?.trim();
  const contato = [footer.phone?.trim(), footer.email?.trim()].filter(Boolean).join(" · ");
  const identificacao = [nome, cnpj && `CNPJ ${cnpj}`].filter(Boolean).join(" · ");
  if (!identificacao && !endereco && !contato) return null;
  return (
    <div className={`space-y-0.5 text-xs leading-relaxed text-gray-400 ${className}`}>
      {identificacao && <p>{identificacao}</p>}
      {endereco && <p>{endereco}</p>}
      {contato && <p>{contato}</p>}
    </div>
  );
}

/**
 * Cadeado do "Pagamento seguro", com fechadura: sem ela o corpo vazio lia como
 * uma sacola. Um desenho só para o selo, a linha abaixo do botão de pagar e a
 * página do Pix.
 */
export function Cadeado({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="15.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 16.5v2.5" />
    </svg>
  );
}

/**
 * Selo "Pagamento 100% seguro": cadeado e as duas linhas na MESMA cor e em
 * negrito. `color` vem de Personalizar → Cores; sem ela, o cinza padrão.
 * Tons diferentes por linha (três cinzas, ou opacidade) faziam o selo parecer
 * de duas cores, pior ainda num cabeçalho escuro.
 */
export function LockBadge({ className = "", color }: { className?: string; color?: string | null }) {
  return (
    <div className={`flex items-center gap-2 ${className}`} style={{ color: color || COR_PADRAO_SELO_SEGURO }}>
      <Cadeado />
      <div className="selo-texto text-[11px] font-bold leading-tight tracking-wide">
        <div>PAGAMENTO</div>
        <div>100% SEGURO</div>
      </div>
    </div>
  );
}

/**
 * Linha do topo das telas da loja: a marca (logo ou nome) e, na outra ponta, o
 * que a tela mostra à direita (o selo de pagamento seguro, em geral).
 *
 * `center` põe a marca no meio DA TELA. Só empurrar para o meio do espaço livre
 * a deixaria torta, porque há conteúdo apenas à direita. A cópia invisível do
 * lado esquerdo faz as duas pontas terem sempre a mesma largura, e o limite de
 * largura de cada tela (`max-w-[65%]` etc.) dá lugar ao da coluna do meio.
 *
 * No celular o selo desce para uma linha só, logo abaixo da marca. Com ele ao
 * lado, medido com a logo real de uma loja (150px): sobravam 83px numa tela de
 * 360 e 43px numa de 320. `.selo-texto` marca o bloco de texto de cada selo.
 */
export function LinhaDoTopo({
  posicao,
  marca,
  direita,
  className = "",
}: {
  posicao: "left" | "center";
  marca: React.ReactNode;
  direita: React.ReactNode;
  className?: string;
}) {
  if (posicao !== "center") {
    return (
      <div className={`flex items-center justify-between ${className}`}>
        {marca}
        {direita}
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col items-center gap-y-1 [&_.selo-texto]:flex [&_.selo-texto]:gap-1 sm:grid sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-3 sm:[&_.selo-texto]:block ${className}`}
    >
      <div className="invisible hidden sm:block" aria-hidden="true">
        {direita}
      </div>
      <div className="flex w-full min-w-0 justify-center text-center [&>img]:max-w-full">{marca}</div>
      {direita}
    </div>
  );
}

export function Stars({ filled = 5 }: { filled?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={i < filled ? "#FBBF24" : "none"}
          stroke="#FBBF24"
          strokeWidth="2"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </div>
  );
}

/**
 * Bloqueio de tela enquanto o checkout sai para a página do Pix/do pedido.
 *
 * A cobrança JÁ foi criada quando isto aparece. Cobrir a tela impede o clique
 * extra que gerava um segundo pedido (e uma segunda cobrança no gateway)
 * enquanto o navegador ainda estava carregando o destino.
 */
export function LeavingOverlay({ color }: { color: string }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-white/95"
      role="status"
      aria-live="polite"
    >
      <span
        className="h-11 w-11 animate-spin rounded-full border-4 border-gray-200"
        style={{ borderTopColor: color }}
      />
      <p className="text-base font-bold text-gray-800">Preparando seu pagamento...</p>
      <p className="text-sm text-gray-500">Não feche nem atualize esta página.</p>
    </div>
  );
}

// Bandeiras aceitas (SVGs oficiais em /public/payment).
export function PaymentBrands() {
  const brands = [
    { src: "/payment/visa.svg", label: "Visa" },
    { src: "/payment/mastercard.svg", label: "Mastercard" },
    { src: "/payment/amex.svg", label: "American Express" },
    { src: "/payment/elo.svg", label: "Elo" },
    { src: "/payment/hipercard.svg", label: "Hipercard" },
    { src: "/payment/discover.svg", label: "Discover" },
    { src: "/payment/pix.svg", label: "Pix" },
  ];
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {brands.map((b) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={b.label}
          src={b.src}
          alt={b.label}
          title={b.label}
          className="h-7 w-auto rounded-md border border-gray-200 bg-white p-0.5"
        />
      ))}
    </div>
  );
}
