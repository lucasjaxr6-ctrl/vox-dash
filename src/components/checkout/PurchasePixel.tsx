"use client";

import { useEffect, useRef } from "react";
import { firePurchase, clearCheckoutDraft, type ActivePixel } from "@/lib/checkout-helpers";

/**
 * Dispara a conversão de compra ao abrir a página de obrigado e limpa o
 * rascunho do checkout (a compra terminou — a próxima começa do zero).
 * O firePurchase já deduplica por transactionId (localStorage), então recarregar
 * a página — ou ter passado antes pela tela do Pix — não conta duas vezes.
 */
export default function PurchasePixel({
  pixels,
  orderId,
  amountCents,
  items,
  shippingCents,
}: {
  pixels?: ActivePixel[];
  orderId: string;
  amountCents: number;
  items?: { id: string; name: string; priceCents: number; quantity: number }[];
  shippingCents?: number;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    firePurchase(pixels, { value: amountCents / 100, transactionId: orderId, items, shippingCents });
    clearCheckoutDraft();
  }, [pixels, orderId, amountCents, items, shippingCents]);
  return null;
}
