"use client";

import React, { useEffect, useRef, useState } from "react";
import { LockBadge, LinhaDoTopo, Cadeado, DadosDaEmpresa, PaymentBrands, LeavingOverlay, CornerStyle, CORNERS_CLASS, PILL_CLASS } from "@/components/checkout/ui";
import ThreeDSChallenge from "@/components/checkout/ThreeDSChallenge";
import PagouCardFields from "@/components/checkout/PagouCardFields";
import ReviewsBlock from "@/components/checkout/ReviewsBlock";
import EmailSuggest from "@/components/checkout/EmailSuggest";
import { preloadPagou, type PagouMount } from "@/lib/pagou-card";
import type { Theme } from "@/lib/checkout-theme";
import { corDoBotao, corDaBarraTopo, corDoSeloSeguro } from "@/lib/checkout-theme";
import {
  maskCPF, cpfValido, maskPhone, maskCEP, maskCardNumber, maskExpiry, brl, fmtTime,
  computeCoupon, cardChargeCents, feesDoGateway, PIX_DISCOUNT, PIX_BOOST_DISCOUNT,
  DEMO_ITEMS, DEFAULT_REVIEWS, getCheckoutSid, avisarSaidaDoCheckout, postLead, getGclid, getTracking,
  loadCheckoutDraft, saveCheckoutDraft, pickEmpty, checkoutFunnelStep, eventoGa4, itensGa4, capturarVisitaGa4, visitaGa4DoPedido, visitaMetaDoPedido,
  type AppliedCoupon, type CheckoutReview, type CheckoutItem, type CheckoutPrefill, type CheckoutBump, type ActivePixel, type CheckoutPayment,
} from "@/lib/checkout-helpers";
import { gatewaysDaRota, escolherGatewayCartao } from "@/lib/smart-routing";
import { submitCardPayment, preloadMercadoPago } from "@/lib/mp-card";
import { submitAppmaxCardPayment } from "@/lib/appmax-card";
import { submitHypercashCardPayment, preloadHypercash } from "@/lib/hypercash-card";
import { submitFintpagCardPayment, preloadFintpag } from "@/lib/fintpag-card";
import { submitHylexpayCardPayment, preloadHylexpay } from "@/lib/hylexpay-card";
import { submitBeehiveCardPayment, preloadBeehive } from "@/lib/beehive-card";
import { submitPagnivCardPayment, preloadPagniv } from "@/lib/pagniv-card";
import { submitNuvraCardPayment, preloadNuvra } from "@/lib/nuvra-card";

// ─────────────────────────────────────────────────────────────────────────────
// Modelo Charm — coluna única e estreita (mobile-first), cartões arredondados,
// campos "pill" azulados com check verde, botões pill e chamada com cronômetro.
//
// Em ETAPAS (identificação → entrega → pagamento), com indicador de progresso
// (1 · 2 · 3). É o ÚNICO modelo de checkout desde 07/10/2026: Zedy, Luna,
// Charm Único, Charm Único Turbo e Fluxo foram removidos, e qualquer tema salvo
// com um deles cai aqui (ver mergeTheme em checkout-theme.ts).
//
// A LÓGICA (pedido, Pix, cartão, funil, cupom) fala com as NOSSAS rotas —
// nada aqui veio do backend original.
// ─────────────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

export default function CheckoutFormCharm({
  theme, storeName, reviews, items, prefill, orderBumps, pixels, paymentConfig,
}: {
  theme: Theme; storeName: string; reviews?: CheckoutReview[]; items?: CheckoutItem[];
  prefill?: CheckoutPrefill; orderBumps?: CheckoutBump[]; pixels?: ActivePixel[];
  paymentConfig?: CheckoutPayment;
}) {
  const [cart, setCart] = useState<CheckoutItem[]>(items && items.length ? items : DEMO_ITEMS);
  const prefillComplete = !!(prefill && prefill.name && prefill.email && prefill.cpf && prefill.phone && prefill.address?.cep && prefill.address?.street);
  const [step, setStep] = useState<Step>(prefillComplete ? 3 : 1);
  const [form, setForm] = useState({
    name: prefill?.name ?? "",
    email: prefill?.email ?? "",
    cpf: prefill?.cpf ? maskCPF(prefill.cpf) : "",
    phone: prefill?.phone ? maskPhone(prefill.phone) : "",
  });
  const [addr, setAddr] = useState({
    cep: prefill?.address?.cep ?? "",
    street: prefill?.address?.street ?? "",
    number: prefill?.address?.number ?? "",
    neighborhood: prefill?.address?.neighborhood ?? "",
    complement: prefill?.address?.complement ?? "",
    city: prefill?.address?.city ?? "",
    uf: prefill?.address?.uf ?? "",
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "ok" | "error">(prefill?.address?.cep ? "ok" : "idle");
  const shipOptions = theme.shipping.options.filter((o) => o.enabled);
  const [shipId, setShipId] = useState<string>(shipOptions[0]?.id ?? "");
  const selectedShip = shipOptions.find((o) => o.id === shipId) ?? shipOptions[0];
  const shipReady = cepStatus === "ok" && !!addr.street.trim() && !!addr.number.trim();
  const shippingCents = shipReady ? (selectedShip?.priceCents ?? 0) : 0;
  /**
   * Forma de pagamento escolhida. Começa `null`: as opções nascem desmarcadas
   * e fechadas, e só abrem quando o cliente escolhe.
   *
   * Consequência que precisa andar junto: sem escolha, o total mostrado é o
   * preço CHEIO (produtos + frete). Só assim o "R$ 279,02 / R̶$̶ ̶2̶9̶3̶,̶7̶0̶" da linha do
   * Pix faz sentido — ele anuncia um desconto que ainda não está aplicado.
   */
  const [payment, setPayment] = useState<"card" | "pix" | null>(null);
  const [card, setCard] = useState({ number: "", expiry: "", cvv: "", name: "", cpf: "" });
  const [installments, setInstallments] = useState(1);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardChallenge, setCardChallenge] = useState<{ url: string; creq: string; orderId: string; amountCents: number } | null>(null);
  const [finishMsg, setFinishMsg] = useState<string | null>(null);
  const [cardDeclined, setCardDeclined] = useState(false);
  const [pagouMount, setPagouMount] = useState<PagouMount | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [pixBusy, setPixBusy] = useState(false);
  const [pixError, setPixError] = useState<string | null>(null);
  // "Manter aberto" (Personalizar → Resumo) decide o estado inicial.
  const [summaryOpen, setSummaryOpen] = useState(theme.summary.startOpen);
  // Sem isto a pré-visualização do editor não reage ao toggle (ela monta com o
  // tema padrão e recebe o da loja depois).
  useEffect(() => setSummaryOpen(theme.summary.startOpen), [theme.summary.startOpen]);
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);

  // ── Rascunho: devolve o que o cliente já tinha digitado (nunca o cartão). ──
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current) return;
    draftLoaded.current = true;
    const d = loadCheckoutDraft();
    if (!d) return;
    if (d.form) setForm((f) => ({ ...f, ...pickEmpty(f, d.form!) }));
    if (d.addr) setAddr((a) => ({ ...a, ...pickEmpty(a, d.addr!) }));
    if (d.shippingOptionId && shipOptions.some((o) => o.id === d.shippingOptionId)) setShipId(d.shippingOptionId);
    if (d.coupon) setCoupon(d.coupon);
    if (d.installments) setInstallments(d.installments);
    if (d.addr?.cep && d.addr?.street) setCepStatus("ok");
    const full = d.form?.name && d.form?.email && d.form?.cpf && d.form?.phone && d.addr?.cep && d.addr?.street;
    if (full) setStep(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded.current) return;
    saveCheckoutDraft({ form, addr, shippingOptionId: shipId, coupon, installments });
  }, [form, addr, shipId, coupon, installments]);

  // Pré-carrega o SDK/antifraude do gateway de cartão da loja.
  useEffect(() => {
    const cp = paymentConfig?.cardProvider;
    const rotaGws = gatewaysDaRota(paymentConfig?.cardRoute);
    const uses = (k: string) => cp === k || rotaGws.includes(k);
    if (uses("mercadopago") && paymentConfig?.mpPublicKey) preloadMercadoPago();
    if (uses("hypercash") && paymentConfig?.hypercashPublicKey) preloadHypercash();
    if (uses("fintpag") && paymentConfig?.fintpagPublicKey) preloadFintpag();
    if (uses("hylexpay") && paymentConfig?.hylexpayPublicKey) preloadHylexpay();
    if (uses("beehive") && paymentConfig?.beehivePublicKey) preloadBeehive();
    // PagNiv não tem chave pública guardada: a config vem da API deles.
    if (uses("pagniv")) preloadPagniv();
    // Nuvra: idem, a config de tokenização vem da API deles.
    if (uses("nuvra")) preloadNuvra();
    if (cp === "pagou" && paymentConfig?.pagouPublicKey) preloadPagou();
  }, [paymentConfig]);

  // Cronômetro de urgência do topo (assinatura visual do Charm). A contagem é só
  // pressão de venda: zerar NÃO bloqueia nada nem invalida o carrinho.
  const totalSeconds = Math.max(1, theme.urgency.minutes) * 60;
  const [urgencyLeft, setUrgencyLeft] = useState(totalSeconds);
  useEffect(() => {
    if (!theme.urgency.enabled || !theme.urgency.timerEnabled) return;
    // Âncora em sessionStorage: sem isso o relógio voltava ao cheio a cada
    // re-render/navegação e o cliente percebia que era teatro.
    let end = 0;
    try {
      const saved = Number(sessionStorage.getItem("vox_urgency_end") || 0);
      end = saved > Date.now() ? saved : 0;
    } catch { /* storage bloqueado */ }
    if (!end) {
      end = Date.now() + totalSeconds * 1000;
      try { sessionStorage.setItem("vox_urgency_end", String(end)); } catch { /* ignora */ }
    }
    const tick = () => setUrgencyLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [theme.urgency.enabled, theme.urgency.timerEnabled, totalSeconds]);

  // Passo do funil pelo PREENCHIMENTO real, não pela tela aberta.
  const funnelStep = checkoutFunnelStep({
    contact: form,
    cep: addr.cep,
    atPayment: step >= 3,
    purchased: false,
  });

  // Presença ao vivo (visitantes em tempo real no painel).
  useEffect(() => {
    let sid = "";
    try {
      sid = sessionStorage.getItem("vox_sid") || "";
      if (!sid) {
        sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem("vox_sid", sid);
      }
    } catch {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
    const beat = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        new Image().src = `/api/live/beat?sid=${encodeURIComponent(sid)}&scope=checkout&step=${funnelStep}&t=${Date.now()}`;
      } catch { /* ignore */ }
    };
    beat();
    const id = setInterval(beat, 20000);

    // Saída do checkout: avisa na hora, em vez de deixar o servidor deduzir de
    // 15 minutos de silêncio. Voltar para a aba refaz a batida e desmarca.
    const sair = () => avisarSaidaDoCheckout(sid);
    const aoTrocarAba = () => { if (document.visibilityState === "hidden") sair(); };
    window.addEventListener("pagehide", sair);
    document.addEventListener("visibilitychange", aoTrocarAba);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", sair);
      document.removeEventListener("visibilitychange", aoTrocarAba);
    };
  }, [funnelStep]);

  // Carrinho abandonado: registra o lead assim que há contato válido.
  useEffect(() => {
    const email = form.email.trim();
    const phoneDigits = form.phone.replace(/\D/g, "");
    if (!/^\S+@\S+\.\S+$/.test(email) && phoneDigits.length < 10) return;
    const addressReady = cepStatus === "ok" && !!addr.city && !!addr.uf;
    const t = setTimeout(() => {
      postLead({
        sessionId: getCheckoutSid(),
        name: form.name.trim() || undefined,
        email: email || undefined,
        cpf: form.cpf || undefined,
        phone: form.phone || undefined,
        step,
        address: addressReady
          ? { cep: addr.cep, street: addr.street, number: addr.number, neighborhood: addr.neighborhood, complement: addr.complement, city: addr.city, uf: addr.uf }
          : undefined,
        items: cart.map((i) => ({ productId: i.id, quantity: i.quantity })),
      });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, addr, cart, cepStatus, step]);

  // ── Totais ──
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const totalCents = cart.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  const couponCents = appliedCoupon ? computeCoupon(appliedCoupon.type, appliedCoupon.value, totalCents) : 0;
  const afterCoupon = Math.max(0, totalCents - couponCents);
  const cardBaseCents = afterCoupon + shippingCents;
  // Gateway do cartão escolhido UMA vez (o sorteio da distribuição é fixo
  // por visita): os juros são por gateway, então as parcelas mostradas têm de
  // ser as do gateway que vai cobrar. Decide pelo valor SEM juros.
  const [sorteioCartao] = useState(() => Math.random());
  const gwCartao = paymentConfig?.cardRoute
    ? escolherGatewayCartao(paymentConfig.cardRoute, cardBaseCents, sorteioCartao)
    : (paymentConfig?.cardProvider ?? "");
  const cardFees = feesDoGateway(paymentConfig, gwCartao);
  const cardTotalCents = cardChargeCents(cardBaseCents, installments, cardFees);
  const cardJurosCents = Math.max(0, cardTotalCents - cardBaseCents);
  const pixRate = cardDeclined ? PIX_BOOST_DISCOUNT : PIX_DISCOUNT;
  const pixCents = Math.round(afterCoupon * (1 - pixRate));
  const pixDiscountCents = afterCoupon - pixCents;
  // O total só reflete a forma de pagamento a partir do passo 3.
  const atPayment = step === 3;
  const effectiveCents = atPayment
    ? (payment === "card" ? cardTotalCents : payment === "pix" ? pixCents + shippingCents : afterCoupon + shippingCents)
    : afterCoupon + shippingCents;

  const primary = theme.colors.primary;
  const cta: React.CSSProperties = { background: corDoBotao(theme), color: theme.colors.buttonText };
  const seloSeguro = corDoSeloSeguro(theme);
  const barraTopo = corDaBarraTopo(theme);

  // ── Validação por campo (o check verde do Charm) ──
  const nameOk = form.name.trim().split(/\s+/).filter(Boolean).length >= 2;
  const emailOk = /^\S+@\S+\.\S+$/.test(form.email.trim());
  const cpfOk = cpfValido(form.cpf);
  const cpfCompleto = form.cpf.replace(/\D/g, "").length === 11;
  // Titular em branco = o próprio comprador (é o que vai ao gateway).
  const cpfTitularOk = cpfValido(card.cpf || form.cpf);
  const phoneOk = form.phone.replace(/\D/g, "").length >= 10;
  const cepOk = addr.cep.replace(/\D/g, "").length === 8 && cepStatus === "ok";

  /**
   * O pagamento só abre com contato, endereço E frete escolhido.
   *
   * Não é só arrumação de tela: enquanto `shipReady` é falso o total exibido sai
   * SEM frete, mas o servidor cobra o frete da opção selecionada (ele recalcula
   * pelo `shippingOptionId`, que já vai preenchido com a primeira opção). Ou
   * seja, sem esta trava o cliente via um valor e pagava outro.
   */
  const shipChosen = shipReady && !!selectedShip;
  const paymentBlock: string | null =
    contactValid() ? "Preencha seus dados de contato para liberar o pagamento."
    : addressValid() ? "Informe o endereço de entrega para liberar o pagamento."
    : !shipChosen ? "Escolha a forma de entrega para liberar o pagamento."
    : null;

  // ── Funil no Google Analytics (a compra sai de PurchasePixel, em /obrigado). ──
  const ga4Carrinho = () => ({
    currency: "BRL",
    value: afterCoupon / 100,
    items: itensGa4(cart),
    ...(appliedCoupon ? { coupon: appliedCoupon.code } : {}),
  });
  const ga4Inicio = useRef(false);
  useEffect(() => {
    if (ga4Inicio.current) return;
    ga4Inicio.current = true;
    eventoGa4(pixels, "begin_checkout", ga4Carrinho());
    capturarVisitaGa4(pixels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ga4Entrega = useRef(false);
  useEffect(() => {
    if (step !== 3 || !shipChosen || ga4Entrega.current) return;
    ga4Entrega.current = true;
    eventoGa4(pixels, "add_shipping_info", { ...ga4Carrinho(), shipping_tier: selectedShip?.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shipChosen]);
  // Uma vez por forma de pagamento: tentar de novo depois de uma recusa não é
  // outro cliente informando o pagamento, e inflaria essa etapa do funil.
  const ga4Pagamentos = useRef(new Set<string>());
  function ga4Pagamento(tipo: string) {
    if (ga4Pagamentos.current.has(tipo)) return;
    ga4Pagamentos.current.add(tipo);
    eventoGa4(pixels, "add_payment_info", { ...ga4Carrinho(), value: effectiveCents / 100, payment_type: tipo });
  }

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function mark(field: string) {
    setTouched((t) => ({ ...t, [field]: true }));
  }
  function updateQty(id: string, delta: number) {
    setCart((c) => c.map((i) => (i.id === id ? { ...i, quantity: Math.min(99, Math.max(1, i.quantity + delta)) } : i)));
  }
  function toggleBump(b: CheckoutBump) {
    setCart((c) =>
      c.some((i) => i.id === b.productId)
        ? c.filter((i) => i.id !== b.productId)
        : [...c, { id: b.productId, name: b.title, priceCents: b.priceCents, imageUrl: b.imageUrl, quantity: 1 }],
    );
  }

  async function lookupCep(digits: string) {
    setCepStatus("loading");
    try {
      const res = await fetch(`/api/cep/${digits}`);
      if (!res.ok) { setCepStatus("error"); return; }
      const d = await res.json();
      setAddr((a) => ({ ...a, street: d.street || a.street, neighborhood: d.neighborhood || a.neighborhood, city: d.city || "", uf: d.state || "" }));
      setCepStatus("ok");
    } catch { setCepStatus("error"); }
  }
  function onCepChange(v: string) {
    const masked = maskCEP(v);
    setAddr((a) => ({ ...a, cep: masked }));
    const digits = masked.replace(/\D/g, "");
    if (digits.length === 8) lookupCep(digits);
    else setCepStatus("idle");
  }

  async function applyCoupon() {
    if (!coupon.trim()) return;
    setCouponBusy(true);
    setCouponMsg(null);
    try {
      const res = await fetch("/api/checkout/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: coupon.trim(), subtotalCents: totalCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setCouponMsg(data?.error ?? "Cupom inválido."); return; }
      setAppliedCoupon({ code: data.code, type: data.type, value: data.value });
      setCoupon("");
    } catch {
      setCouponMsg("Erro ao validar cupom.");
    } finally {
      setCouponBusy(false);
    }
  }

  /** Dados de contato válidos? (usado ao avançar de etapa e antes de cobrar) */
  function contactValid(): string | null {
    if (!nameOk) return "Informe seu nome e sobrenome.";
    if (!emailOk) return "Informe um e-mail válido.";
    if (!cpfOk) return cpfCompleto ? "CPF inválido. Confira os números." : "Informe um CPF válido.";
    if (!phoneOk) return "Informe um celular válido com DDD.";
    return null;
  }
  function addressValid(): string | null {
    if (addr.cep.replace(/\D/g, "").length !== 8) return "Informe um CEP válido.";
    if (!addr.street.trim()) return "Informe o endereço.";
    if (!addr.number.trim()) return "Informe o número.";
    if (!addr.neighborhood.trim()) return "Informe o bairro.";
    if (!addr.city.trim() || !addr.uf.trim()) return "Preencha o CEP para definir cidade/UF.";
    return null;
  }

  function goToStep2() {
    const err = contactValid();
    if (err) { ["name", "email", "cpf", "phone"].forEach(mark); return setStepError(err); }
    setStepError(null);
    setStep(2);
  }
  function goToStep3() {
    const err = addressValid();
    if (err) { ["cep", "street", "number", "neighborhood"].forEach(mark); return setStepError(err); }
    // Endereço preenchido não basta: se o CEP não resolveu, o frete não entrou
    // na conta e o cliente cairia no pagamento vendo um total sem frete.
    if (!shipChosen) return setStepError("Escolha a forma de entrega para continuar.");
    setStepError(null);
    setStep(3);
  }

  /**
   * Sai do checkout travando a tela. Atribuir `location.href` apenas AGENDA a
   * navegação — sem esta trava o botão voltava ao normal e o cliente clicava de
   * novo, gerando 2 ou 3 cobranças.
   */
  function leaveTo(url: string) {
    leavingRef.current = true;
    setLeaving(true);
    window.location.href = url;
  }
  function goToOrderPage(id: string, motivo?: string) {
    leaveTo(`/obrigado/${encodeURIComponent(id)}${motivo ? `?erro=${encodeURIComponent(motivo)}` : ""}`);
  }

  const orderPayload = () => ({
    items: cart.map((i) => ({ productId: i.id, quantity: i.quantity })),
    customer: { name: form.name.trim(), email: form.email.trim(), cpf: form.cpf, phone: form.phone },
    address: { cep: addr.cep, street: addr.street, number: addr.number, neighborhood: addr.neighborhood, complement: addr.complement, city: addr.city, uf: addr.uf },
    couponCode: appliedCoupon?.code,
    shippingOptionId: shipId,
    gclid: getGclid(),
    tracking: getTracking(),
    ga4: visitaGa4DoPedido(),
    meta: visitaMetaDoPedido(pixels),
  });

  /** Valida tudo antes de cobrar; se faltar algo, volta à etapa certa. */
  function blockingError(): string | null {
    const c = contactValid();
    if (c) { ["name", "email", "cpf", "phone"].forEach(mark); setStep(1); return c; }
    const a = addressValid();
    if (a) { ["cep", "street", "number", "neighborhood"].forEach(mark); setStep(2); return a; }
    // Última barreira antes de cobrar: sem frete escolhido o valor da tela não é
    // o valor que o servidor cobra.
    if (!shipChosen) { setStep(2); return "Escolha a forma de entrega antes de pagar."; }
    return null;
  }

  async function generatePix() {
    setPixError(null);
    setFinishMsg(null);
    const err = blockingError();
    if (err) return setPixError(err);
    ga4Pagamento("Pix");
    setPixBusy(true);
    try {
      const res = await fetch("/api/checkout/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...orderPayload(), pixBoost: cardDeclined, sessionId: getCheckoutSid() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setPixError(data?.error ?? "Não foi possível gerar o Pix. Tente novamente."); return; }
      // O Pix tem página própria (/pix/{orderId}): sobrevive a recarregar, voltar
      // pelo e-mail ou abrir no celular — diferente de um modal, que morre com a aba.
      leaveTo(`/pix/${encodeURIComponent(data.orderId)}`);
    } catch {
      setPixError("Erro de rede ao gerar o Pix.");
    } finally {
      if (!leavingRef.current) setPixBusy(false);
    }
  }


  /** Cartão "indisponível": empurra para o Pix com desconto maior. */
  function finish() {
    setCardDeclined(true);
    setPayment("pix");
    setPixError(null);
    setFinishMsg("Pagamento com cartão indisponível no momento. Pague com Pix e ganhe 15% de desconto!");
  }

  async function payWithCard() {
    setFinishMsg(null);
    const err = blockingError();
    if (err) return setFinishMsg(err);
    if (!cpfTitularOk) return setFinishMsg("CPF do titular inválido. Confira os números.");
    ga4Pagamento("Cartão de crédito");
    setCardBusy(true);
    try {
      const cardFields = { number: card.number, holder: card.name, expiry: card.expiry, cvv: card.cvv, cpf: card.cpf || form.cpf };
      const order = orderPayload();
      // O MESMO gateway cujas parcelas o cliente viu (escolhido uma vez).
      const cardSplitCfg = paymentConfig?.cardRoute;
      const gw = gwCartao;
      const splitGw = cardSplitCfg ? gw : undefined;

      // Pagou: quem cobra é o SDK deles (o cartão fica no iframe e o 3DS é
      // resolvido lá). Nenhum dado do cartão passa por nós.
      if (gw === "pagou") {
        if (!pagouMount) { setFinishMsg("O formulário de cartão ainda está carregando. Tente de novo em instantes."); return; }
        const p = await pagouMount.submit({ ...order, card: { installments } });
        if (p.ok && p.orderId) return goToOrderPage(p.orderId);
        if (p.orderId) return goToOrderPage(p.orderId, p.error);
        setFinishMsg(p.error ?? "Não foi possível processar o cartão.");
        return;
      }

      const r = gw === "hypercash"
        ? await submitHypercashCardPayment({ publicKey: paymentConfig!.hypercashPublicKey!, card: cardFields, installments, order, gateway: splitGw })
        : gw === "fintpag"
        ? await submitFintpagCardPayment({ publicKey: paymentConfig!.fintpagPublicKey!, card: cardFields, installments, order, gateway: splitGw })
        : gw === "hylexpay"
        ? await submitHylexpayCardPayment({ publicKey: paymentConfig!.hylexpayPublicKey!, card: cardFields, installments, order, gateway: splitGw })
        : gw === "beehive"
        ? await submitBeehiveCardPayment({ publicKey: paymentConfig!.beehivePublicKey!, card: cardFields, installments, order, amountCents: cardTotalCents, gateway: splitGw })
        : gw === "pagniv"
        ? await submitPagnivCardPayment({ card: cardFields, installments, order, gateway: splitGw })
        : gw === "nuvra"
        ? await submitNuvraCardPayment({ card: cardFields, installments, order, gateway: splitGw })
        : gw === "appmax" || gw === "freepay" || gw === "blackcat" || gw === "pagarme" || gw === "veopag" || gw === "mangofy" || gw === "bluevision" || gw === "wappi"
        ? await submitAppmaxCardPayment({ card: cardFields, installments, order, gateway: splitGw })
        : await submitCardPayment({ publicKey: paymentConfig!.mpPublicKey, card: cardFields, installments, order, gateway: splitGw });

      if (r.ok && (r.status === "approved" || r.status === "pending") && r.orderId) return goToOrderPage(r.orderId);
      if (r.ok && r.status === "challenge" && r.threeDs && r.orderId) {
        setCardChallenge({ url: r.threeDs.externalResourceUrl, creq: r.threeDs.creq, orderId: r.orderId, amountCents: r.amountCents ?? cardTotalCents });
      } else if (r.orderId) {
        return goToOrderPage(r.orderId, r.error);
      } else {
        setFinishMsg(r.error ?? "Não foi possível concluir o pagamento com este cartão. Tente outro cartão ou pague com Pix.");
      }
    } finally {
      // O cartão já pode ter sido cobrado: um segundo clique cobraria de novo.
      if (!leavingRef.current) setCardBusy(false);
    }
  }

  // ── Disponibilidade dos meios de pagamento ──
  const pixEnabled = paymentConfig ? paymentConfig.pixEnabled : true;
  const cardProvider = paymentConfig?.cardProvider ?? null;
  const cardRaw = cardProvider === "appmax" || cardProvider === "freepay" || cardProvider === "fintpag" || cardProvider === "hylexpay" || cardProvider === "blackcat" || cardProvider === "pagarme" || cardProvider === "veopag" || cardProvider === "mangofy" || cardProvider === "bluevision" || cardProvider === "wappi";
  const cardHyper = cardProvider === "hypercash";
  // Beehive: nossos campos, tokenização no navegador — exige a chave pública.
  const cardBeehive = cardProvider === "beehive";
  // PagNiv: idem, mas a chave vem da API deles — basta o provedor.
  const cardPagniv = cardProvider === "pagniv";
  // Nuvra: igual à PagNiv, a config de tokenização vem da API deles.
  const cardNuvra = cardProvider === "nuvra";
  const cardPagou = cardProvider === "pagou";
  const cardSplit = !!paymentConfig?.cardRoute?.fatias;
  const canCard = cardSplit
    ? !!paymentConfig?.cardEnabled
    : cardRaw || cardPagniv || cardNuvra || (cardProvider === "mercadopago" && !!paymentConfig?.mpPublicKey) || (cardHyper && !!paymentConfig?.hypercashPublicKey) || (cardBeehive && !!paymentConfig?.beehivePublicKey) || (cardPagou && !!paymentConfig?.pagouPublicKey);
  const cardAvailable = canCard;

  useEffect(() => {
    // Cartão deixou de estar disponível com ele já escolhido: volta para "nada
    // escolhido" em vez de abrir o Pix na cara do cliente.
    if (!cardAvailable && payment === "card") setPayment(null);
  }, [cardAvailable, payment]);

  const reviewList = reviews === undefined ? DEFAULT_REVIEWS : reviews;

  // Quanto o cliente está economizando (cupom + desconto do meio de pagamento).
  // Mostrar isso explicitamente é dos poucos elementos de checkout com efeito
  // medido em conversão — o cliente precisa VER o ganho, não deduzir da conta.
  const savingsCents = couponCents + (atPayment && payment === "pix" ? pixDiscountCents : 0);

  // Um objeto só, consumido pelas duas cascas do resumo (barra no celular,
  // painel no desktop). Se fossem duas listas de props, um campo novo entraria
  // em uma e faltaria na outra.
  const summaryProps = {
    open: summaryOpen,
    onToggle: () => setSummaryOpen((o) => !o),
    cart,
    itemCount,
    totalCents,
    couponCents,
    appliedCoupon,
    shippingCents,
    shipReady,
    shipName: selectedShip?.name,
    atPayment,
    payment,
    pixDiscountCents,
    cardJurosCents,
    installments,
    effectiveCents,
    title: theme.summary.title,
    coupon,
    couponBusy,
    couponMsg,
    onCouponChange: (v: string) => { setCoupon(v); setCouponMsg(null); },
    onApplyCoupon: applyCoupon,
    onRemoveCoupon: () => { setAppliedCoupon(null); setCouponMsg(null); },
    onQty: updateQty,
    primary,
  };

  return (
    <div className={`${CORNERS_CLASS} flex min-h-screen flex-col`} style={{ background: theme.colors.background, fontFamily: theme.typography.fontFamily }}>
      <CornerStyle roundness={theme.corners.roundness} />
      {leaving && <LeavingOverlay color={primary} />}
      {cardChallenge && (
        <ThreeDSChallenge
          url={cardChallenge.url}
          creq={cardChallenge.creq}
          orderId={cardChallenge.orderId}
          onResult={(res) => {
            setCardChallenge(null);
            goToOrderPage(cardChallenge.orderId, res === "rejected" ? "Pagamento não autenticado pelo banco. Revise os dados ou use outro cartão." : undefined);
          }}
        />
      )}

      {theme.announcementBar.enabled && (
        <div className="px-4 py-2 text-center text-xs font-medium" style={{ background: theme.announcementBar.bg, color: theme.announcementBar.color }}>
          {theme.announcementBar.text}
        </div>
      )}

      {/* A borda fica no cinza de sempre: quem o lojista pinta é o filete de
          3px logo abaixo. Colorir as duas empilharia dois tons num bloco só. */}
      <header className="border-b border-gray-100" style={{ background: theme.header.bg }}>
        <LinhaDoTopo
          posicao={theme.header.logoPosition}
          className="mx-auto max-w-md px-4 py-4 lg:max-w-6xl lg:px-8 lg:py-5"
          marca={
            theme.header.showLogo && theme.header.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={theme.header.logoUrl} alt={storeName} className="w-auto max-w-[65%] object-contain" style={{ height: theme.header.logoHeight }} />
            ) : (
              <span className="text-lg font-bold text-gray-800 lg:text-[22px]">{storeName}</span>
            )
          }
          direita={<LockBadge color={seloSeguro} />}
        />
      </header>

      {/* Filete de ponta a ponta fechando o cabeçalho, logo acima da chamada e
          do cronômetro. Vive FORA do <main> de propósito: dentro dele herdaria
          a largura máxima e o padding, e pararia antes das bordas.
          É ESTA a "barra do topo" que o editor pinta — era `bg-gray-900` fixo. */}
      <div className="h-[3px] w-full" style={{ background: barraTopo }} />

      {theme.banner.enabled && theme.banner.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={theme.banner.imageUrl} alt="banner" className="max-h-56 w-full object-cover" />
      )}

      {theme.scarcity.enabled && (
        <div className="px-4 py-2 text-center text-sm font-medium" style={{ background: theme.scarcity.bg, color: theme.scarcity.color }}>
          {theme.scarcity.text}
        </div>
      )}

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6 lg:max-w-6xl lg:px-8 lg:py-12">
        {/* Chamada + cronômetro */}
        {theme.urgency.enabled && (theme.urgency.headline || theme.urgency.timerEnabled) && (
          <div className="mb-6 text-center lg:mb-9">
            {theme.urgency.headline && <h2 className="text-lg font-bold tracking-tight text-gray-900 lg:text-2xl">{theme.urgency.headline}</h2>}
            {theme.urgency.timerEnabled && (
              <p className="mt-2 text-[15px] font-medium text-gray-900 lg:mt-3 lg:text-base">
                Você tem{" "}
                <span className="inline-flex items-center rounded px-2 py-0.5 text-[13px] font-extrabold tabular-nums" style={{ background: theme.urgency.bg, color: theme.urgency.color }}>
                  {fmtTime(urgencyLeft)}
                </span>{" "}
                para finalizar seu pedido
              </p>
            )}
          </div>
        )}

        {/* ── Duas colunas no desktop ──────────────────────────────────────────
            Até `lg` fica tudo empilhado (o desenho de celular, que é como estes
            modelos nasceram). A partir de `lg` o formulário vai para a esquerda
            e o resumo vira um painel FIXO à direita, que acompanha a rolagem —
            no desktop a coluna estreita sozinha deixava metade da tela vazia.

            O resumo é montado duas vezes (barra no celular, painel no desktop)
            e uma delas está sempre em display:none. É de propósito: as duas
            cascas são bem diferentes (uma abre/fecha, a outra é sempre aberta e
            grudada), e alternar só no CSS exigiria brigar com o estilo inline da
            animação. Os dois leem o MESMO estado, então não há como divergirem. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-12">
          <div className="min-w-0 lg:max-w-[620px]">
            {/* Indicador de etapas: visível conforme o lojista escolher em
                Personalizar → Etapas. Quando está desligado nos
                dois, nem é renderizado. */}
            {(theme.stepBar.mobile || theme.stepBar.desktop) && (
              <div className={theme.stepBar.mobile ? (theme.stepBar.desktop ? "" : "lg:hidden") : "hidden lg:block"}>
                <StepBar step={step} color={primary} fg={theme.colors.buttonText} />
              </div>
            )}

            <div className="lg:hidden">
              <OrderSummary {...summaryProps} />
            </div>

        {/* ── 1. Identificação ── */}
        {step === 1 && (
          <Section n={1} color={primary} fg={theme.colors.buttonText} title={theme.steps.identificationTitle || "Identifique-se"}>
            <p className="mb-4 text-xs text-gray-500">{theme.steps.identificationSubtitle}</p>
            <div className="space-y-3">
              <PillField label="Nome completo" valid={nameOk} error={touched.name && !nameOk ? "Informe nome e sobrenome" : null}>
                <input className={pillCls(touched.name && !nameOk)} placeholder="ex.: Maria de Almeida Cruz" value={form.name} onChange={(e) => update("name", e.target.value)} onBlur={() => mark("name")} autoComplete="name" maxLength={120} />
              </PillField>
              <PillField label="E-mail" valid={emailOk} error={touched.email && !emailOk ? "Informe um e-mail válido" : null}>
                <input type="email" className={pillCls(touched.email && !emailOk)} placeholder="seu@email.com" value={form.email} onChange={(e) => update("email", e.target.value)} onBlur={() => mark("email")} autoComplete="email" maxLength={254} />
                <EmailSuggest value={form.email} onPick={(v) => update("email", v)} />
              </PillField>

              <div>
                <FieldLabel>Celular/WhatsApp</FieldLabel>
                <div className={`flex h-11 items-center overflow-hidden rounded-l-md rounded-r-full border bg-blue-50/50 ${touched.phone && !phoneOk ? "border-red-400 bg-red-50/30" : "border-blue-200/60"}`}>
                  <span className="flex h-full flex-shrink-0 items-center border-r border-blue-200/60 px-3 text-xs font-semibold text-gray-500">+55</span>
                  <input inputMode="numeric" className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-gray-400" placeholder="(11) 91234-5678" value={form.phone} onChange={(e) => update("phone", maskPhone(e.target.value))} onBlur={() => mark("phone")} autoComplete="tel" />
                  <span className="flex-shrink-0 pr-3">{phoneOk && <CheckIcon />}</span>
                </div>
                {touched.phone && !phoneOk && <p className="mt-1 text-xs text-red-500">Informe um telefone válido com DDD</p>}
              </div>

              <PillField label="CPF" valid={cpfOk} error={touched.cpf && !cpfOk ? (cpfCompleto ? "CPF inválido. Confira os números." : "Preencha o CPF completo") : null}>
                <input inputMode="numeric" className={pillCls(touched.cpf && !cpfOk)} placeholder="000.000.000-00" value={form.cpf} onChange={(e) => update("cpf", maskCPF(e.target.value))} onBlur={() => mark("cpf")} />
              </PillField>
            </div>
            {stepError && step === 1 && <ErrorNote>{stepError}</ErrorNote>}
            <PillButton cta={cta} onClick={goToStep2}>{theme.steps.ctaText || "Continuar"} <ArrowRight /></PillButton>
          </Section>
        )}
        {step > 1 && (
          <DoneCard title={theme.steps.identificationTitle || "Identifique-se"} onEdit={() => setStep(1)}>
            <div className="font-semibold text-gray-800">{form.name || "—"}</div>
            <div>{form.email || "—"}</div>
            <div>{form.phone || "—"}</div>
          </DoneCard>
        )}

        {/* Etapa ainda não alcançada, no DESKTOP: sem isso a coluna esquerda
            ficava com um único cartão e um vazio enorme embaixo. Além de
            preencher, mostra ao cliente que faltam poucas etapas — e etapa
            visível é etapa que parece curta. */}
        {step < 2 && <PendingSection n={2} title="Entrega" text="Endereço e forma de envio." />}

        {/* ── 2. Entrega ── */}
        {step === 2 && (
          <Section n={2} color={primary} fg={theme.colors.buttonText} title="Entrega">
            <p className="mb-4 text-xs text-gray-500">Informe o endereço de entrega.</p>
            <div className="space-y-3">
              <div>
                <FieldLabel>CEP</FieldLabel>
                <div className="flex items-center gap-3">
                  <div className="relative w-[180px] flex-shrink-0">
                    <input inputMode="numeric" className={pillCls(touched.cep && !cepOk)} placeholder="00000-000" value={addr.cep} onChange={(e) => onCepChange(e.target.value)} onBlur={() => mark("cep")} />
                    {cepOk && <span className="absolute right-3 top-1/2 -translate-y-1/2"><CheckIcon /></span>}
                  </div>
                  {cepStatus === "loading" && <span className="text-sm text-gray-400">Buscando...</span>}
                  {cepStatus === "ok" && addr.city && <span className="text-sm text-gray-500">{addr.city} - {addr.uf}</span>}
                  {cepStatus === "error" && <span className="text-sm font-medium text-red-500">CEP não encontrado</span>}
                </div>
              </div>

              {/* Só abre o resto do endereço depois do CEP */}
              {(cepStatus === "ok" || addr.street) && (
                <>
                  <PillField label="Endereço" valid={!!addr.street.trim()}>
                    <input className={pillCls(touched.street && !addr.street.trim())} placeholder="Rua, avenida..." value={addr.street} onChange={(e) => setAddr((a) => ({ ...a, street: e.target.value }))} onBlur={() => mark("street")} />
                  </PillField>
                  <div className="grid grid-cols-[110px_1fr] gap-3">
                    <PillField label="Nº" valid={!!addr.number.trim()}>
                      <input inputMode="numeric" className={pillCls(touched.number && !addr.number.trim())} placeholder="Nº" value={addr.number} onChange={(e) => setAddr((a) => ({ ...a, number: e.target.value }))} onBlur={() => mark("number")} />
                    </PillField>
                    <PillField label="Bairro" valid={!!addr.neighborhood.trim()}>
                      <input className={pillCls(touched.neighborhood && !addr.neighborhood.trim())} placeholder="Bairro" value={addr.neighborhood} onChange={(e) => setAddr((a) => ({ ...a, neighborhood: e.target.value }))} onBlur={() => mark("neighborhood")} />
                    </PillField>
                  </div>
                  <PillField label="Complemento (opcional)" valid={false}>
                    <input className={pillCls(false)} placeholder="Apto, bloco, referência..." value={addr.complement} onChange={(e) => setAddr((a) => ({ ...a, complement: e.target.value }))} />
                  </PillField>
                </>
              )}

              <div className="pt-1">
                <h4 className="mb-2 text-xs font-bold text-gray-700">Escolha uma forma de entrega:</h4>
                {shipReady ? (
                  <div className="space-y-2">
                    {shipOptions.map((o) => (
                      <label key={o.id} className={`flex cursor-pointer items-center justify-between rounded-lg border-2 p-4 transition ${selectedShip?.id === o.id ? "border-gray-800 bg-gray-50" : "border-gray-200"}`}>
                        <span className="flex items-center gap-3">
                          <input type="radio" name="charm-ship" checked={selectedShip?.id === o.id} onChange={() => setShipId(o.id)} className="h-4 w-4 accent-gray-800" />
                          <span>
                            <span className="block text-sm font-bold text-gray-800">{o.name}</span>
                            <span className="flex items-center gap-1 text-xs text-gray-500">
                              {o.eta}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {o.carrier && <img src={`/shipping/${o.carrier}.svg`} alt={o.carrier} className="inline-block h-3.5" />}
                            </span>
                          </span>
                        </span>
                        <span className={`text-sm font-medium ${o.priceCents === 0 ? "text-green-600" : "text-gray-800"}`}>
                          {o.priceCents === 0 ? "Grátis" : brl(o.priceCents)}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-500 ring-1 ring-inset ring-gray-200">
                    Preencha o CEP e o endereço para ver as opções de frete.
                  </p>
                )}
              </div>
            </div>
            {stepError && step === 2 && <ErrorNote>{stepError}</ErrorNote>}
            <PillButton cta={cta} onClick={goToStep3}>Continuar <ArrowRight /></PillButton>
          </Section>
        )}
        {step > 2 && (
          <DoneCard title="Entrega" onEdit={() => setStep(2)}>
            <div>{addr.street || "—"}{addr.number ? `, ${addr.number}` : ""}</div>
            <div>{[addr.neighborhood, addr.city && `${addr.city} - ${addr.uf}`].filter(Boolean).join(" · ")}</div>
            <div className="pt-1 font-semibold text-gray-800">
              {selectedShip ? `${selectedShip.name} — ${selectedShip.priceCents === 0 ? "Grátis" : brl(selectedShip.priceCents)}` : "—"}
            </div>
          </DoneCard>
        )}

        {step < 3 && <PendingSection n={3} title="Pagamento" text="Pix ou cartão de crédito." />}

        {/* ── 3. Pagamento ── */}
        {step === 3 && (
          <Section n={3} color={primary} fg={theme.colors.buttonText} title="Pagamento">
            <p className="mb-4 text-xs text-gray-500">Todas as transações são seguras e criptografadas.</p>

            {orderBumps && orderBumps.length > 0 && (
              <div className="mb-4 space-y-2">
                {orderBumps.map((b) => {
                  const added = cart.some((i) => i.id === b.productId);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBump(b)}
                      className="flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-3 text-left transition"
                      style={{ borderColor: added ? primary : "#d1d5db", background: added ? `${primary}0f` : "#f9fafb" }}
                    >
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2" style={{ borderColor: added ? primary : "#cbd5e1", background: added ? primary : "#fff" }}>
                        {added && <CheckSmall />}
                      </span>
                      {b.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.imageUrl} alt={b.title} className="h-12 w-12 flex-shrink-0 rounded-lg border border-gray-200 object-cover" />
                      ) : (
                        <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-gray-100" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-gray-800">{b.title}</span>
                        {b.description && <span className="mt-0.5 block text-xs text-gray-500">{b.description}</span>}
                      </span>
                      <span className="flex-shrink-0 text-sm font-bold" style={{ color: primary }}>
                        {added ? "Adicionado" : `+ ${brl(b.priceCents)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {paymentBlock ? (
              <LockedPayment
                text={paymentBlock}
                // O cliente não deveria chegar aqui destravado, mas se chegar
                // (rascunho antigo, "Editar" e sair no meio), o atalho leva
                // direto ao que falta em vez de deixá-lo preso.
                onFix={() => setStep(contactValid() ? 1 : 2)}
              />
            ) : (
            <div className="space-y-3">
              {pixEnabled && (
                <PayShell
                  selected={payment === "pix"}
                  onSelect={() => setPayment("pix")}
                  title="Pix"
                  badge={pixRate > 0 ? `${Math.round(pixRate * 100)}% OFF` : undefined}
                  accent={primary}
                  icon={<PixGlyph />}
                  price={brl(pixCents + shippingCents)}
                  oldPrice={pixDiscountCents > 0 ? brl(afterCoupon + shippingCents) : null}
                >
                  {cardDeclined && (
                    <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-center text-xs font-semibold text-green-700">🎉 15% de desconto aplicado no Pix!</p>
                  )}
                  {/* O valor saiu daqui: ele agora está DENTRO do botão. Repetir
                      o preço logo acima do CTA só adicionava ruído entre o
                      cliente e o clique. */}
                  <ul className="space-y-2 text-[13px] leading-snug text-gray-600">
                    <PixPasso icon={<IconQr />}>Pague com QR Code ou Pix copia e cola</PixPasso>
                    <PixPasso icon={<IconRelogio />}>O código vale por 30 minutos</PixPasso>
                    <PixPasso icon={<IconConfirma />}>Confirmação automática do pagamento</PixPasso>
                  </ul>
                  {pixError && <ErrorNote>{pixError}</ErrorNote>}
                  <PillButton cta={cta} onClick={generatePix} disabled={pixBusy}>
                    {pixBusy ? (
                      "Gerando Pix..."
                    ) : (
                      <>
                        <PixMark />
                        Pagar {brl(pixCents + shippingCents)} com Pix
                      </>
                    )}
                  </PillButton>
                  <PayAssurance color={seloSeguro} />
                </PayShell>
              )}

              {cardAvailable && (
                <PayShell selected={payment === "card"} onSelect={() => setPayment("card")} title="Cartão de crédito" accent={primary} icon={<CardGlyph />} brands={<CardBrands />}>
                  {cardPagou ? (
                    <div className="space-y-3">
                      <PagouCardFields publicKey={paymentConfig!.pagouPublicKey!} sandbox={Boolean(paymentConfig?.pagouSandbox)} onReady={setPagouMount} />
                      <InstallmentSelect value={installments} onChange={setInstallments} base={cardBaseCents} fees={cardFees} />
                      {finishMsg && <ErrorNote>{finishMsg}</ErrorNote>}
                      <PillButton cta={cta} onClick={payWithCard} disabled={cardBusy || !pagouMount}>
                        {cardBusy ? "Processando..." : `Pagar ${brl(cardTotalCents)}`}
                      </PillButton>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <PillField label="Número do cartão" valid={card.number.replace(/\D/g, "").length >= 13}>
                        <input inputMode="numeric" className={pillCls(false)} placeholder="0000 0000 0000 0000" value={card.number} onChange={(e) => setCard({ ...card, number: maskCardNumber(e.target.value) })} autoComplete="cc-number" />
                      </PillField>
                      <div className="grid grid-cols-2 gap-3">
                        <PillField label="Validade" valid={card.expiry.length === 5}>
                          <input inputMode="numeric" className={pillCls(false)} placeholder="MM/AA" value={card.expiry} onChange={(e) => setCard({ ...card, expiry: maskExpiry(e.target.value) })} autoComplete="cc-exp" />
                        </PillField>
                        <PillField label="CVV" valid={card.cvv.length >= 3}>
                          <input inputMode="numeric" className={pillCls(false)} placeholder="000" value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} autoComplete="cc-csc" />
                        </PillField>
                      </div>
                      <PillField label="Nome impresso no cartão" valid={card.name.trim().length > 2}>
                        <input className={pillCls(false)} placeholder="Como está no cartão" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} autoComplete="cc-name" maxLength={120} />
                      </PillField>
                      <PillField label="CPF do titular" valid={cpfTitularOk}>
                        <input inputMode="numeric" className={pillCls(false)} placeholder="000.000.000-00" value={card.cpf} onChange={(e) => setCard({ ...card, cpf: maskCPF(e.target.value) })} />
                      </PillField>
                      <InstallmentSelect value={installments} onChange={setInstallments} base={cardBaseCents} fees={cardFees} />
                      {finishMsg && <ErrorNote>{finishMsg}</ErrorNote>}
                      <PillButton cta={cta} onClick={canCard ? payWithCard : finish} disabled={cardBusy}>
                        {cardBusy ? "Processando..." : canCard ? `Pagar ${brl(cardTotalCents)}` : "Finalizar compra"}
                      </PillButton>
                      <PayAssurance color={seloSeguro} />
                    </div>
                  )}
                </PayShell>
              )}
            </div>
            )}
          </Section>
        )}

        {/* Avaliações. undefined = preview (mostra exemplos); [] = esconde.
            Só no celular: no desktop elas vivem na coluna da direita, abaixo do
            resumo — repetir aqui deixaria duas cópias na mesma tela. */}
        <div className="lg:hidden">
          <ReviewsBlock reviews={reviewList} className="mt-4" />
        </div>
          </div>

          {/* Resumo fixo do desktop: acompanha a rolagem enquanto o cliente
              preenche o formulário, que é longo. */}
          <aside className="hidden lg:sticky lg:top-8 lg:block lg:space-y-4">
            <OrderSummary {...summaryProps} desktop savingsCents={savingsCents} />
            {/* Abaixo do resumo vão as AVALIAÇÕES (no desktop). As garantias
                continuam no celular, logo após o pagamento — lá elas resolvem a
                objeção no momento certo; aqui, prova social ao lado do total
                trabalha melhor. */}
            <ReviewsBlock reviews={reviewList} />
          </aside>
        </div>
      </main>

      <footer className="border-t border-gray-100 bg-gray-50 py-8">
        <div className="mx-auto max-w-md px-4 text-center text-sm text-gray-400 lg:max-w-5xl lg:px-6">
          <p className="font-semibold text-gray-500">
            {theme.footer.text && theme.footer.text !== "Checkout — Todos os direitos reservados" ? theme.footer.text : `${storeName} — Todos os direitos reservados`}
          </p>
          <p className="mt-2 text-xs">© {new Date().getFullYear()} {storeName}</p>
          <DadosDaEmpresa footer={theme.footer} className="mt-3" />
          <div className="mt-5"><PaymentBrands /></div>
          {theme.footer.showSecureBadge && <div className="mt-5 flex justify-center"><LockBadge color={seloSeguro} /></div>}
        </div>
      </footer>
    </div>
  );
}

// ─────────────────────────── Subcomponentes ───────────────────────────

// `vox-pill`: marca os campos/botões arredondados do Charm para que a escala de
// bordas (Personalizar → Bordas) os alcance — `rounded-full` sozinho é ignorado
// pela escala de propósito, para não quadrar avatar, radio e selo.
const pillBase =
  `h-11 w-full ${PILL_CLASS} rounded-full border px-4 text-sm outline-none transition placeholder:text-gray-400 focus:border-gray-800`;
function pillCls(invalid: boolean | undefined) {
  return `${pillBase} ${invalid ? "border-red-400 bg-red-50/30" : "border-blue-200/60 bg-blue-50/50"}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4">{children}</div>;
}

/** Casca de uma seção: cartão branco com o título numerado (bolinha colorida). */
function Section({ n, title, color, fg, children }: { n: number; title: string; color: string; fg: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 lg:p-6 lg:shadow-[0_1px_3px_rgba(16,24,40,.06)]">
      <SectionTitle n={n} color={color} fg={fg} title={title} />
      {children}
    </div>
  );
}

/**
 * Etapa que ainda não chegou — só no desktop. No celular ela NÃO aparece: lá o
 * cliente rola uma tela por vez e um cartão cinza no caminho só afastaria o
 * botão.
 */
function PendingSection({ n, title, text }: { n: number; title: string; text: string }) {
  return (
    <div className="mb-4 hidden rounded-2xl border border-dashed border-gray-200 bg-white/50 p-4 lg:block lg:p-6">
      <h3 className="flex items-center gap-2.5 text-xl font-bold text-gray-400">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-[13px] font-extrabold text-gray-500">{n}</span>
        {title}
      </h3>
      <p className="mt-1 pl-[34px] text-xs text-gray-400">{text}</p>
    </div>
  );
}

function SectionTitle({ n, title, color, fg }: { n: number; title: string; color: string; fg: string }) {
  return (
    <h3 className="mb-1 flex items-center gap-2 text-lg font-bold text-gray-700 lg:mb-1.5 lg:gap-2.5 lg:text-xl">
      <span className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-extrabold lg:h-6 lg:w-6 lg:text-[13px]" style={{ background: color, color: fg }}>{n}</span>
      {title}
    </h3>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-gray-700">{children}</span>;
}

/** Campo com rótulo + check verde quando válido + erro embaixo. */
function PillField({ label, valid, error, children }: { label: string; valid: boolean; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        {children}
        {valid && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"><CheckIcon /></span>}
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

/**
 * Etapa já concluída. Não é mais um cartão verde do tamanho de uma seção: vira
 * uma linha compacta com o check, o dado e "Alterar".
 *
 * O motivo é de conversão, não de estética: o que precisa dominar a tela é a
 * etapa ATUAL. Dois blocos grandes de "já fiz isso" empurravam o pagamento para
 * baixo da dobra no desktop — o cliente rolava para encontrar o botão.
 */
function DoneCard({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-green-600 text-white"><CheckSmall /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</div>
          <div className="mt-0.5 space-y-0.5 text-[13px] leading-snug text-gray-700">{children}</div>
        </div>
        <button onClick={onEdit} className="flex-shrink-0 text-xs font-bold text-gray-500 underline transition hover:text-gray-800">
          Alterar
        </button>
      </div>
    </div>
  );
}

function PillButton({ cta, onClick, disabled, children }: { cta: React.CSSProperties; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={cta}
      className={`mt-4 flex w-full items-center justify-center gap-2 ${PILL_CLASS} rounded-full py-3 text-base font-extrabold shadow-lg transition hover:opacity-90 active:scale-[0.99] disabled:opacity-60 lg:py-4 lg:text-[17px]`}
    >
      {children}
    </button>
  );
}

/**
 * Selo logo ABAIXO do botão de pagar. A posição é o ponto: garantia lida a um
 * rolar de distância não tranquiliza ninguém — tem que estar no campo de visão
 * no instante em que o cliente decide clicar.
 */
function PayAssurance({ color }: { color?: string | null }) {
  return (
    <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-gray-500" style={color ? { color } : undefined}>
      <Cadeado size={13} className="flex-shrink-0" />
      {/* Curto para caber numa linha dentro da caixa do pagamento, no celular. */}
      Pagamento seguro · Dados criptografados
    </p>
  );
}

/** Seção de pagamento travada: diz o que falta em vez de só sumir com os botões. */
function LockedPayment({ text, onFix }: { text: string; onFix?: () => void }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-gray-500">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </span>
      <p className="mt-3 text-sm font-semibold text-gray-600">{text}</p>
      {onFix && (
        <button onClick={onFix} className="mt-2 text-xs font-bold text-gray-700 underline">
          Voltar e completar
        </button>
      )}
    </div>
  );
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-600">{children}</p>;
}

function InstallmentSelect({ value, onChange, base, fees }: { value: number; onChange: (n: number) => void; base: number; fees?: CheckoutPayment["installmentFees"] }) {
  return (
    <div>
      <FieldLabel>Parcelas</FieldLabel>
      <select className={`${pillBase} border-blue-200/60 bg-blue-50/50`} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => {
          const tot = cardChargeCents(base, n, fees);
          return (
            <option key={n} value={n}>
              {n}x de {brl(Math.round(tot / n))}{tot <= base ? " sem juros" : ` (${brl(tot)})`}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/**
 * Barra de progresso 1 · 2 · 3.
 *
 * Progresso visível é o item de checkout com efeito mais consistente em
 * abandono: o cliente precisa saber quanto FALTA, não quanto já fez. Por isso a
 * etapa atual ganha um anel destacado e as concluídas viram check — dá a
 * sensação de avanço em vez de "mais um formulário".
 */
function StepBar({ step, color, fg }: { step: number; color: string; fg: string }) {
  const labels = [
    { n: 1, label: "Identificação" },
    { n: 2, label: "Entrega" },
    { n: 3, label: "Pagamento" },
  ];
  return (
    <div className="relative mb-8 grid grid-cols-3 lg:mb-10">
      <div className="absolute left-0 right-0 top-[15px] h-[2px] bg-gray-200 lg:top-[19px] lg:h-[3px]" />
      <div
        className="absolute left-0 top-[15px] h-[2px] transition-all duration-500 lg:top-[19px] lg:h-[3px]"
        style={{ width: step >= 3 ? "100%" : step >= 2 ? "50%" : "16.67%", background: color }}
      />
      {labels.map((s) => {
        const done = step > s.n;
        const active = step >= s.n;
        const current = step === s.n;
        return (
          <div key={s.n} className="relative z-10 flex flex-col items-center">
            <div
              className={`flex h-[30px] w-[30px] items-center justify-center rounded-full border-[4px] border-gray-50 text-xs font-bold transition-all lg:h-[38px] lg:w-[38px] lg:text-sm ${current ? "lg:scale-105" : ""}`}
              style={
                active
                  ? { background: color, color: fg, boxShadow: current ? `0 0 0 5px ${color}22` : undefined }
                  : { background: "#d4d4d5", color: "#000" }
              }
            >
              {done ? <CheckSmall /> : s.n}
            </div>
            <span className={`mt-1.5 whitespace-nowrap text-[11px] font-extrabold lg:mt-2.5 lg:text-[12.5px] ${active ? "text-gray-800" : "text-gray-400"}`}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Resumo do pedido. O CONTEÚDO é sempre o mesmo; muda só a casca:
 *  • celular → cartão com borda e o rótulo "RESUMO", abre/fecha
 *  • desktop → painel sempre aberto, fixo na coluna da direita
 */
function OrderSummary(p: {
  open: boolean; onToggle: () => void; desktop?: boolean; savingsCents?: number;
  cart: CheckoutItem[]; itemCount: number; totalCents: number; couponCents: number;
  appliedCoupon: AppliedCoupon | null; shippingCents: number; shipReady: boolean; shipName?: string;
  atPayment: boolean; payment: "card" | "pix" | null; pixDiscountCents: number; cardJurosCents: number;
  installments: number; effectiveCents: number; title: string;
  coupon: string; couponBusy: boolean; couponMsg: string | null;
  onCouponChange: (v: string) => void; onApplyCoupon: () => void; onRemoveCoupon: () => void;
  onQty: (id: string, delta: number) => void; primary: string;
}) {
  // No desktop o painel não abre/fecha: fica sempre aberto.
  const aberto = p.desktop || p.open;
  const body = (
    <div className="grid transition-all duration-300 ease-out" style={{ gridTemplateRows: aberto ? "1fr" : "0fr", opacity: aberto ? 1 : 0 }}>
      <div className="overflow-hidden">
        <div className="space-y-3 pt-3">
          {p.cart.map((it) => (
            <div key={it.id} className="flex items-start gap-3">
              <div className="relative flex-shrink-0">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt={it.name} className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded-lg bg-gray-100" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug text-gray-800">{it.name}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <button onClick={() => p.onQty(it.id, -1)} disabled={it.quantity <= 1} className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-600 disabled:opacity-30">−</button>
                    <span className="min-w-[16px] text-center text-xs font-medium text-gray-700">{it.quantity}</span>
                    <button onClick={() => p.onQty(it.id, 1)} className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-600">+</button>
                  </span>
                  <span className="text-xs font-medium text-gray-800">{brl(it.priceCents * it.quantity)}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Cupom — sempre exibido (o toggle que o escondia foi removido). */}
          <div>
            {p.appliedCoupon ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2 text-sm">
                <span className="font-medium text-green-700">Cupom {p.appliedCoupon.code} aplicado</span>
                <button onClick={p.onRemoveCoupon} className="text-xs font-medium text-gray-500 hover:text-gray-700">Remover</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input value={p.coupon} onChange={(e) => p.onCouponChange(e.target.value)} placeholder="Cupom de desconto" className={`h-10 min-w-0 flex-1 ${PILL_CLASS} rounded-full border border-gray-300 px-4 text-sm outline-none focus:border-gray-800`} />
                <button onClick={p.onApplyCoupon} disabled={p.couponBusy} className={`flex-shrink-0 whitespace-nowrap ${PILL_CLASS} rounded-full border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50`}>
                  {p.couponBusy ? "..." : "Aplicar"}
                </button>
              </div>
            )}
            {p.couponMsg && <p className="mt-1 text-xs text-red-500">{p.couponMsg}</p>}
          </div>

          <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm">
            <Row label={`Produtos (${p.itemCount})`} value={brl(p.totalCents)} />
            {p.couponCents > 0 && p.appliedCoupon && <Row label={`Cupom (${p.appliedCoupon.code})`} value={`-${brl(p.couponCents)}`} green />}
            {p.shipReady && (
              <Row label={`Frete${p.shipName ? ` (${p.shipName})` : ""}`} value={p.shippingCents === 0 ? "Grátis" : brl(p.shippingCents)} green={p.shippingCents === 0} />
            )}
            {p.atPayment && p.payment === "pix" && p.pixDiscountCents > 0 && <Row label="Desconto no PIX" value={`-${brl(p.pixDiscountCents)}`} green />}
            {p.atPayment && p.payment === "card" && p.cardJurosCents > 0 && <Row label={`Juros (${p.installments}x)`} value={`+${brl(p.cardJurosCents)}`} />}
            <div className="flex items-center justify-between border-t border-gray-300 pt-1.5">
              <span className="font-semibold text-green-600">Total</span>
              <span className="text-base font-bold text-green-600">{brl(p.effectiveCents)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (p.desktop) {
    // Painel da coluna direita: sempre aberto, sem botão de abrir/fechar.
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_3px_rgba(16,24,40,.06)]">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-700">{p.title || "Resumo"}</h2>
        {body}
        {/* Economia em destaque: o cliente precisa VER o ganho, não deduzi-lo. */}
        {(p.savingsCents ?? 0) > 0 && (
          <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-green-50 px-3 py-2 text-[13px] font-bold text-green-700">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4" /><path d="M4 6v12a2 2 0 0 0 2 2h14v-4" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
            </svg>
            Você está economizando {brl(p.savingsCents!)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mb-6 rounded border border-gray-200 p-4 transition-colors duration-300" style={{ background: p.open ? "#ffffff" : "#e3e8ed" }}>
      <button onClick={p.onToggle} className="flex w-full items-start justify-between">
        <span className="text-left">
          <span className="block text-[11px] font-bold uppercase leading-none tracking-wider text-gray-700">{p.title || "Resumo"}</span>
          {!p.open && <span className="mt-1 block text-xs text-gray-500">Informações da sua compra</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1 leading-none">
          {!p.open && <span className="font-semibold text-green-600">{brl(p.effectiveCents)}</span>}
          <Chevron open={p.open} />
        </span>
      </button>
      {body}
    </div>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-gray-600">{label}</span>
      <span className={`font-medium ${green ? "text-green-600" : "text-gray-800"}`}>{value}</span>
    </div>
  );
}

/**
 * Forma de pagamento: seletor redondo na cor principal da loja, título com o
 * selo de desconto ao lado, preço à direita (o promocional em cima, o cheio
 * riscado embaixo) e as bandeiras aceitas embaixo do título.
 *
 * A escolhida ganha a borda na cor da loja. Antes era uma caixa quadrada preta
 * e borda cinza-escura, que destoava de qualquer paleta que não fosse preta.
 *
 * Nasce sempre desmarcada e fechada; abre ao ser escolhida.
 */
function PayShell({ price, oldPrice, brands, badge, accent, ...rest }: {
  selected: boolean; onSelect: () => void; title: string;
  icon: React.ReactNode; price?: string; oldPrice?: string | null;
  badge?: string; accent: string;
  brands?: React.ReactNode; children?: React.ReactNode;
}) {
  const { selected, onSelect, title, icon, children } = rest;
  return (
    <div
      className="rounded-xl border bg-white transition-[border-color,box-shadow] duration-200"
      style={
        selected
          ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}, 0 10px 24px -16px rgba(17, 24, 39, 0.45)` }
          : { borderColor: "#e5e7eb" }
      }
    >
      <button onClick={onSelect} aria-pressed={selected} className="w-full p-4 text-left">
        <span className="flex items-center gap-3">
          {/* Redondo de propósito: o arredondamento do tema não mexe nele. */}
          <span
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 bg-white transition-colors"
            style={{ borderColor: selected ? accent : "#cbd5e1" }}
          >
            <span
              className="h-2.5 w-2.5 rounded-full transition-transform duration-200"
              style={{ background: accent, transform: selected ? "scale(1)" : "scale(0)" }}
            />
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold text-gray-800">{title}</span>
            {badge && (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold leading-none text-green-700 ring-1 ring-inset ring-green-600/20">
                {badge}
              </span>
            )}
          </span>
          {price && (
            <span className="flex flex-col items-end leading-tight">
              <span className="text-[15px] font-bold text-green-600">{price}</span>
              {oldPrice && <span className="text-[11.5px] text-gray-400 line-through">{oldPrice}</span>}
            </span>
          )}
          <span className="flex-shrink-0">{icon}</span>
        </span>
        {brands && <span className="mt-2 flex items-center gap-1.5 pl-8">{brands}</span>}
      </button>
      {selected && children && <div className="border-t border-gray-100 px-4 pb-4 pt-3.5">{children}</div>}
    </div>
  );
}

/** Um item do "como pagar" do Pix: ícone pequeno no verde do Pix + texto curto. */
function PixPasso({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center text-[#32BCAD]">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function CardBrands() {
  return (
    <>
      {["visa", "mastercard", "elo", "amex", "hipercard"].map((b) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={b} src={`/payment/${b}.svg`} alt={b} className="h-5 w-8 rounded border border-gray-200 bg-white object-contain p-0.5" />
      ))}
    </>
  );
}

// ── Ícones ──
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  );
}
function CheckSmall() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  );
}
function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600 transition-transform duration-300" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}><path d="m6 9 6 6 6-6" /></svg>
  );
}
function PixGlyph() {
  // O arquivo oficial da marca. O SVG desenhado à mão que estava aqui antes
  // renderizava errado.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/payment/pix.png" alt="Pix" width={24} height={24} className="h-6 w-6 object-contain" />;
}
function CardGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
  );
}
/**
 * Símbolo oficial do Pix (os traços de public/payment/pix.svg) em
 * currentColor, para ir dentro do botão na cor do texto dele.
 */
function PixMark() {
  return (
    <svg width="18" height="18" viewBox="2.63 4.07 5.2 5.2" fill="currentColor" aria-hidden className="flex-shrink-0">
      <path d="M6.67 8.04c-0.2,0 -0.39,-0.08 -0.53,-0.22l-0.78 -0.78c-0.05,-0.05 -0.15,-0.05 -0.2,0l-0.78 0.78c-0.14,0.15 -0.33,0.22 -0.54,0.22l-0.15 0 0.98 0.99c0.31,0.3 0.81,0.3 1.11,0l0.99 -0.99 -0.1 0z" />
      <path d="M3.84 5.3c0.21,0 0.4,0.08 0.54,0.22l0.78 0.78c0.05,0.06 0.15,0.06 0.2,0l0.78 -0.77c0.14,-0.15 0.33,-0.23 0.53,-0.23l0.1 0 -0.99 -0.98c-0.3,-0.31 -0.8,-0.31 -1.11,0l-0.98 0.98 0.15 0z" />
      <path d="M7.58 6.12l-0.6 -0.6c-0.01,0.01 -0.02,0.01 -0.04,0.01l-0.27 0c-0.14,0 -0.27,0.06 -0.37,0.16l-0.78 0.77c-0.07,0.07 -0.17,0.11 -0.26,0.11 -0.1,0 -0.19,-0.04 -0.26,-0.11l-0.78 -0.77c-0.1,-0.1 -0.24,-0.16 -0.38,-0.16l-0.33 0c-0.01,0 -0.03,0 -0.04,-0.01l-0.59 0.6c-0.31,0.3 -0.31,0.8 0,1.11l0.59 0.59c0.01,0 0.03,0 0.04,0l0.33 0c0.14,0 0.28,-0.06 0.38,-0.16l0.78 -0.78c0.14,-0.14 0.38,-0.14 0.52,0l0.78 0.78c0.1,0.1 0.23,0.15 0.37,0.15l0.27 0c0.02,0 0.03,0.01 0.04,0.01l0.6 -0.59c0.31,-0.31 0.31,-0.81 0,-1.11z" />
    </svg>
  );
}
function IconQr() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </svg>
  );
}
function IconRelogio() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  );
}
function IconConfirma() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 10" />
    </svg>
  );
}
