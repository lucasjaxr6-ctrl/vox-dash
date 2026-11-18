"use client";

import type { Theme } from "@/lib/checkout-theme";
import type { CheckoutReview, CheckoutItem, CheckoutPrefill, CheckoutBump, ActivePixel, CheckoutPayment } from "@/lib/checkout-helpers";
import CheckoutFormCharm from "@/components/checkout/CheckoutFormCharm";

// O checkout tem um modelo só: o Charm (em etapas). Zedy, Luna, Charm Único,
// Charm Único Turbo e Fluxo foram removidos em 07/10/2026. Este arquivo continua
// sendo a porta de entrada para quem renderiza o checkout não precisar saber
// qual componente desenha a tela.
export default function CheckoutForm(props: { theme: Theme; storeName: string; reviews?: CheckoutReview[]; items?: CheckoutItem[]; prefill?: CheckoutPrefill; orderBumps?: CheckoutBump[]; pixels?: ActivePixel[]; paymentConfig?: CheckoutPayment }) {
  return <CheckoutFormCharm {...props} />;
}
