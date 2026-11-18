"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Stars } from "@/components/checkout/ui";
import type { CheckoutReview } from "@/lib/checkout-helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Avaliações do checkout, compartilhadas pelos QUATRO modelos.
//
//   • Celular  → carrossel: o cliente arrasta o dedo e para na avaliação que
//                quiser. Empilhado, 3 depoimentos longos viravam uma parede de
//                texto que empurrava o botão de pagar para longe.
//   • Desktop  → empilhado, como sempre foi: lá sobra altura e ver as
//                avaliações de uma vez é melhor do que obrigar a clicar.
//
// O arraste é o scroll NATIVO do navegador com `scroll-snap`, não um carrossel
// em JavaScript. Isso importa: a inércia, a borracha do iOS e o gesto de voltar
// do Android continuam sendo os do sistema, e o dedo do cliente decide onde
// parar — que é exatamente o comportamento pedido. Um carrossel em JS teria que
// reimplementar tudo isso e erraria em algum aparelho.
//
// NÃO há avanço automático de propósito: trocar o depoimento sozinho enquanto a
// pessoa lê é a forma mais rápida de fazê-la desistir de ler.
// ─────────────────────────────────────────────────────────────────────────────

export default function ReviewsBlock({
  reviews,
  variant = "plain",
  className = "",
}: {
  reviews: CheckoutReview[];
  /** "boxed" = cada avaliação num cartão cinza. */
  variant?: "plain" | "boxed";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  // Índice ativo a partir da posição real da rolagem — serve para os pontinhos.
  const onScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const first = el.firstElementChild as HTMLElement | null;
    if (!first) return;
    // Largura do slide + o gap entre eles.
    const step = first.offsetWidth + 12;
    setActive(Math.max(0, Math.min(reviews.length - 1, Math.round(el.scrollLeft / step))));
  }, [reviews.length]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  function goTo(i: number) {
    const el = trackRef.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    el.scrollTo({ left: i * (first.offsetWidth + 12), behavior: "smooth" });
  }

  if (reviews.length === 0) return null;
  const many = reviews.length > 1;

  return (
    <aside className={`rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:p-6 ${className}`}>
      {/* ── Celular: carrossel ── */}
      <div className="lg:hidden">
        <div
          ref={trackRef}
          // `-mx-4 px-4`: os cartões encostam na borda do bloco ao rolar, o que
          // deixa claro que há mais conteúdo para o lado.
          className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {reviews.map((r) => (
            <div
              key={r.id}
              // 86% deixa a próxima avaliação "espiando" na lateral — é o que
              // sinaliza ao cliente que dá para arrastar, sem precisar de seta.
              // O fundo cinza dá contorno ao cartão: num carrossel é ele que
              // mostra onde uma avaliação termina e a outra começa.
              className="w-[86%] flex-shrink-0 snap-center rounded-xl bg-gray-50 p-4"
            >
              <ReviewCardMobile r={r} />
            </div>
          ))}
        </div>

        {many && (
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {reviews.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Ver avaliação ${i + 1} de ${reviews.length}`}
                className={`rounded-full transition-all duration-300 ${i === active ? "h-2 w-2 bg-gray-800" : "h-1.5 w-1.5 bg-gray-300"}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Desktop: empilhado ── */}
      <div className="hidden lg:block">
        {reviews.map((r, i) => (
          <React.Fragment key={r.id}>
            {i > 0 && variant !== "boxed" && <hr className="my-4 border-gray-100" />}
            <div className={variant === "boxed" ? "mt-3 rounded-xl bg-gray-50 p-4 first:mt-0" : ""}>
              <ReviewCard r={r} />
            </div>
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}

/**
 * Cartão do CELULAR: estrelas e nome à esquerda, foto à direita, e o texto
 * ocupando a largura inteira embaixo.
 *
 * A foto saiu da esquerda porque no carrossel o slide tem ~86% da tela: com a
 * imagem ao lado, sobravam poucos caracteres por linha e o depoimento virava
 * uma coluna estreita e alta. Assim ele lê como um parágrafo normal.
 */
function ReviewCardMobile({ r }: { r: CheckoutReview }) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Stars filled={r.stars} />
          <div className="mt-1 text-sm font-bold text-gray-800">{r.name}</div>
        </div>
        <Avatar r={r} className="h-9 w-9" />
      </div>
      <p className="mt-2.5 text-sm leading-snug text-gray-600">{r.text}</p>
    </div>
  );
}

function Avatar({ r, className }: { r: CheckoutReview; className: string }) {
  if (r.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.photoUrl} alt={r.name} className={`${className} flex-shrink-0 rounded-full object-cover`} />;
  }
  return (
    <div className={`${className} flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300 text-sm font-bold text-gray-500`}>
      {r.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

/** Cartão do DESKTOP: foto à esquerda, conteúdo à direita (inalterado). */
function ReviewCard({ r }: { r: CheckoutReview }) {
  return (
    <div className="flex gap-3">
      <Avatar r={r} className="h-12 w-12" />
      <div className="min-w-0">
        <Stars filled={r.stars} />
        <div className="mt-1 text-sm font-bold text-gray-800">{r.name}</div>
        <p className="mt-1 text-sm leading-snug text-gray-600">{r.text}</p>
      </div>
    </div>
  );
}
