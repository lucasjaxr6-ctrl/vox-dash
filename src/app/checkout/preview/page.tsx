"use client";

import { useEffect, useState } from "react";
import CheckoutForm from "@/components/checkout/CheckoutForm";
import { type Theme, defaultTheme, mergeTheme } from "@/lib/checkout-theme";
import type { CheckoutBump } from "@/lib/checkout-helpers";

type PreviewReview = { id: string; name: string; stars: number; text: string; photoUrl: string | null };

// Página usada APENAS dentro do iframe do editor. Recebe o tema ao vivo via
// postMessage do editor (mesmo origin) e renderiza o checkout REAL.
export default function CheckoutPreviewPage() {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [storeName, setStoreName] = useState("Checkout");
  // undefined = ainda carregando / sem avaliações reais → CheckoutForm mostra exemplos.
  const [reviews, setReviews] = useState<PreviewReview[] | undefined>(undefined);
  const [orderBumps, setOrderBumps] = useState<CheckoutBump[]>([]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "bs-theme") {
        setTheme(mergeTheme(e.data.theme));
        if (typeof e.data.storeName === "string") setStoreName(e.data.storeName);
      }
    }
    window.addEventListener("message", onMsg);
    // avisa o editor (pai) que já está pronto para receber o tema
    window.parent?.postMessage({ type: "bs-preview-ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Busca as avaliações ATIVAS reais para o preview refletir o checkout. Se não
  // houver nenhuma, mantém undefined para o CheckoutForm exibir os exemplos.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/painel/reviews");
        if (!res.ok) return;
        const { reviews: list } = await res.json();
        const active: PreviewReview[] = (Array.isArray(list) ? list : [])
          .filter((r: { active?: boolean }) => r.active)
          .map((r: PreviewReview) => ({ id: r.id, name: r.name, stars: r.stars, text: r.text, photoUrl: r.photoUrl }));
        if (active.length) setReviews(active);
      } catch {
        /* silencioso */
      }
    })();
  }, []);

  // Order bumps ativos (para o preview refletir o checkout real).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/painel/order-bumps");
        if (!res.ok) return;
        const { bumps } = await res.json();
        const list: CheckoutBump[] = (Array.isArray(bumps) ? bumps : [])
          .filter((b: { active?: boolean; product?: unknown }) => b.active && b.product)
          .map((b: { id: string; productId: string; title: string; description: string | null; product: { priceCents: number; imageUrl: string | null } }) => ({
            id: b.id, productId: b.productId, title: b.title, description: b.description,
            priceCents: b.product.priceCents, imageUrl: b.product.imageUrl,
          }));
        setOrderBumps(list);
      } catch {
        /* silencioso */
      }
    })();
  }, []);

  return <CheckoutForm theme={theme} storeName={storeName} reviews={reviews} orderBumps={orderBumps} />;
}
