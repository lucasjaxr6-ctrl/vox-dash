"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Acompanha um pedido que ficou "em análise" até virar aprovado ou recusado.
 *
 * NÃO basta reler o banco: se o webhook do gateway atrasar ou não chegar, o
 * pedido ficaria PENDING para sempre e o cliente veria "em análise" eternamente.
 * Por isso bate na rota de status, que RE-CONSULTA O GATEWAY (fonte da verdade)
 * e liquida o pedido — a mesma rota que o checkout usava antes. Quando o status
 * muda, o router.refresh() faz o server component redesenhar no estado certo.
 *
 * Backoff igual ao do checkout: 3s no 1º minuto (pega aprovação rápida) e 6s
 * depois (não martela a API do gateway).
 */
export default function OrderStatusWatcher({
  orderId,
  method,
}: {
  orderId: string;
  /** Define a rota de status: cartão e Pix têm confirmações diferentes. */
  method: "CREDIT_CARD" | "PIX";
}) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const url =
      method === "CREDIT_CARD"
        ? `/api/checkout/card/status?orderId=${encodeURIComponent(orderId)}`
        : `/api/checkout/pix/status?orderId=${encodeURIComponent(orderId)}`;

    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped.current) return;
      // Aba em segundo plano não consulta — reagenda e espera voltar.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule();
        return;
      }
      try {
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const st = data?.status;
        if (st === "PAID" || st === "SHIPPED" || st === "CANCELLED" || data?.paid) {
          stopped.current = true;
          router.refresh(); // redesenha no estado final (confirmado ou recusado)
          return;
        }
      } catch {
        /* rede instável: continua tentando */
      }
      schedule();
    };

    const schedule = () => {
      if (stopped.current) return;
      tries += 1;
      if (tries > 160) return; // ~15 min e para
      timer = setTimeout(tick, tries <= 20 ? 3000 : 6000);
    };

    schedule();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [orderId, method, router]);

  return null;
}
