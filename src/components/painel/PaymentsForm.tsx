"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { GATEWAYS, type GatewayKey, type GatewayMeta } from "@/lib/gateways";
import GatewayLogo from "@/components/painel/GatewayLogo";
import { IconeMetodo } from "@/components/painel/MetodoIcon";

type Metodo = "Pix" | "Cartão";

// O que cada gateway SABE processar (espelha as chaves que o status lê abaixo).
// Record<GatewayKey, ...> pelo mesmo motivo do status: gateway novo sem linha
// aqui reprova o build em vez de sumir da grade.
const SUPORTE: Record<GatewayKey, Metodo[]> = {
  appmax: ["Pix", "Cartão"],
  freepay: ["Pix", "Cartão"],
  hypercash: ["Pix", "Cartão"],
  fintpag: ["Pix", "Cartão"],
  hylexpay: ["Pix", "Cartão"],
  beehive: ["Pix", "Cartão"],
  pagniv: ["Pix", "Cartão"],
  vext: ["Pix"],
  blackcat: ["Pix", "Cartão"],
  pagarme: ["Pix", "Cartão"],
  veopag: ["Pix", "Cartão"],
  mangofy: ["Pix", "Cartão"],
  nuvra: ["Pix", "Cartão"],
  bluevision: ["Pix", "Cartão"],
  pixgo: ["Pix"],
  mushpag: ["Pix"],
  pushinpay: ["Pix"],
  pagou: ["Pix", "Cartão"],
  wappi: ["Pix", "Cartão"],
  mercadopago: ["Pix", "Cartão"],
  pinpay: ["Pix"],
};

const COR: Record<Metodo, string> = { Pix: "var(--viz-pix)", Cartão: "var(--viz-card)" };

// Grade dos gateways de pagamento da LOJA ATIVA. Cada card leva para a página de
// configuração daquele gateway. As credenciais NUNCA voltam do servidor — só o
// indicador de "configurado" e os métodos ativos.
//
// Os conectados ficam num grupo à parte: é com eles que o lojista trabalha, e
// separá-los dispensa o selo "Configurado"/"Instalar" repetido em cada card.
export default function PaymentsForm() {
  const [s, setS] = useState<Record<string, unknown> | null>(null);
  // Falha na leitura precisa APARECER: antes ela era engolida e a grade ficava
  // nos blocos de carregamento para sempre, sem dizer que algo deu errado.
  const [falhou, setFalhou] = useState(false);

  async function carregar() {
    setFalhou(false);
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (!res.ok) return setFalhou(true);
      const { settings } = await res.json();
      setS(settings);
    } catch {
      setFalhou(true);
    }
  }

  useEffect(() => {
    void carregar();
  }, []);

  const b = (k: string) => Boolean(s?.[k]);
  // Quem processa AGORA — calculado no servidor (getPaymentRouting), para a
  // ordem de prioridade não ser reescrita aqui e as duas versões divergirem.
  const activePix = typeof s?.activePixProvider === "string" ? s.activePixProvider : null;
  const activeCard = typeof s?.activeCardProvider === "string" ? s.activeCardProvider : null;
  const nomeDoGateway = (k: string | null) => (k ? (GATEWAYS.find((g) => g.key === k)?.name ?? k) : null);
  // O Smart Routing muda quem processa — a faixa precisa dizer isso, senão ela
  // mostra só o principal e o lojista não entende por que a venda saiu em outro.
  const sr = s?.smartRouting as
    | Record<"pix" | "cartao", { condicional: { ativo: boolean; minCents: number; gateway: string }; distribuicao: { ativo: boolean; fatias: { g: string }[] } }>
    | undefined;
  const rotulo = (metodo: "pix" | "cartao", principal: string | null) => {
    const r = sr?.[metodo];
    const dist = r?.distribuicao.ativo && r.distribuicao.fatias.length >= 2;
    const base = dist ? `distribuído entre ${r!.distribuicao.fatias.length} gateways` : nomeDoGateway(principal);
    if (r?.condicional.ativo && r.condicional.gateway) {
      const reais = (r.condicional.minCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      return `${base ?? "principal"} · a partir de ${reais}, ${nomeDoGateway(r.condicional.gateway)}`;
    }
    return base;
  };
  // Record<GatewayKey, ...> de propósito: se um gateway novo entrar em GATEWAYS
  // e esquecerem de descrevê-lo aqui, o TypeScript reprova o build. Com
  // Record<string, ...> o esquecimento passava batido e a página inteira
  // quebrava no navegador ao ler `.configured` de undefined.
  const status: Record<GatewayKey, { configured: boolean; methods: string[] }> = {
    appmax: { configured: b("appmaxConfigured"), methods: [b("appmaxPixEnabled") && "Pix", b("appmaxCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    freepay: { configured: b("freepayConfigured"), methods: [b("freepayPixEnabled") && "Pix", b("freepayCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    hypercash: { configured: b("hypercashConfigured"), methods: [b("hypercashPixEnabled") && "Pix", b("hypercashCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    fintpag: { configured: b("fintpagConfigured"), methods: [b("fintpagPixEnabled") && "Pix", b("fintpagCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    hylexpay: { configured: b("hylexpayConfigured"), methods: [b("hylexpayPixEnabled") && "Pix", b("hylexpayCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    beehive: { configured: b("beehiveConfigured"), methods: [b("beehivePixEnabled") && "Pix", b("beehiveCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    pagniv: { configured: b("pagnivConfigured"), methods: [b("pagnivPixEnabled") && "Pix", b("pagnivCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    vext: { configured: b("vextConfigured"), methods: [b("vextPixEnabled") && "Pix"].filter(Boolean) as string[] },
    blackcat: { configured: b("blackcatConfigured"), methods: [b("blackcatPixEnabled") && "Pix", b("blackcatCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    pagarme: { configured: b("pagarmeConfigured"), methods: [b("pagarmePixEnabled") && "Pix", b("pagarmeCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    veopag: { configured: b("veopagConfigured"), methods: [b("veopagPixEnabled") && "Pix", b("veopagCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    mangofy: { configured: b("mangofyConfigured"), methods: [b("mangofyPixEnabled") && "Pix", b("mangofyCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    nuvra: { configured: b("nuvraConfigured"), methods: [b("nuvraPixEnabled") && "Pix", b("nuvraCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    bluevision: { configured: b("bluevisionConfigured"), methods: [b("bluevisionPixEnabled") && "Pix", b("bluevisionCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    pixgo: { configured: b("pixgoConfigured"), methods: [b("pixgoPixEnabled") && "Pix"].filter(Boolean) as string[] },
    mushpag: { configured: b("mushpagConfigured"), methods: [b("mushpagPixEnabled") && "Pix"].filter(Boolean) as string[] },
    pushinpay: { configured: b("pushinpayConfigured"), methods: [b("pushinpayPixEnabled") && "Pix"].filter(Boolean) as string[] },
    pagou: { configured: b("pagouConfigured"), methods: [b("pagouPixEnabled") && "Pix", b("pagouCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    wappi: { configured: b("wappiConfigured"), methods: [b("wappiPixEnabled") && "Pix", b("wappiCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    mercadopago: { configured: b("mpAccessTokenConfigured"), methods: [b("mpPixEnabled") && "Pix", b("mpCardEnabled") && "Cartão"].filter(Boolean) as string[] },
    pinpay: { configured: b("pinpaySecretConfigured"), methods: [b("pinpayPixEnabled") && "Pix"].filter(Boolean) as string[] },
  };

  const pixCount = Number(b("mpPixEnabled")) + Number(b("pinpayPixEnabled")) + Number(b("appmaxPixEnabled")) + Number(b("freepayPixEnabled")) + Number(b("hypercashPixEnabled")) + Number(b("fintpagPixEnabled")) + Number(b("hylexpayPixEnabled")) + Number(b("beehivePixEnabled")) + Number(b("pagnivPixEnabled")) + Number(b("vextPixEnabled")) + Number(b("blackcatPixEnabled")) + Number(b("pagarmePixEnabled")) + Number(b("veopagPixEnabled")) + Number(b("mangofyPixEnabled")) + Number(b("nuvraPixEnabled")) + Number(b("bluevisionPixEnabled")) + Number(b("pixgoPixEnabled")) + Number(b("mushpagPixEnabled")) + Number(b("pagouPixEnabled")) + Number(b("pushinpayPixEnabled")) + Number(b("wappiPixEnabled"));
  const cardCount = Number(b("appmaxCardEnabled")) + Number(b("freepayCardEnabled")) + Number(b("mpCardEnabled")) + Number(b("hypercashCardEnabled")) + Number(b("fintpagCardEnabled")) + Number(b("hylexpayCardEnabled")) + Number(b("beehiveCardEnabled")) + Number(b("pagnivCardEnabled")) + Number(b("blackcatCardEnabled")) + Number(b("pagarmeCardEnabled")) + Number(b("veopagCardEnabled")) + Number(b("mangofyCardEnabled")) + Number(b("nuvraCardEnabled")) + Number(b("bluevisionCardEnabled")) + Number(b("pagouCardEnabled")) + Number(b("wappiCardEnabled"));

  // Até as configurações chegarem não dá para saber quem está conectado:
  // montar a grade antes faria os cards pularem de grupo na frente do lojista.
  if (s === null && falhou) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-5 py-4 text-sm">
        <span className="text-mid">Não foi possível carregar os gateways da loja.</span>
        <button
          type="button"
          onClick={() => void carregar()}
          className="rounded-lg border border-line px-3 py-1.5 font-semibold text-mid transition hover:bg-hover"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  if (s === null) {
    return (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[72px] rounded-2xl bg-card" />
        ))}
      </div>
    );
  }

  const conectados = GATEWAYS.filter((g) => status[g.key]?.configured);
  const outros = GATEWAYS.filter((g) => !status[g.key]?.configured);

  return (
    <div className="space-y-9">
      {/* QUEM ESTÁ PROCESSANDO AGORA.
          Com dois gateways ligados no mesmo método, vence o primeiro de uma
          ordem fixa no código — e sem isto escrito na tela, ligar um gateway
          novo e ver a venda sair por outro parece integração quebrada. */}
      <section aria-label="Processando agora" className="rounded-2xl bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]">
          <span className="font-medium text-low">Processando agora</span>
          <Rota metodo="Pix" nome={rotulo("pix", activePix)} />
          <Rota metodo="Cartão" nome={rotulo("cartao", activeCard)} />
        </div>
        {(pixCount > 1 || cardCount > 1) && (
          <div className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-low">
            <p>
              Você tem {pixCount > 1 ? `${pixCount} gateways com Pix` : ""}
              {pixCount > 1 && cardCount > 1 ? " e " : ""}
              {cardCount > 1 ? `${cardCount} com cartão` : ""} ligado{pixCount > 1 && cardCount > 1 ? "s" : ""}. Só um
              processa de cada vez — os demais ficam de reserva. Para trocar, desligue o que está em uso, ou use o{" "}
              <b className="font-semibold text-mid">Smart Routing</b> para distribuir entre eles.
            </p>
            {pixCount > 1 && (
              <p>
                Prioridade do Pix: <b className="font-semibold text-mid">Mercado Pago → PinPay → Appmax → Freepay → HyperCash → FintPag → HylexPay → Beehive → PagNiv → Vext → BlackCat → Pagar.me → VeoPag → MangoFy → Nuvra → Blue Vision → PixGo → MushPag → Pagou → PushinPay → Wappi</b>.
              </p>
            )}
            {cardCount > 1 && (
              <p>
                Prioridade do cartão: <b className="font-semibold text-mid">Appmax → Freepay → FintPag → HylexPay → HyperCash → Beehive → PagNiv → BlackCat → Pagar.me → VeoPag → MangoFy → Nuvra → Blue Vision → Pagou → Wappi → Mercado Pago</b>.
              </p>
            )}
          </div>
        )}
      </section>

      {conectados.length > 0 && (
        <Grupo titulo="Conectados">
          {conectados.map((g) => (
            <Card key={g.key} gateway={g} href={`/painel/pagamentos/${g.key}`}>
              {SUPORTE[g.key].map((m) => {
                const on = status[g.key].methods.includes(m);
                return (
                  <span key={m} className="flex items-center gap-1.5">
                    {/* Ícone na cor do método quando ativo; cinza quando desligado. */}
                    <IconeMetodo metodo={m} size={13} className={on ? "" : "text-dim"} style={on ? { color: COR[m] } : undefined} />
                    <span className={on ? "text-mid" : "text-low"}>
                      {m} {on ? "ativo" : "desligado"}
                    </span>
                  </span>
                );
              })}
            </Card>
          ))}
        </Grupo>
      )}

      <Grupo titulo={conectados.length > 0 ? "Outros gateways" : "Gateways"}>
        {outros.map((g) => (
          <Card key={g.key} gateway={g} href={`/painel/pagamentos/${g.key}`}>
            <span className="text-low">{suporteTexto(SUPORTE[g.key])}</span>
          </Card>
        ))}
      </Grupo>
    </div>
  );
}

function suporteTexto(m: Metodo[]) {
  if (m.length > 1) return "Pix e cartão";
  return m[0] === "Pix" ? "Só Pix" : "Só cartão";
}

function Rota({ metodo, nome }: { metodo: Metodo; nome: string | null }) {
  return (
    <span className="flex items-center gap-2">
      <IconeMetodo metodo={metodo} size={14} style={{ color: COR[metodo] }} />
      <span className="text-low">{metodo}</span>
      {nome ? (
        <b className="font-semibold text-hi">{nome}</b>
      ) : (
        <b className="font-semibold text-amber-700 dark:text-amber-300">nenhum ativo</b>
      )}
    </span>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold text-hi">{titulo}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

// Card de altura FIXA: logo, nome e uma linha de métodos, sempre as mesmas três
// peças. Antes o card de quem tinha métodos ativos ganhava uma linha a mais e
// esticava a fileira inteira.
function Card({ gateway, href, children }: { gateway: GatewayMeta; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex h-[72px] items-center gap-3.5 rounded-2xl bg-card px-4 transition-colors duration-150 hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <GatewayLogo gateway={gateway} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-hi">{gateway.name}</span>
        <span className="mt-0.5 flex items-center gap-x-3 overflow-hidden whitespace-nowrap text-[12.5px]">{children}</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-dim transition duration-150 ease-fluid group-hover:translate-x-0.5 group-hover:text-mid">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </Link>
  );
}
