"use client";

import { useEffect, useRef, useState } from "react";
import Icone from "./Icone";

/**
 * O checkout nativo da VOX num celular, em três etapas.
 *
 * As imagens são capturas do componente REAL (CheckoutForm/Charm e
 * PixPayment) com o tema de uma loja fictícia, "Noma Studio" — não é um
 * desenho do checkout. Foram tiradas em 20/10/2026, a 390 px e 2x, com as
 * chamadas de /api bloqueadas (sem batida de visitante, sem lead). Quando o
 * checkout mudar de cara, refaça as três: monte o CheckoutForm com o mesmo
 * tema numa rota temporária e fotografe.
 *
 * A etapa acompanha a rolagem: o meio da tela atravessa a seção e o checkout
 * avança de Identificação para Pagamento e para o Pix. Os botões embaixo levam
 * direto a uma etapa; depois de um clique, a rolagem só volta a mandar quando
 * o celular sai da tela.
 */
const TELAS = [
  {
    src: "/landing/checkout-1.webp",
    rotulo: "Identificação",
    alt: "Checkout da loja Noma Studio na etapa de identificação, com nome, e-mail, celular e CPF preenchidos e validados.",
  },
  {
    src: "/landing/checkout-2.webp",
    rotulo: "Pagamento",
    alt: "Etapa de pagamento com o Pix escolhido: R$ 180,41 com 5% de desconto, e o botão Pagar com Pix.",
  },
  {
    src: "/landing/checkout-3.webp",
    rotulo: "Pix gerado",
    alt: "Tela do Pix com o QR code, o valor de R$ 180,41, o código para copiar e o aviso de que o pagamento é confirmado sozinho.",
  },
];

export default function CheckoutCelular() {
  const [ativa, setAtiva] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const escolhida = useRef(false);

  useEffect(() => {
    const el = raiz.current;
    const secao = el?.closest("section");
    if (!el || !secao) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      if (escolhida.current) return;
      const r = secao.getBoundingClientRect();
      // Onde o meio da tela está dentro da seção: 0 no topo, 1 no fim.
      const p = (window.innerHeight / 2 - r.top) / r.height;
      setAtiva(p < 0.4 ? 0 : p < 0.64 ? 1 : 2);
    };
    const agendar = () => {
      if (!quadro) quadro = requestAnimationFrame(medir);
    };
    const io = new IntersectionObserver(([entrada]) => {
      if (!entrada.isIntersecting) escolhida.current = false;
    });
    io.observe(el);
    medir();
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar);
    return () => {
      io.disconnect();
      cancelAnimationFrame(quadro);
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
    };
  }, []);

  return (
    <div className="celular" ref={raiz}>
      <div className="celular-corpo">
        <div className="celular-barra" aria-hidden>
          <Icone nome="cadeado" tamanho={11} traco={2.4} />
          checkout.sualoja.com.br
        </div>
        <div className="celular-tela">
          {TELAS.map((t, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={t.src}
              src={t.src}
              alt={t.alt}
              width={390}
              height={820}
              loading="lazy"
              decoding="async"
              aria-hidden={i !== ativa}
              className={i === ativa ? "ativa" : i < ativa ? "antes" : undefined}
            />
          ))}
        </div>
      </div>
      <div className="celular-etapas" role="group" aria-label="Etapas do checkout">
        {TELAS.map((t, i) => (
          <button
            key={t.src}
            type="button"
            aria-pressed={i === ativa}
            onClick={() => {
              escolhida.current = true;
              setAtiva(i);
            }}
          >
            <span>{i + 1}</span>
            {t.rotulo}
          </button>
        ))}
      </div>
      <p className="celular-nota">Capturas do checkout da VOX com o tema de uma loja de exemplo.</p>
    </div>
  );
}
