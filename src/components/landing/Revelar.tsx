"use client";

import { useEffect } from "react";

/**
 * Entrada dos blocos `.reveal` ao rolar. O HTML já chega com tudo visível
 * (sem JS a página fica inteira); depois de montar, só o que ainda está fora
 * da tela recebe `.aguardando` (escondido) e volta quando entra na tela. O que
 * já está na tela não pisca. Com movimento reduzido, nada é escondido.
 */
export default function Revelar() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          e.target.classList.remove("aguardando");
          io.unobserve(e.target);
        }
      },
      { threshold: 0.13 },
    );

    const blocos = document.querySelectorAll<HTMLElement>(".landing .reveal");
    for (const el of blocos) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) continue;
      el.classList.add("aguardando");
      io.observe(el);
    }

    return () => {
      io.disconnect();
      for (const el of blocos) el.classList.remove("aguardando");
    };
  }, []);

  return null;
}
