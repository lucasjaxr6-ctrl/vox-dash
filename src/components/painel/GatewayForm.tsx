"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GatewayKey } from "@/lib/gateways";
import AppmaxUrls from "@/components/painel/AppmaxUrls";

// Configuração de UM gateway (página própria). Salva payload PARCIAL — mexer
// aqui não toca nos outros gateways. As credenciais nunca voltam do servidor.
export default function GatewayForm({ gateway }: { gateway: GatewayKey }) {
  const router = useRouter();

  const [mpPix, setMpPix] = useState(false);
  const [mpCard, setMpCard] = useState(false);
  const [pinpayPix, setPinpayPix] = useState(false);
  const [appmaxPix, setAppmaxPix] = useState(false);
  const [appmaxCard, setAppmaxCard] = useState(false);
  const [freepayPix, setFreepayPix] = useState(false);
  const [freepayCard, setFreepayCard] = useState(false);
  const [freepayPublic, setFreepayPublic] = useState("");
  const [freepaySecretKey, setFreepaySecretKey] = useState("");
  const [freepaySet, setFreepaySet] = useState(false);
  const [wappiPix, setWappiPix] = useState(false);
  const [wappiCard, setWappiCard] = useState(false);
  const [wappiPublic, setWappiPublic] = useState("");
  const [wappiSecretKey, setWappiSecretKey] = useState("");
  const [wappiSet, setWappiSet] = useState(false);
  const [wappiBusy, setWappiBusy] = useState(false);
  const [wappiMsg, setWappiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hypercashPix, setHypercashPix] = useState(false);
  const [hypercashCard, setHypercashCard] = useState(false);
  const [hypercashSecret, setHypercashSecret] = useState("");
  const [hypercashPublicKey, setHypercashPublicKey] = useState("");
  const [hypercashSet, setHypercashSet] = useState(false);
  const [fintpagPix, setFintpagPix] = useState(false);
  const [fintpagCard, setFintpagCard] = useState(false);
  const [fintpagSecret, setFintpagSecret] = useState("");
  const [fintpagPublicKey, setFintpagPublicKey] = useState("");
  const [fintpagSet, setFintpagSet] = useState(false);
  const [hylexpayPix, setHylexpayPix] = useState(false);
  const [hylexpayCard, setHylexpayCard] = useState(false);
  const [hylexpaySecret, setHylexpaySecret] = useState("");
  const [hylexpayPublicKey, setHylexpayPublicKey] = useState("");
  const [hylexpaySet, setHylexpaySet] = useState(false);
  const [beehivePix, setBeehivePix] = useState(false);
  const [beehiveCard, setBeehiveCard] = useState(false);
  const [beehiveSecret, setBeehiveSecret] = useState("");
  const [beehivePublicKey, setBeehivePublicKey] = useState("");
  const [beehiveSet, setBeehiveSet] = useState(false);
  const [beehiveBusy, setBeehiveBusy] = useState(false);
  const [beehiveMsg, setBeehiveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bluevisionPix, setBluevisionPix] = useState(false);
  const [bluevisionCard, setBluevisionCard] = useState(false);
  const [bluevisionSecret, setBluevisionSecret] = useState("");
  const [bluevisionWebhookSecret, setBluevisionWebhookSecret] = useState("");
  const [bluevisionSet, setBluevisionSet] = useState(false);
  const [bluevisionWebhookSet, setBluevisionWebhookSet] = useState(false);
  const [bluevisionBusy, setBluevisionBusy] = useState(false);
  const [bluevisionMsg, setBluevisionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nuvraPix, setNuvraPix] = useState(false);
  const [nuvraCard, setNuvraCard] = useState(false);
  const [nuvraApiKey, setNuvraApiKey] = useState("");
  const [nuvraWebhookSecret, setNuvraWebhookSecret] = useState("");
  const [nuvraSet, setNuvraSet] = useState(false);
  const [nuvraWebhookSet, setNuvraWebhookSet] = useState(false);
  const [nuvraBusy, setNuvraBusy] = useState(false);
  const [nuvraMsg, setNuvraMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pagnivPix, setPagnivPix] = useState(false);
  const [pagnivCard, setPagnivCard] = useState(false);
  const [pagnivApiKey, setPagnivApiKey] = useState("");
  const [pagnivWebhookSecret, setPagnivWebhookSecret] = useState("");
  const [pagnivSet, setPagnivSet] = useState(false);
  const [pagnivWebhookSet, setPagnivWebhookSet] = useState(false);
  const [pagnivBusy, setPagnivBusy] = useState(false);
  const [pagnivMsg, setPagnivMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [vextPix, setVextPix] = useState(false);
  const [vextApiKey, setVextApiKey] = useState("");
  const [vextWebhookSecret, setVextWebhookSecret] = useState("");
  const [vextSet, setVextSet] = useState(false);
  const [vextWebhookSet, setVextWebhookSet] = useState(false);
  const [vextBusy, setVextBusy] = useState(false);
  const [vextMsg, setVextMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [blackcatPix, setBlackcatPix] = useState(false);
  const [blackcatCard, setBlackcatCard] = useState(false);
  const [blackcatApiKey, setBlackcatApiKey] = useState("");
  const [blackcatSet, setBlackcatSet] = useState(false);
  const [blackcatBusy, setBlackcatBusy] = useState(false);
  const [blackcatMsg, setBlackcatMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pagarmePix, setPagarmePix] = useState(false);
  const [pagarmeCard, setPagarmeCard] = useState(false);
  const [pagarmeSecret, setPagarmeSecret] = useState("");
  const [pagarmeSet, setPagarmeSet] = useState(false);
  const [pagarmeBusy, setPagarmeBusy] = useState(false);
  const [pagarmeMsg, setPagarmeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [veopagPix, setVeopagPix] = useState(false);
  const [veopagCard, setVeopagCard] = useState(false);
  const [veopagClientId, setVeopagClientId] = useState("");
  const [veopagClientSecret, setVeopagClientSecret] = useState("");
  const [veopagWebhookSecret, setVeopagWebhookSecret] = useState("");
  const [veopagSet, setVeopagSet] = useState(false);
  const [veopagWebhookSet, setVeopagWebhookSet] = useState(false);
  const [veopagBusy, setVeopagBusy] = useState(false);
  const [veopagMsg, setVeopagMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mangofyPix, setMangofyPix] = useState(false);
  const [mangofyCard, setMangofyCard] = useState(false);
  const [mangofyApiKey, setMangofyApiKey] = useState("");
  const [mangofyStoreCode, setMangofyStoreCode] = useState("");
  const [mangofySet, setMangofySet] = useState(false);
  const [mangofyBusy, setMangofyBusy] = useState(false);
  const [mangofyMsg, setMangofyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pixgoPix, setPixgoPix] = useState(false);
  const [pixgoApiKey, setPixgoApiKey] = useState("");
  const [pixgoWebhook, setPixgoWebhook] = useState("");
  const [pixgoKeySet, setPixgoKeySet] = useState(false);
  const [pixgoWebhookSet, setPixgoWebhookSet] = useState(false);
  const [mushpagPix, setMushpagPix] = useState(false);
  const [mushpagApiKey, setMushpagApiKey] = useState("");
  const [mushpagSet, setMushpagSet] = useState(false);
  const [mushpagBusy, setMushpagBusy] = useState(false);
  const [mushpagMsg, setMushpagMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pagouPix, setPagouPix] = useState(false);
  const [pagouToken, setPagouToken] = useState("");
  const [pagouTokenSet, setPagouTokenSet] = useState(false);
  const [pagouCard, setPagouCard] = useState(false);
  const [pagouPublicKey, setPagouPublicKey] = useState("");
  const [pagouBusy, setPagouBusy] = useState(false);
  const [pagouMsg, setPagouMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pushinpayPix, setPushinpayPix] = useState(false);
  const [pushinpayToken, setPushinpayToken] = useState("");
  const [pushinpayTokenSet, setPushinpayTokenSet] = useState(false);
  const [pushinpayHook, setPushinpayHook] = useState("");
  const [pushinpayHookSet, setPushinpayHookSet] = useState(false);
  const [pushinpayHookClear, setPushinpayHookClear] = useState(false);
  const [pushinpayBusy, setPushinpayBusy] = useState(false);
  const [pushinpayMsg, setPushinpayMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [mpToken, setMpToken] = useState("");
  const [mpPublicKey, setMpPublicKey] = useState("");
  const [pinpaySecret, setPinpaySecret] = useState("");
  const [pinpayPublicKey, setPinpayPublicKey] = useState("");
  const [appmaxClientId, setAppmaxClientId] = useState("");
  const [appmaxClientSecret, setAppmaxClientSecret] = useState("");
  const [appmaxAppId, setAppmaxAppId] = useState("");
  const [appmaxPartnerClientId, setAppmaxPartnerClientId] = useState("");
  const [appmaxPartnerSecret, setAppmaxPartnerSecret] = useState("");
  const [appmaxPartnerSet, setAppmaxPartnerSet] = useState(false);
  const [mpTokenSet, setMpTokenSet] = useState(false);
  const [pinpaySecretSet, setPinpaySecretSet] = useState(false);
  const [appmaxSet, setAppmaxSet] = useState(false);
  const [appmaxConnected, setAppmaxConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings } = await res.json();
        setMpPix(Boolean(settings.mpPixEnabled));
        setMpCard(Boolean(settings.mpCardEnabled));
        setMpTokenSet(Boolean(settings.mpAccessTokenConfigured));
        setMpPublicKey(settings.mpPublicKey || "");
        setPinpayPix(Boolean(settings.pinpayPixEnabled));
        setPinpaySecretSet(Boolean(settings.pinpaySecretConfigured));
        setPinpayPublicKey(settings.pinpayPublicKey || "");
        setAppmaxPix(Boolean(settings.appmaxPixEnabled));
        setAppmaxCard(Boolean(settings.appmaxCardEnabled));
        setAppmaxSet(Boolean(settings.appmaxConfigured));
        setAppmaxConnected(Boolean(settings.appmaxConnected));
        setAppmaxAppId(settings.appmaxAppId || "");
        setAppmaxPartnerClientId(settings.appmaxPartnerClientId || "");
        setAppmaxPartnerSet(Boolean(settings.appmaxPartnerConfigured));
        setFreepayPix(Boolean(settings.freepayPixEnabled));
        setFreepayCard(Boolean(settings.freepayCardEnabled));
        setFreepaySet(Boolean(settings.freepayConfigured));
        setWappiPix(Boolean(settings.wappiPixEnabled));
        setWappiCard(Boolean(settings.wappiCardEnabled));
        setWappiSet(Boolean(settings.wappiConfigured));
        setHypercashPix(Boolean(settings.hypercashPixEnabled));
        setHypercashCard(Boolean(settings.hypercashCardEnabled));
        setHypercashPublicKey(settings.hypercashPublicKey || "");
        setHypercashSet(Boolean(settings.hypercashConfigured));
        setFintpagPix(Boolean(settings.fintpagPixEnabled));
        setFintpagCard(Boolean(settings.fintpagCardEnabled));
        setFintpagPublicKey(settings.fintpagPublicKey || "");
        setFintpagSet(Boolean(settings.fintpagConfigured));
        setHylexpayPix(Boolean(settings.hylexpayPixEnabled));
        setHylexpayCard(Boolean(settings.hylexpayCardEnabled));
        setHylexpayPublicKey(settings.hylexpayPublicKey || "");
        setHylexpaySet(Boolean(settings.hylexpayConfigured));
        setBeehivePix(Boolean(settings.beehivePixEnabled));
        setBeehiveCard(Boolean(settings.beehiveCardEnabled));
        setBeehivePublicKey(settings.beehivePublicKey || "");
        setBeehiveSet(Boolean(settings.beehiveConfigured));
        setBluevisionPix(Boolean(settings.bluevisionPixEnabled));
        setBluevisionCard(Boolean(settings.bluevisionCardEnabled));
        setBluevisionSet(Boolean(settings.bluevisionConfigured));
        setBluevisionWebhookSet(Boolean(settings.bluevisionWebhookConfigured));
        setNuvraPix(Boolean(settings.nuvraPixEnabled));
        setNuvraCard(Boolean(settings.nuvraCardEnabled));
        setNuvraSet(Boolean(settings.nuvraConfigured));
        setNuvraWebhookSet(Boolean(settings.nuvraWebhookConfigured));
        setPagnivPix(Boolean(settings.pagnivPixEnabled));
        setPagnivCard(Boolean(settings.pagnivCardEnabled));
        setPagnivSet(Boolean(settings.pagnivConfigured));
        setPagnivWebhookSet(Boolean(settings.pagnivWebhookConfigured));
        setVextPix(Boolean(settings.vextPixEnabled));
        setVextSet(Boolean(settings.vextConfigured));
        setVextWebhookSet(Boolean(settings.vextWebhookConfigured));
        setBlackcatPix(Boolean(settings.blackcatPixEnabled));
        setBlackcatCard(Boolean(settings.blackcatCardEnabled));
        setBlackcatSet(Boolean(settings.blackcatConfigured));
        setPagarmePix(Boolean(settings.pagarmePixEnabled));
        setPagarmeCard(Boolean(settings.pagarmeCardEnabled));
        setPagarmeSet(Boolean(settings.pagarmeConfigured));
        setVeopagPix(Boolean(settings.veopagPixEnabled));
        setVeopagCard(Boolean(settings.veopagCardEnabled));
        setVeopagSet(Boolean(settings.veopagConfigured));
        setVeopagWebhookSet(Boolean(settings.veopagWebhookConfigured));
        setMangofyPix(Boolean(settings.mangofyPixEnabled));
        setMangofyCard(Boolean(settings.mangofyCardEnabled));
        setMangofyStoreCode(settings.mangofyStoreCode || "");
        setMangofySet(Boolean(settings.mangofyConfigured));
        setPixgoPix(Boolean(settings.pixgoPixEnabled));
        setPixgoKeySet(Boolean(settings.pixgoConfigured));
        setPixgoWebhookSet(Boolean(settings.pixgoWebhookConfigured));
        setMushpagPix(Boolean(settings.mushpagPixEnabled));
        setMushpagSet(Boolean(settings.mushpagConfigured));
        setPagouPix(Boolean(settings.pagouPixEnabled));
        setPagouTokenSet(Boolean(settings.pagouConfigured));
        setPagouCard(Boolean(settings.pagouCardEnabled));
        setPagouPublicKey(settings.pagouPublicKey || "");
        setPushinpayPix(Boolean(settings.pushinpayPixEnabled));
        setPushinpayTokenSet(Boolean(settings.pushinpayConfigured));
        setPushinpayHookSet(Boolean(settings.pushinpayWebhookConfigured));
      } catch {
        /* silencioso */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** Confere o token da Pagou sem criar cobrança (só leitura na API deles). */
  async function testPagou() {
    setPagouBusy(true);
    setPagouMsg(null);
    try {
      const res = await fetch("/api/painel/pagou/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setPagouMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Token aceito pela Pagou." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Pagou." },
      );
    } catch {
      setPagouMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setPagouBusy(false);
    }
  }

  /** Confere a chave da Vext lendo o saldo (não cria cobrança). */
  async function testVext() {
    setVextBusy(true);
    setVextMsg(null);
    try {
      const res = await fetch("/api/painel/vext/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setVextMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela Vext." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Vext." },
      );
    } catch {
      setVextMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setVextBusy(false);
    }
  }

  /**
   * Confere a chave da MushPag (só leitura) e cadastra o nosso webhook na
   * conta, que lá só existe pela API. Roda sozinho depois de salvar chave nova.
   */
  async function testMushpag() {
    setMushpagBusy(true);
    setMushpagMsg(null);
    try {
      const res = await fetch("/api/painel/mushpag/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMushpagMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela MushPag." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a MushPag." },
      );
    } catch {
      setMushpagMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setMushpagBusy(false);
    }
  }

  /** Confere a API Key da BlackCat lendo os dados da conta (não cria cobrança). */
  async function testBlackcat() {
    setBlackcatBusy(true);
    setBlackcatMsg(null);
    try {
      const res = await fetch("/api/painel/blackcat/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setBlackcatMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela BlackCat." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a BlackCat." },
      );
    } catch {
      setBlackcatMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setBlackcatBusy(false);
    }
  }

  /** Confere a chave secreta da Pagar.me listando 1 pedido (não cria cobrança). */
  async function testPagarme() {
    setPagarmeBusy(true);
    setPagarmeMsg(null);
    try {
      const res = await fetch("/api/painel/pagarme/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setPagarmeMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela Pagar.me." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Pagar.me." },
      );
    } catch {
      setPagarmeMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setPagarmeBusy(false);
    }
  }

  /** Faz o login na VeoPag e lê o saldo (não cria cobrança). */
  async function testVeopag() {
    setVeopagBusy(true);
    setVeopagMsg(null);
    try {
      const res = await fetch("/api/painel/veopag/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setVeopagMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Credenciais aceitas pela VeoPag." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a VeoPag." },
      );
    } catch {
      setVeopagMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setVeopagBusy(false);
    }
  }

  /** Confere API Key + Store Code da MangoFy com uma leitura (não cria cobrança). */
  async function testMangofy() {
    setMangofyBusy(true);
    setMangofyMsg(null);
    try {
      const res = await fetch("/api/painel/mangofy/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setMangofyMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Credenciais aceitas pela MangoFy." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a MangoFy." },
      );
    } catch {
      setMangofyMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setMangofyBusy(false);
    }
  }

  /** Confere as chaves da Wappi com uma leitura da conta (não cria cobrança). */
  async function testWappi() {
    setWappiBusy(true);
    setWappiMsg(null);
    try {
      const res = await fetch("/api/painel/wappi/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setWappiMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chaves aceitas pela Wappi." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Wappi." },
      );
    } catch {
      setWappiMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setWappiBusy(false);
    }
  }

  /** Confere a Secret Key da Blue Vision sem criar cobrança (lista 1 transação). */
  async function testBluevision() {
    setBluevisionBusy(true);
    setBluevisionMsg(null);
    try {
      const res = await fetch("/api/painel/bluevision/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setBluevisionMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela Blue Vision." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Blue Vision." },
      );
    } catch {
      setBluevisionMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setBluevisionBusy(false);
    }
  }

  /** Confere a chave da Nuvra e já diz o ambiente e se o cartão está liberado. */
  async function testNuvra() {
    setNuvraBusy(true);
    setNuvraMsg(null);
    try {
      const res = await fetch("/api/painel/nuvra/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setNuvraMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela Nuvra." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a Nuvra." },
      );
    } catch {
      setNuvraMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setNuvraBusy(false);
    }
  }

  /** Confere a chave da PagNiv e já diz se o cartão está liberado na conta. */
  async function testPagniv() {
    setPagnivBusy(true);
    setPagnivMsg(null);
    try {
      const res = await fetch("/api/painel/pagniv/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setPagnivMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela PagNiv." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a PagNiv." },
      );
    } catch {
      setPagnivMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setPagnivBusy(false);
    }
  }

  /** Confere a chave da Beehive sem criar cobrança (só lê o saldo). */
  async function testBeehive() {
    setBeehiveBusy(true);
    setBeehiveMsg(null);
    try {
      const res = await fetch("/api/painel/beehive/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setBeehiveMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Chave aceita pela Beehive." }
          // `detalhe` mostra o que a API respondeu em cada formato tentado.
          : { ok: false, text: [d?.error ?? "Falha ao falar com a Beehive.", d?.detalhe].filter(Boolean).join(" ") },
      );
    } catch {
      setBeehiveMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setBeehiveBusy(false);
    }
  }

  /** Confere o token da PushinPay sem criar cobrança (só lê a conta deles). */
  async function testPushinpay() {
    setPushinpayBusy(true);
    setPushinpayMsg(null);
    try {
      const res = await fetch("/api/painel/pushinpay/test", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setPushinpayMsg(
        res.ok
          ? { ok: true, text: d?.message ?? "Token aceito pela PushinPay." }
          : { ok: false, text: d?.error ?? "Falha ao falar com a PushinPay." },
      );
    } catch {
      setPushinpayMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setPushinpayBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const p: Record<string, unknown> = {};
    if (gateway === "mercadopago") {
      p.mpPixEnabled = mpPix;
      p.mpCardEnabled = mpCard;
      p.mpPublicKey = mpPublicKey.trim();
      if (mpToken.trim()) p.mpAccessToken = mpToken.trim();
    } else if (gateway === "pinpay") {
      p.pinpayPixEnabled = pinpayPix;
      p.pinpayPublicKey = pinpayPublicKey.trim();
      if (pinpaySecret.trim()) p.pinpaySecret = pinpaySecret.trim();
    } else if (gateway === "appmax") {
      p.appmaxPixEnabled = appmaxPix;
      p.appmaxCardEnabled = appmaxCard;
      // O sandbox saiu da tela em 24/10/2026 (nenhuma loja usava): salvar
      // sempre grava produção, para ninguém ficar preso cobrando de mentira.
      p.appmaxSandbox = false;
      if (appmaxClientId.trim()) p.appmaxClientId = appmaxClientId.trim();
      if (appmaxClientSecret.trim()) p.appmaxClientSecret = appmaxClientSecret.trim();
      p.appmaxAppId = appmaxAppId.trim();
      p.appmaxPartnerClientId = appmaxPartnerClientId.trim();
      if (appmaxPartnerSecret.trim()) p.appmaxPartnerClientSecret = appmaxPartnerSecret.trim();
    } else if (gateway === "freepay") {
      p.freepayPixEnabled = freepayPix;
      p.freepayCardEnabled = freepayCard;
      // O Company ID não é mais digitado: lib/freepay.ts descobre pelas chaves.
      if (freepayPublic.trim()) p.freepayPublicKey = freepayPublic.trim();
      if (freepaySecretKey.trim()) p.freepaySecretKey = freepaySecretKey.trim();
    } else if (gateway === "wappi") {
      p.wappiPixEnabled = wappiPix;
      p.wappiCardEnabled = wappiCard;
      // Company ID descoberto pelas chaves (lib/wappi.ts), como na Freepay.
      if (wappiPublic.trim()) p.wappiPublicKey = wappiPublic.trim();
      if (wappiSecretKey.trim()) p.wappiSecretKey = wappiSecretKey.trim();
    } else if (gateway === "hypercash") {
      p.hypercashPixEnabled = hypercashPix;
      p.hypercashCardEnabled = hypercashCard;
      p.hypercashPublicKey = hypercashPublicKey.trim();
      if (hypercashSecret.trim()) p.hypercashSecretKey = hypercashSecret.trim();
    } else if (gateway === "fintpag") {
      p.fintpagPixEnabled = fintpagPix;
      p.fintpagCardEnabled = fintpagCard;
      p.fintpagPublicKey = fintpagPublicKey.trim();
      if (fintpagSecret.trim()) p.fintpagSecretKey = fintpagSecret.trim();
    } else if (gateway === "hylexpay") {
      p.hylexpayPixEnabled = hylexpayPix;
      p.hylexpayCardEnabled = hylexpayCard;
      p.hylexpayPublicKey = hylexpayPublicKey.trim();
      if (hylexpaySecret.trim()) p.hylexpaySecretKey = hylexpaySecret.trim();
    } else if (gateway === "beehive") {
      p.beehivePixEnabled = beehivePix;
      p.beehiveCardEnabled = beehiveCard;
      p.beehivePublicKey = beehivePublicKey.trim();
      if (beehiveSecret.trim()) p.beehiveSecretKey = beehiveSecret.trim();
    } else if (gateway === "vext") {
      p.vextPixEnabled = vextPix;
      if (vextApiKey.trim()) p.vextApiKey = vextApiKey.trim();
      if (vextWebhookSecret.trim()) p.vextWebhookSecret = vextWebhookSecret.trim();
    } else if (gateway === "blackcat") {
      p.blackcatPixEnabled = blackcatPix;
      p.blackcatCardEnabled = blackcatCard;
      if (blackcatApiKey.trim()) p.blackcatApiKey = blackcatApiKey.trim();
    } else if (gateway === "pagarme") {
      p.pagarmePixEnabled = pagarmePix;
      p.pagarmeCardEnabled = pagarmeCard;
      if (pagarmeSecret.trim()) p.pagarmeSecretKey = pagarmeSecret.trim();
    } else if (gateway === "veopag") {
      p.veopagPixEnabled = veopagPix;
      p.veopagCardEnabled = veopagCard;
      if (veopagClientId.trim()) p.veopagClientId = veopagClientId.trim();
      if (veopagClientSecret.trim()) p.veopagClientSecret = veopagClientSecret.trim();
      if (veopagWebhookSecret.trim()) p.veopagWebhookSecret = veopagWebhookSecret.trim();
    } else if (gateway === "mangofy") {
      p.mangofyPixEnabled = mangofyPix;
      p.mangofyCardEnabled = mangofyCard;
      p.mangofyStoreCode = mangofyStoreCode.trim();
      if (mangofyApiKey.trim()) p.mangofyApiKey = mangofyApiKey.trim();
    } else if (gateway === "bluevision") {
      p.bluevisionPixEnabled = bluevisionPix;
      p.bluevisionCardEnabled = bluevisionCard;
      if (bluevisionSecret.trim()) p.bluevisionSecretKey = bluevisionSecret.trim();
      if (bluevisionWebhookSecret.trim()) p.bluevisionWebhookSecret = bluevisionWebhookSecret.trim();
    } else if (gateway === "nuvra") {
      p.nuvraPixEnabled = nuvraPix;
      p.nuvraCardEnabled = nuvraCard;
      if (nuvraApiKey.trim()) p.nuvraApiKey = nuvraApiKey.trim();
      if (nuvraWebhookSecret.trim()) p.nuvraWebhookSecret = nuvraWebhookSecret.trim();
    } else if (gateway === "pagniv") {
      p.pagnivPixEnabled = pagnivPix;
      p.pagnivCardEnabled = pagnivCard;
      if (pagnivApiKey.trim()) p.pagnivApiKey = pagnivApiKey.trim();
      if (pagnivWebhookSecret.trim()) p.pagnivWebhookSecret = pagnivWebhookSecret.trim();
    } else if (gateway === "pixgo") {
      p.pixgoPixEnabled = pixgoPix;
      if (pixgoApiKey.trim()) p.pixgoApiKey = pixgoApiKey.trim();
      if (pixgoWebhook.trim()) p.pixgoWebhookSecret = pixgoWebhook.trim();
    } else if (gateway === "mushpag") {
      p.mushpagPixEnabled = mushpagPix;
      if (mushpagApiKey.trim()) p.mushpagApiKey = mushpagApiKey.trim();
    } else if (gateway === "pagou") {
      p.pagouPixEnabled = pagouPix;
      p.pagouCardEnabled = pagouCard;
      // Mesma regra do sandbox da Appmax: saiu da tela em 27/10/2026 (nenhuma
      // loja usava) e salvar sempre grava produção.
      p.pagouSandbox = false;
      p.pagouPublicKey = pagouPublicKey.trim();
      if (pagouToken.trim()) p.pagouApiToken = pagouToken.trim();
    } else if (gateway === "pushinpay") {
      p.pushinpayPixEnabled = pushinpayPix;
      if (pushinpayToken.trim()) p.pushinpayToken = pushinpayToken.trim();
      // Em branco MANTÉM o que está salvo (como nos outros segredos). Limpar é
      // explícito: guardar um token que a PushinPay não manda mais faria o
      // webhook rejeitar eventos legítimos e as vendas parariam de confirmar.
      if (pushinpayHookClear) p.pushinpayWebhookToken = "";
      else if (pushinpayHook.trim()) p.pushinpayWebhookToken = pushinpayHook.trim();
    }

    // MushPag: chave nova = testar e cadastrar o webhook logo depois de salvar.
    // A MushPag só cadastra webhook pela API, e esquecer o teste deixaria as
    // vendas confirmando só pela consulta periódica, com atraso.
    const mushpagChaveNova = gateway === "mushpag" && Boolean(mushpagApiKey.trim());

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(data?.error ?? "Erro ao salvar.");
      const s = data.settings ?? {};
      setMushpagApiKey("");
      setMushpagSet(Boolean(s.mushpagConfigured));
      if (mushpagChaveNova) void testMushpag();
      setMpToken(""); setPinpaySecret("");
      setAppmaxClientId(""); setAppmaxClientSecret(""); setAppmaxPartnerSecret("");
      setAppmaxPartnerSet(Boolean(s.appmaxPartnerConfigured));
      setFreepayPublic(""); setFreepaySecretKey(""); setHypercashSecret(""); setFintpagSecret(""); setHylexpaySecret(""); setBeehiveSecret(""); setPagnivApiKey(""); setPagnivWebhookSecret(""); setVextApiKey(""); setVextWebhookSecret(""); setPixgoApiKey(""); setPixgoWebhook("");
      setHypercashSet(Boolean(s.hypercashConfigured));
      setFintpagSet(Boolean(s.fintpagConfigured));
      setHylexpaySet(Boolean(s.hylexpayConfigured));
      setBeehiveSet(Boolean(s.beehiveConfigured));
      setPagnivSet(Boolean(s.pagnivConfigured));
      setPagnivWebhookSet(Boolean(s.pagnivWebhookConfigured));
      setBluevisionSecret(""); setBluevisionWebhookSecret("");
      setBluevisionSet(Boolean(s.bluevisionConfigured));
      setBluevisionWebhookSet(Boolean(s.bluevisionWebhookConfigured));
      setNuvraApiKey(""); setNuvraWebhookSecret("");
      setNuvraSet(Boolean(s.nuvraConfigured));
      setNuvraWebhookSet(Boolean(s.nuvraWebhookConfigured));
      setVextSet(Boolean(s.vextConfigured));
      setVextWebhookSet(Boolean(s.vextWebhookConfigured));
      setBlackcatApiKey("");
      setBlackcatSet(Boolean(s.blackcatConfigured));
      setPagarmeSecret("");
      setPagarmeSet(Boolean(s.pagarmeConfigured));
      setVeopagClientId(""); setVeopagClientSecret(""); setVeopagWebhookSecret("");
      setVeopagSet(Boolean(s.veopagConfigured));
      setVeopagWebhookSet(Boolean(s.veopagWebhookConfigured));
      setMangofyApiKey("");
      setMangofySet(Boolean(s.mangofyConfigured));
      setPixgoKeySet(Boolean(s.pixgoConfigured));
      setPixgoWebhookSet(Boolean(s.pixgoWebhookConfigured));
      setPagouToken("");
      setPagouTokenSet(Boolean(s.pagouConfigured));
      setPushinpayToken(""); setPushinpayHook(""); setPushinpayHookClear(false);
      setPushinpayTokenSet(Boolean(s.pushinpayConfigured));
      setPushinpayHookSet(Boolean(s.pushinpayWebhookConfigured));
      setMpTokenSet(Boolean(s.mpAccessTokenConfigured));
      setPinpaySecretSet(Boolean(s.pinpaySecretConfigured));
      setAppmaxSet(Boolean(s.appmaxConfigured));
      setFreepaySet(Boolean(s.freepayConfigured));
      setWappiPublic(""); setWappiSecretKey("");
      setWappiSet(Boolean(s.wappiConfigured));
      setMsg("Configurações salvas!");
      router.refresh();
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  async function connectAppmax() {
    setConnecting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/appmax/connect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authorizeUrl) {
        setMsg(data?.error ?? "Falha ao conectar a Appmax.");
        setConnecting(false);
        return;
      }
      window.location.href = data.authorizeUrl; // autoriza na Appmax e volta pro callback
    } catch {
      setMsg("Erro de rede.");
      setConnecting(false);
    }
  }

  // Mensagem de retorno da autorização (?appmax=conectado|erro|nao_encontrado).
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const st = qs.get("appmax");
    if (!st) return;
    const motivo = qs.get("motivo");
    if (st === "conectado") { setAppmaxConnected(true); setMsg("Appmax conectada com sucesso! 🎉"); }
    else if (st === "nao_encontrado") setMsg("Não localizamos a instalação. Clique em conectar de novo e autorize em até 1 hora.");
    else if (st === "erro") {
      // A causa mais comum quando a loja usa o próprio app parceiro: a URL de
      // validação cadastrada nele não responde sem redirecionar (sem o www, por
      // exemplo). A Appmax não segue redirecionamento.
      setMsg(
        `Falha ao concluir a conexão com a Appmax.${motivo ? ` Motivo: ${motivo}` : ""} Confira no app da Appmax se as URLs são exatamente as do quadro "O que colocar no app da Appmax" e conecte de novo.`,
      );
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card p-6">
        <div className="space-y-3">
          {gateway === "appmax" && (
            <>
              <ToggleRow label="Pix" checked={appmaxPix} onChange={setAppmaxPix} />
              <ToggleRow label="Cartão de crédito" checked={appmaxCard} onChange={setAppmaxCard} />
            </>
          )}
          {gateway === "freepay" && (
            <>
              <ToggleRow label="Pix" checked={freepayPix} onChange={setFreepayPix} />
              <ToggleRow label="Cartão de crédito" checked={freepayCard} onChange={setFreepayCard} />
            </>
          )}
          {gateway === "wappi" && (
            <>
              <ToggleRow label="Pix" checked={wappiPix} onChange={setWappiPix} />
              <ToggleRow label="Cartão de crédito" checked={wappiCard} onChange={setWappiCard} />
            </>
          )}
          {gateway === "hypercash" && (
            <>
              <ToggleRow label="Pix" checked={hypercashPix} onChange={setHypercashPix} />
              <ToggleRow label="Cartão de crédito" checked={hypercashCard} onChange={setHypercashCard} />
            </>
          )}
          {gateway === "fintpag" && (
            <>
              <ToggleRow label="Pix" checked={fintpagPix} onChange={setFintpagPix} />
              <ToggleRow label="Cartão de crédito" checked={fintpagCard} onChange={setFintpagCard} />
            </>
          )}
          {gateway === "hylexpay" && (
            <>
              <ToggleRow label="Pix" checked={hylexpayPix} onChange={setHylexpayPix} />
              <ToggleRow label="Cartão de crédito" checked={hylexpayCard} onChange={setHylexpayCard} />
            </>
          )}
          {gateway === "beehive" && (
            <>
              <ToggleRow label="Pix" checked={beehivePix} onChange={setBeehivePix} />
              <ToggleRow label="Cartão de crédito" checked={beehiveCard} onChange={setBeehiveCard} />
            </>
          )}
          {gateway === "vext" && (
            <>
              <ToggleRow label="Pix" checked={vextPix} onChange={setVextPix} />
              <ToggleRow label="Cartão" checked={false} disabled onChange={() => {}} />
            </>
          )}
          {gateway === "blackcat" && (
            <>
              <ToggleRow label="Pix" checked={blackcatPix} onChange={setBlackcatPix} />
              <ToggleRow label="Cartão de crédito" checked={blackcatCard} onChange={setBlackcatCard} />
            </>
          )}
          {gateway === "pagarme" && (
            <>
              <ToggleRow label="Pix" checked={pagarmePix} onChange={setPagarmePix} />
              <ToggleRow label="Cartão de crédito" checked={pagarmeCard} onChange={setPagarmeCard} />
            </>
          )}
          {gateway === "veopag" && (
            <>
              <ToggleRow label="Pix" checked={veopagPix} onChange={setVeopagPix} />
              <ToggleRow label="Cartão de crédito" checked={veopagCard} onChange={setVeopagCard} />
            </>
          )}
          {gateway === "mangofy" && (
            <>
              <ToggleRow label="Pix" checked={mangofyPix} onChange={setMangofyPix} />
              <ToggleRow label="Cartão de crédito" checked={mangofyCard} onChange={setMangofyCard} />
            </>
          )}
          {gateway === "pagniv" && (
            <>
              <ToggleRow label="Pix" checked={pagnivPix} onChange={setPagnivPix} />
              <ToggleRow label="Cartão de crédito" checked={pagnivCard} onChange={setPagnivCard} />
            </>
          )}
          {gateway === "bluevision" && (
            <>
              <ToggleRow label="Pix" checked={bluevisionPix} onChange={setBluevisionPix} />
              <ToggleRow label="Cartão de crédito" checked={bluevisionCard} onChange={setBluevisionCard} />
            </>
          )}
          {gateway === "nuvra" && (
            <>
              <ToggleRow label="Pix" checked={nuvraPix} onChange={setNuvraPix} />
              <ToggleRow label="Cartão de crédito" checked={nuvraCard} onChange={setNuvraCard} />
            </>
          )}
          {gateway === "pixgo" && (
            <ToggleRow label="Pix" checked={pixgoPix} onChange={setPixgoPix} />
          )}
          {gateway === "mushpag" && (
            <>
              <ToggleRow label="Pix" checked={mushpagPix} onChange={setMushpagPix} />
              <ToggleRow label="Cartão" checked={false} disabled onChange={() => {}} />
            </>
          )}
          {gateway === "pushinpay" && (
            <>
              <ToggleRow label="Pix" checked={pushinpayPix} onChange={setPushinpayPix} />
              <ToggleRow label="Cartão" checked={false} disabled onChange={() => {}} />
            </>
          )}
          {gateway === "pagou" && (
            <>
              <ToggleRow label="Pix" checked={pagouPix} onChange={setPagouPix} />
              <ToggleRow
                label="Cartão de crédito"
                checked={pagouCard}
                onChange={setPagouCard}
              />
            </>
          )}
          {gateway === "mercadopago" && (
            <>
              <ToggleRow label="Pix" checked={mpPix} onChange={setMpPix} />
              <ToggleRow label="Cartão de crédito" checked={mpCard} onChange={setMpCard} />
            </>
          )}
          {gateway === "pinpay" && (
            <>
              <ToggleRow label="Pix" checked={pinpayPix} onChange={setPinpayPix} />
              <ToggleRow label="Cartão" checked={false} disabled onChange={() => {}} />
            </>
          )}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {gateway === "appmax" && (
            <div className="sm:col-span-2 space-y-4">
              {/* Credenciais do APP PARCEIRO desta loja (do painel de app da Appmax). */}
              <div>
                <div className="text-sm font-bold text-hi">App parceiro Appmax</div>
                <p className="mt-0.5 text-xs text-low">
                  No painel do app da Appmax, cole aqui os 3 valores do bloco Homologação e produção: o <b>UUID (ID público)</b>, o <b>Client ID</b> e o <b>Client Secret</b>. O ID numérico não é necessário. {appmaxPartnerSet ? "Já configurado nesta loja." : ""}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {/* Campos-isca ocultos: o Chrome joga o autofill de login aqui em vez dos reais. */}
                  <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ display: "none" }} readOnly />
                  <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{ display: "none" }} readOnly />
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-mid">UUID (ID público)</span>
                    <input className={input} value={appmaxAppId} onChange={(e) => setAppmaxAppId(e.target.value)} placeholder="ex.: 95b84ced-8faa-..." name="appmax_public_uuid" autoComplete="off" data-lpignore="true" data-1p-ignore />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-mid">Client ID</span>
                    <input className={input} value={appmaxPartnerClientId} onChange={(e) => setAppmaxPartnerClientId(e.target.value)} placeholder="ex.: 2348d25cb8184d..." name="appmax_client_id" autoComplete="off" data-lpignore="true" data-1p-ignore />
                  </div>
                  <div>
                    <span className="mb-1 block text-xs font-semibold text-mid">Client Secret</span>
                    <input type="password" className={input} value={appmaxPartnerSecret} onChange={(e) => setAppmaxPartnerSecret(e.target.value)} placeholder={appmaxPartnerSet ? "••••••••••••" : "client secret"} name="appmax_client_secret" autoComplete="new-password" data-lpignore="true" data-1p-ignore />
                    <span className="mt-1 block text-[11px] text-dim">A Appmax só mostra uma vez. Copie com cuidado.</span>
                  </div>
                </div>
              </div>

              <AppmaxUrls />

              {appmaxConnected ? (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Appmax conectada.
                  <button type="button" onClick={connectAppmax} disabled={connecting} className="ml-auto text-xs font-semibold text-emerald-700 underline disabled:opacity-50">
                    {connecting ? "..." : "Reconectar"}
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-mid">
                    Depois de salvar o app parceiro acima, clique em conectar: você autoriza no ambiente da Appmax e voltamos automaticamente (as credenciais do merchant vêm sozinhas).
                  </p>
                  <button type="button" onClick={connectAppmax} disabled={connecting} className="mt-2 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50">
                    {connecting ? "Conectando..." : "Conectar Appmax"}
                  </button>
                </div>
              )}
            </div>
          )}
          {gateway === "freepay" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={freepaySecretKey} onChange={(e) => setFreepaySecretKey(e.target.value)} placeholder={freepaySet ? "••••••••••••" : "secret key"} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input type="password" className={input} value={freepayPublic} onChange={(e) => setFreepayPublic(e.target.value)} placeholder={freepaySet ? "••••••••••••" : "public key"} autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "wappi" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={wappiSecretKey} onChange={(e) => setWappiSecretKey(e.target.value)} placeholder={wappiSet ? "••••••••••••" : "secret key"} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input type="password" className={input} value={wappiPublic} onChange={(e) => setWappiPublic(e.target.value)} placeholder={wappiSet ? "••••••••••••" : "public key"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testWappi}
                  disabled={wappiBusy || !wappiSet}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {wappiBusy ? "Testando..." : "Testar chave"}
                </button>
                {wappiMsg && (
                  <span className={`w-full break-words text-sm font-medium ${wappiMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {wappiMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "hypercash" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={hypercashSecret} onChange={(e) => setHypercashSecret(e.target.value)} placeholder={hypercashSet ? "••••••••••••" : "sua chave secreta"} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={hypercashPublicKey} onChange={(e) => setHypercashPublicKey(e.target.value)} placeholder="pk_live_..." autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "fintpag" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={fintpagSecret} onChange={(e) => setFintpagSecret(e.target.value)} placeholder={fintpagSet ? "••••••••••••" : "sk_..."} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={fintpagPublicKey} onChange={(e) => setFintpagPublicKey(e.target.value)} placeholder="pk_..." autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "hylexpay" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={hylexpaySecret} onChange={(e) => setHylexpaySecret(e.target.value)} placeholder={hylexpaySet ? "••••••••••••" : "sk_..."} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={hylexpayPublicKey} onChange={(e) => setHylexpayPublicKey(e.target.value)} placeholder="pk_..." autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "vext" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={vextApiKey} onChange={(e) => setVextApiKey(e.target.value)} placeholder={vextSet ? "••••••••••••" : "sk_live_..."} autoComplete="off" />
              </Field>
              <Field label="Webhook Secret">
                <input type="password" className={input} value={vextWebhookSecret} onChange={(e) => setVextWebhookSecret(e.target.value)} placeholder={vextWebhookSet ? "••••••••••••" : "opcional, mas recomendado"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testVext}
                  disabled={vextBusy || (!vextSet && !vextApiKey.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {vextBusy ? "Testando..." : "Testar chave"}
                </button>
                {vextMsg && (
                  <span className={`w-full break-words text-sm font-medium ${vextMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {vextMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "blackcat" && (
            <>
              <Field label="API Key">
                <input type="password" className={input} value={blackcatApiKey} onChange={(e) => setBlackcatApiKey(e.target.value)} placeholder={blackcatSet ? "••••••••••••" : "sua API Key"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testBlackcat}
                  disabled={blackcatBusy || (!blackcatSet && !blackcatApiKey.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {blackcatBusy ? "Testando..." : "Testar chave"}
                </button>
                {blackcatMsg && (
                  <span className={`w-full break-words text-sm font-medium ${blackcatMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {blackcatMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "pagarme" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={pagarmeSecret} onChange={(e) => setPagarmeSecret(e.target.value)} placeholder={pagarmeSet ? "••••••••••••" : "sk_..."} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testPagarme}
                  disabled={pagarmeBusy || (!pagarmeSet && !pagarmeSecret.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {pagarmeBusy ? "Testando..." : "Testar chave"}
                </button>
                {pagarmeMsg && (
                  <span className={`w-full break-words text-sm font-medium ${pagarmeMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {pagarmeMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "veopag" && (
            <>
              <Field label="Client ID">
                <input type="password" className={input} value={veopagClientId} onChange={(e) => setVeopagClientId(e.target.value)} placeholder={veopagSet ? "••••••••••••" : "client_id"} autoComplete="off" />
              </Field>
              <Field label="Client Secret">
                <input type="password" className={input} value={veopagClientSecret} onChange={(e) => setVeopagClientSecret(e.target.value)} placeholder={veopagSet ? "••••••••••••" : "client_secret"} autoComplete="off" />
              </Field>
              <Field label="Webhook Signature">
                <input type="password" className={input} value={veopagWebhookSecret} onChange={(e) => setVeopagWebhookSecret(e.target.value)} placeholder={veopagWebhookSet ? "••••••••••••" : "opcional, mas recomendada"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testVeopag}
                  disabled={veopagBusy || (!veopagSet && (!veopagClientId.trim() || !veopagClientSecret.trim()))}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {veopagBusy ? "Testando..." : "Testar credenciais"}
                </button>
                {veopagMsg && (
                  <span className={`w-full break-words text-sm font-medium ${veopagMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {veopagMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "mangofy" && (
            <>
              <Field label="API Key">
                <input type="password" className={input} value={mangofyApiKey} onChange={(e) => setMangofyApiKey(e.target.value)} placeholder={mangofySet ? "••••••••••••" : "sua API Key"} autoComplete="off" />
              </Field>
              <Field label="Store Code">
                <input className={input} value={mangofyStoreCode} onChange={(e) => setMangofyStoreCode(e.target.value)} placeholder="código da loja na MangoFy" autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testMangofy}
                  disabled={mangofyBusy || !mangofySet}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {mangofyBusy ? "Testando..." : "Testar credenciais"}
                </button>
                {mangofyMsg && (
                  <span className={`w-full break-words text-sm font-medium ${mangofyMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {mangofyMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "pagniv" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={pagnivApiKey} onChange={(e) => setPagnivApiKey(e.target.value)} placeholder={pagnivSet ? "••••••••••••" : "sk_live_..."} autoComplete="off" />
              </Field>
              <Field label="Webhook Secret">
                <input type="password" className={input} value={pagnivWebhookSecret} onChange={(e) => setPagnivWebhookSecret(e.target.value)} placeholder={pagnivWebhookSet ? "••••••••••••" : "opcional, mas recomendado"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testPagniv}
                  disabled={pagnivBusy || (!pagnivSet && !pagnivApiKey.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {pagnivBusy ? "Testando..." : "Testar chave"}
                </button>
                {pagnivMsg && (
                  <span className={`text-sm font-medium ${pagnivMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {pagnivMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "bluevision" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={bluevisionSecret} onChange={(e) => setBluevisionSecret(e.target.value)} placeholder={bluevisionSet ? "••••••••••••" : "sk_live_..."} autoComplete="off" />
              </Field>
              <Field label="Webhook Secret">
                <input type="password" className={input} value={bluevisionWebhookSecret} onChange={(e) => setBluevisionWebhookSecret(e.target.value)} placeholder={bluevisionWebhookSet ? "••••••••••••" : "opcional, mas recomendado"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testBluevision}
                  disabled={bluevisionBusy || (!bluevisionSet && !bluevisionSecret.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {bluevisionBusy ? "Testando..." : "Testar chave"}
                </button>
                {bluevisionMsg && (
                  <span className={`w-full break-words text-sm font-medium ${bluevisionMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {bluevisionMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "nuvra" && (
            <>
              <Field label="API Key">
                <input type="password" className={input} value={nuvraApiKey} onChange={(e) => setNuvraApiKey(e.target.value)} placeholder={nuvraSet ? "••••••••••••" : "nvr_live_..."} autoComplete="off" />
              </Field>
              <Field label="Webhook Secret">
                <input type="password" className={input} value={nuvraWebhookSecret} onChange={(e) => setNuvraWebhookSecret(e.target.value)} placeholder={nuvraWebhookSet ? "••••••••••••" : "opcional, mas recomendado"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testNuvra}
                  disabled={nuvraBusy || (!nuvraSet && !nuvraApiKey.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {nuvraBusy ? "Testando..." : "Testar chave"}
                </button>
                {nuvraMsg && (
                  <span className={`w-full break-words text-sm font-medium ${nuvraMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {nuvraMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "beehive" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={beehiveSecret} onChange={(e) => setBeehiveSecret(e.target.value)} placeholder={beehiveSet ? "••••••••••••" : "chave secreta da Beehive"} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={beehivePublicKey} onChange={(e) => setBeehivePublicKey(e.target.value)} placeholder="pk_live_..." autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testBeehive}
                  disabled={beehiveBusy || (!beehiveSet && !beehiveSecret.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {beehiveBusy ? "Testando..." : "Testar chave"}
                </button>
                {beehiveMsg && (
                  // `break-words` porque o detalhe do erro traz a resposta da
                  // API em cada formato testado — sem isso, estoura o card.
                  <span className={`w-full break-words text-sm font-medium ${beehiveMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {beehiveMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "pixgo" && (
            <>
              <Field label="API Key">
                <input type="password" className={input} value={pixgoApiKey} onChange={(e) => setPixgoApiKey(e.target.value)} placeholder={pixgoKeySet ? "••••••••••••" : "pk_..."} autoComplete="off" />
              </Field>
              <Field label="Webhook Secret">
                <input type="password" className={input} value={pixgoWebhook} onChange={(e) => setPixgoWebhook(e.target.value)} placeholder={pixgoWebhookSet ? "••••••••••••" : "whsec_..."} autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "mushpag" && (
            <>
              <Field label="API Key">
                <input type="password" className={input} value={mushpagApiKey} onChange={(e) => setMushpagApiKey(e.target.value)} placeholder={mushpagSet ? "••••••••••••" : "sua chave de API"} autoComplete="off" />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testMushpag}
                  disabled={mushpagBusy || !mushpagSet}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {mushpagBusy ? "Testando..." : "Testar chave e webhook"}
                </button>
                {mushpagMsg && (
                  <span className={`w-full break-words text-sm font-medium ${mushpagMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {mushpagMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "pushinpay" && (
            <>
              <Field label="Token de API">
                <input
                  type="password"
                  className={input}
                  value={pushinpayToken}
                  onChange={(e) => setPushinpayToken(e.target.value)}
                  placeholder={pushinpayTokenSet ? "••••••••••••" : "token da PushinPay"}
                  autoComplete="off"
                />
              </Field>
              <Field label="Token do webhook (opcional)">
                <input
                  type="password"
                  className={input}
                  value={pushinpayHook}
                  onChange={(e) => { setPushinpayHook(e.target.value); setPushinpayHookClear(false); }}
                  placeholder={pushinpayHookSet ? "••••••••••••" : "o mesmo token que você definiu na PushinPay"}
                  autoComplete="off"
                />
              </Field>
              {(pushinpayHookSet || pushinpayHookClear) && (
                <p className="sm:col-span-2 text-xs">
                  {pushinpayHookClear ? (
                    <span className="font-semibold text-red-600">Será removido ao salvar.</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setPushinpayHook(""); setPushinpayHookClear(true); }}
                      className="font-semibold text-red-600 underline"
                    >
                      Remover o token do webhook
                    </button>
                  )}
                </p>
              )}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={testPushinpay}
                  disabled={pushinpayBusy || (!pushinpayTokenSet && !pushinpayToken.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {pushinpayBusy ? "Testando..." : "Testar token"}
                </button>
                {pushinpayMsg && (
                  <span className={`text-sm font-medium ${pushinpayMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {pushinpayMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "pagou" && (
            <>
              <Field label="Token de API">
                <input
                  type="password"
                  className={input}
                  value={pagouToken}
                  onChange={(e) => setPagouToken(e.target.value)}
                  placeholder={pagouTokenSet ? "••••••••••••" : "token da Pagou"}
                  autoComplete="off"
                />
              </Field>
              <Field label="Public Key">
                <input
                  className={input}
                  value={pagouPublicKey}
                  onChange={(e) => setPagouPublicKey(e.target.value)}
                  placeholder="pk_test_... ou pk_live_..."
                  autoComplete="off"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <button
                  type="button"
                  onClick={testPagou}
                  disabled={pagouBusy || (!pagouTokenSet && !pagouToken.trim())}
                  className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
                >
                  {pagouBusy ? "Testando..." : "Testar token"}
                </button>
                {pagouMsg && (
                  <span className={`text-sm font-medium ${pagouMsg.ok ? "text-emerald-600" : "text-red-600"}`}>
                    {pagouMsg.text}
                  </span>
                )}
              </div>
            </>
          )}
          {gateway === "mercadopago" && (
            <>
              <Field label="Access Token">
                <input type="password" className={input} value={mpToken} onChange={(e) => setMpToken(e.target.value)} placeholder={mpTokenSet ? "••••••••••••" : "APP_USR-..."} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={mpPublicKey} onChange={(e) => setMpPublicKey(e.target.value)} placeholder="APP_USR-xxxx-xxxx-..." autoComplete="off" />
              </Field>
            </>
          )}
          {gateway === "pinpay" && (
            <>
              <Field label="Secret Key">
                <input type="password" className={input} value={pinpaySecret} onChange={(e) => setPinpaySecret(e.target.value)} placeholder={pinpaySecretSet ? "••••••••••••" : "sk_..."} autoComplete="off" />
              </Field>
              <Field label="Public Key">
                <input className={input} value={pinpayPublicKey} onChange={(e) => setPinpayPublicKey(e.target.value)} placeholder="pk_..." autoComplete="off" />
              </Field>
            </>
          )}
        </div>

        {gateway === "pinpay" && (
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            Cadastre o webhook abaixo no painel da PinPay.
          </p>
        )}

        {/* A Appmax tem o bloco completo de URLs acima (AppmaxUrls). */}
        {gateway !== "appmax" && (
          <code className="mt-4 block break-all rounded-lg bg-soft px-3 py-2 text-[12px] text-low ring-1 ring-line">
            Webhook: {origin}/api/webhooks/{gateway}
          </code>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
            {busy ? "Salvando..." : "Salvar configurações"}
          </button>
          {msg && <span className="text-sm text-mid">{msg}</span>}
        </div>
      </div>

      <p className="text-xs text-dim">
        As credenciais são criptografadas (AES-256-GCM) antes de irem ao banco e nunca são exibidas novamente.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-mid">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2 ${disabled ? "opacity-60" : ""}`}>
      <div className="min-w-0 text-sm font-bold text-hi">{label}</div>
      <button
        type="button"
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${checked ? "bg-brand" : "bg-gray-300 dark:bg-white/20"} ${disabled ? "cursor-not-allowed" : ""}`}
        aria-pressed={checked}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
