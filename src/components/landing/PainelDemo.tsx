"use client";

import React, { useEffect, useRef, useState } from "react";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";
import { Funnel, type FunnelStage } from "@/components/painel/dashboard/Viz";
import RecentOrders, { type RecentOrder } from "@/components/painel/dashboard/RecentOrders";
import { sections } from "@/components/painel/menu";
import { PERIODS } from "@/lib/painel-range";

/**
 * O painel da VOX dentro da landing, com dados de demonstração.
 *
 * Não é um desenho do painel: o funil, a lista de pedidos recentes e os
 * números animados SÃO os componentes da dashboard (components/painel/
 * dashboard), e o menu é o mesmo de components/painel/menu.tsx. O que está
 * copiado aqui é só o invólucro que, no painel, busca dados sozinho e por isso
 * não pode rodar na landing: a barra lateral (StoreSwitcher chama a API), o
 * topo, os cartões de indicador e o "Visitantes ao vivo" (LiveVisitors consulta
 * /api/painel/live a cada 5 s — na landing, um lojista logado veria os dados
 * da própria loja). A marcação desses pedaços segue a dos originais.
 *
 * Enquanto está na tela, um pedido de demonstração chega a cada ~4 s e soma nos
 * indicadores, como numa loja vendendo. Fora da tela, com a aba escondida ou
 * com movimento reduzido, fica parado. Nada aqui fala com o servidor.
 *
 * Tudo é desenhado numa "tela" de tamanho fixo (a largura em que o painel é
 * usado) e reduzido por transform para caber na janela — por isso os
 * breakpoints do Tailwind lá dentro seguem a largura da janela do navegador,
 * e a tela muda de tamanho junto com eles (ver .painel-demo no landing.css).
 */

const CLIENTES: [string, string][] = [
  ["Mariana Alves", "mariana.alves@email.com"],
  ["Rafael Souza", "rafael.souza@email.com"],
  ["Beatriz Lima", "bia.lima@email.com"],
  ["Lucas Ferreira", "lucas.ferreira@email.com"],
  ["Camila Rocha", "camila.rocha@email.com"],
  ["João Pedro Santos", "jp.santos@email.com"],
  ["Larissa Gomes", "lari.gomes@email.com"],
  ["Thiago Martins", "thiago.martins@email.com"],
  ["Fernanda Dias", "fe.dias@email.com"],
  ["Gustavo Ribeiro", "gu.ribeiro@email.com"],
  ["Juliana Castro", "ju.castro@email.com"],
  ["André Barbosa", "andre.barbosa@email.com"],
];
const VALORES = [18041, 24990, 13490, 32970, 9990, 18990, 45980, 15990, 27490, 11990, 21980, 16490];
const METODOS = ["PIX", "CREDIT_CARD", "PIX", "PIX", "CREDIT_CARD", "PIX", "CREDIT_CARD", "PIX"];

function pedido(i: number, quando: number, status: string): RecentOrder {
  const [name, email] = CLIENTES[i % CLIENTES.length];
  return {
    id: `demo-${i}`,
    status,
    paymentMethod: METODOS[i % METODOS.length],
    totalCents: VALORES[i % VALORES.length],
    createdAt: new Date(quando),
    name,
    email,
  };
}

type Estado = {
  pagoCents: number;
  pagos: number;
  pedidos: number;
  pendentes: number;
  /** Chegaram, dados, endereço, pagamento, comprou. */
  funil: [number, number, number, number, number];
  online: number;
  checkout: number;
  etapas: [number, number, number];
  recentes: RecentOrder[];
  seq: number;
};

/**
 * `base` é o `agora` que vem do servidor (prop): se cada lado usasse o próprio
 * Date.now(), o horário dos pedidos (que vai, com segundos, no title da linha)
 * sairia diferente no HTML e na hidratação.
 *
 * Os horários vão escritos por extenso, sem um atalho `minutos(m)`: o
 * minificador do build (SWC) embutia o atalho e a função no componente e
 * trocava o nome do parâmetro só na primeira ocorrência — o build quebrava
 * com "base is not defined".
 */
const MIN = 60_000;
function inicial(base: number): Estado {
  return {
    pagoCents: 1_843_270,
    pagos: 96,
    pedidos: 128,
    pendentes: 32,
    funil: [418, 291, 236, 171, 96],
    online: 46,
    checkout: 13,
    etapas: [5, 4, 4],
    recentes: [
      pedido(0, base - 3 * MIN, "PAID"),
      pedido(1, base - 9 * MIN, "PAID"),
      pedido(2, base - 14 * MIN, "PENDING"),
      pedido(3, base - 22 * MIN, "PAID"),
      pedido(4, base - 31 * MIN, "PAID"),
    ],
    seq: 5,
  };
}

const sorteio = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const entre = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Um pedido novo: de cada quatro, um fica no Pix gerado e não pago. */
function avancar(e: Estado): Estado {
  const pendente = e.seq % 4 === 3;
  const novo = pedido(e.seq, Date.now(), pendente ? "PENDING" : "PAID");
  const checkout = entre(e.checkout + sorteio(-2, 2), 9, 17);
  const dados = sorteio(2, Math.max(2, checkout - 6));
  const endereco = sorteio(1, Math.max(1, checkout - dados - 3));
  return {
    pagoCents: e.pagoCents + (pendente ? 0 : novo.totalCents),
    pagos: e.pagos + (pendente ? 0 : 1),
    pedidos: e.pedidos + 1,
    pendentes: e.pendentes + (pendente ? 1 : 0),
    funil: [e.funil[0] + sorteio(2, 4), e.funil[1] + sorteio(1, 2), e.funil[2] + 1, e.funil[3] + 1, e.funil[4] + (pendente ? 0 : 1)],
    online: entre(e.online + sorteio(-3, 3), 38, 58),
    checkout,
    etapas: [dados, endereco, Math.max(1, checkout - dados - endereco)],
    recentes: [novo, ...e.recentes].slice(0, 5),
    seq: e.seq + 1,
  };
}

const INTERVALO_MS = 4200;

export default function PainelDemo({ agora }: { agora: number }) {
  const [e, setE] = useState<Estado>(() => inicial(agora));
  const raiz = useRef<HTMLElement>(null);
  const tela = useRef<HTMLDivElement>(null);

  // Escala da tela fixa para a largura da janela.
  useEffect(() => {
    const t = tela.current;
    const r = raiz.current;
    if (!t || !r) return;
    const medir = () => {
      const largura = Number(getComputedStyle(r).getPropertyValue("--canvas-w")) || 1240;
      r.style.setProperty("--escala", String(t.clientWidth / largura));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(t);
    return () => ro.disconnect();
  }, []);

  // Pedidos chegando: só com o painel na tela e a aba visível.
  useEffect(() => {
    const r = raiz.current;
    if (!r || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let visivel = false;
    let primeiro: number | undefined;
    let ciclo: number | undefined;
    const parar = () => {
      window.clearTimeout(primeiro);
      window.clearInterval(ciclo);
      primeiro = ciclo = undefined;
    };
    const ligar = () => {
      if (ciclo || primeiro || !visivel || document.visibilityState !== "visible") return;
      // O primeiro chega logo, para quem acabou de abrir a página ver o
      // painel se mexer; depois, no ritmo de uma loja vendendo.
      primeiro = window.setTimeout(() => {
        primeiro = undefined;
        setE(avancar);
        ciclo = window.setInterval(() => setE(avancar), INTERVALO_MS);
      }, 1400);
    };
    const io = new IntersectionObserver(([entrada]) => {
      visivel = entrada.isIntersecting;
      if (visivel) ligar();
      else parar();
    });
    io.observe(r);
    const aba = () => (document.visibilityState === "visible" ? ligar() : parar());
    document.addEventListener("visibilitychange", aba);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", aba);
      parar();
    };
  }, []);

  const conversao = e.funil[0] > 0 ? (e.funil[4] / e.funil[0]) * 100 : 0;
  const funil: FunnelStage[] = [
    { label: "Chegaram no checkout", short: "Checkout", value: e.funil[0] },
    { label: "Dados pessoais", short: "Dados", value: e.funil[1] },
    { label: "Endereço", short: "Endereço", value: e.funil[2] },
    { label: "Pagamento", short: "Pagamento", value: e.funil[3] },
    { label: "Comprou", short: "Compra", value: e.funil[4], done: true },
  ];
  const parte = (n: number, de: number) => (de > 0 ? Math.round((n / de) * 100) : 0);

  return (
    <figure className="painel-demo" ref={raiz}>
      <div
        className="janela"
        role="img"
        aria-label="Painel da VOX com dados de demonstração: vendas pagas, pedidos, ticket médio, taxa de conversão, visitantes ao vivo, funil do checkout e pedidos recentes."
      >
        <div className="janela-barra" aria-hidden>
          <span className="janela-pontos">
            <i />
            <i />
            <i />
          </span>
          <span className="janela-url">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z" />
              <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
            </svg>
            vox.black/painel
          </span>
        </div>
        <div className="janela-tela" ref={tela}>
          <div className="painel-canvas panel-root" inert>
            <div className="flex h-full bg-app text-mid antialiased">
              <BarraLateral />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopoCelular />
                <TopoComputador />
                <main className="min-w-0 flex-1 overflow-hidden">
                  <div className="w-full px-4 pb-14 pt-6 sm:px-6 md:px-8 md:pt-7">
                    <div className="space-y-4">
                      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-2">
                        <div className="min-w-0">
                          <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dashboard</h1>
                          <p className="mt-1 truncate text-[13px] text-low">
                            <span className="font-medium text-mid">Noma Studio</span>
                            <span aria-hidden className="mx-1.5 text-dim">·</span>
                            Hoje
                          </p>
                        </div>
                        <Periodo />
                      </header>

                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <Kpi
                          label="Vendas pagas"
                          value={<AnimatedNumber value={e.pagoCents} format="brl" display />}
                          note={`${e.pagos} pedidos pagos`}
                        />
                        <Kpi label="Pedidos" seta value={<AnimatedNumber value={e.pedidos} />} note={`${e.pendentes} pendentes`} />
                        <Kpi
                          label="Ticket médio"
                          value={<AnimatedNumber value={Math.round(e.pagoCents / Math.max(1, e.pagos))} format="brl" display />}
                          note="por venda paga"
                        />
                        <Kpi
                          label="Taxa de conversão"
                          value={<AnimatedNumber value={conversao} format="pct" />}
                          note={`de ${e.funil[0]} no checkout`}
                        />
                      </div>

                      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                        <AoVivo online={e.online} checkout={e.checkout} etapas={e.etapas} parte={parte} />
                        <Cartao titulo="Funil do checkout" subtitulo="Até onde foi quem chegou ao checkout">
                          <Funnel stages={funil} />
                        </Cartao>
                      </div>

                      <RecentOrders orders={e.recentes} />
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
      </div>
      <figcaption>Painel da VOX com dados de demonstração. Enquanto você olha, novos pedidos chegam a cada poucos segundos.</figcaption>
    </figure>
  );
}

/* ── Invólucro do painel (marcação de components/painel/Sidebar.tsx) ── */

function BarraLateral() {
  return (
    <aside className="hidden w-[252px] flex-shrink-0 flex-col bg-card md:flex">
      <div className="flex items-center justify-center px-5 pb-4 pt-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vox-logo.png" alt="" width={66} height={36} className="h-9 w-auto shrink-0 select-none" draggable={false} />
      </div>
      <div className="px-3 pb-2">
        <div className="flex items-center gap-1.5 px-1 pb-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-bright" />
          <span className="text-[12px] font-medium text-low">Loja ativa</span>
        </div>
        <div className="flex w-full items-center gap-2.5 rounded-xl border border-line bg-card px-2.5 py-2">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand/15 text-[10.5px] font-bold text-brand">NS</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-hi">Noma Studio</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-dim">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </div>
      <nav className="flex-1 overflow-hidden px-3 pb-4">
        {sections.map((section) => (
          <div key={section.title} className={section.solto ? "pt-3" : ""}>
            {/* Seção solta (o botão Configurações) não tem título, como no painel. */}
            {!section.solto && <div className="px-3 pb-1.5 pt-4 text-[12px] font-medium text-low">{section.title}</div>}
            <div className="space-y-[2px]">
              {section.items.map((item) => {
                const ativo = "href" in item && item.href === "/painel";
                return (
                  <div
                    key={item.label}
                    className={`relative flex items-center gap-2.5 rounded-lg px-3 py-[7px] text-[13px] ${ativo ? "bg-hover font-medium text-hi" : "text-mid"}`}
                  >
                    {ativo && <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-r-full bg-brand-bright" />}
                    <span className={ativo ? "text-brand-bright" : "text-low"}>{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {"children" in item && (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-dim">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function BotaoTema() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-low">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </span>
  );
}

/** Barra do topo no celular (Sidebar.tsx, abaixo de lg no painel). */
function TopoCelular() {
  return (
    <div className="relative flex items-center justify-between border-b border-line bg-card/95 px-4 py-2 md:hidden">
      <span className="rounded-lg p-1.5 text-mid">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </span>
      <span className="absolute left-1/2 -translate-x-1/2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vox-logo.png" alt="" width={59} height={32} className="h-8 w-auto" draggable={false} />
      </span>
      <BotaoTema />
    </div>
  );
}

/** Topbar.tsx: trilha à esquerda, tema e conta à direita. */
function TopoComputador() {
  return (
    <header className="hidden border-b border-line bg-app/80 md:block">
      <div className="flex h-14 items-center justify-between gap-4 px-8">
        <nav className="flex min-w-0 items-center gap-1.5 text-[13px]">
          <span className="shrink-0 text-low">Painel</span>
          <span className="shrink-0 text-dim">/</span>
          <span className="truncate font-medium text-hi">Dashboard</span>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <BotaoTema />
          <div className="flex items-center gap-2.5 rounded-full border border-line bg-hover py-1 pl-1 pr-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-bright to-brand-hover text-[11px] font-bold text-white">AR</span>
            <span className="max-w-[180px] truncate text-[12.5px] font-medium text-mid">Ana Ribeiro</span>
          </div>
        </div>
      </div>
    </header>
  );
}

/** PeriodControl.tsx parado em "Hoje", com o botão do calendário ao lado. */
function Periodo() {
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="min-w-0 flex-1 overflow-hidden rounded-xl bg-card p-1 sm:flex-none">
        <div className="flex w-max">
          {PERIODS.map((p) => (
            <span
              key={p.key}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-medium leading-5 ${p.key === "today" ? "bg-brand text-white" : "text-low"}`}
            >
              {p.label}
            </span>
          ))}
        </div>
      </div>
      <span className="flex h-10 items-center gap-1.5 whitespace-nowrap rounded-xl bg-card px-3 text-[12.5px] font-medium text-low sm:px-3.5">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
        <span className="hidden sm:inline">Personalizar</span>
      </span>
    </div>
  );
}

/* ── Cartões (marcação de DashboardView.tsx → Kpi e Card) ── */

function Kpi({ label, value, note, seta = false }: { label: string; value: React.ReactNode; note: string; seta?: boolean }) {
  return (
    <div className="block min-w-0 rounded-2xl bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-low">{label}</span>
        {seta && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim">
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </div>
      <div className="mt-3 whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.025em] text-hi xl:text-[26px]">{value}</div>
      <div className="mt-2.5 truncate text-[12.5px] text-low">{note}</div>
    </div>
  );
}

function Cartao({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-2xl bg-card p-5">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-hi">{titulo}</h2>
        {subtitulo && <p className="mt-0.5 text-[12.5px] text-low">{subtitulo}</p>}
      </div>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </section>
  );
}

/* ── Visitantes ao vivo (marcação de LiveVisitors.tsx, sem a consulta) ── */

function AoVivo({
  online,
  checkout,
  etapas,
  parte,
}: {
  online: number;
  checkout: number;
  etapas: [number, number, number];
  parte: (n: number, de: number) => number;
}) {
  const loja = online - checkout;
  return (
    <section className="flex min-w-0 flex-col rounded-2xl bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-hi">Visitantes ao vivo</h2>
          <p className="mt-0.5 text-[12.5px] text-low">Atualiza a cada 5 segundos</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-low">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Agora
        </span>
      </div>
      <div className="mt-5 flex flex-1 flex-col justify-around gap-6">
        <div>
          <h3 className="text-[12.5px] font-medium text-low">Agora na loja</h3>
          <dl className="mt-2.5 grid grid-cols-3 gap-2">
            <Figura label="Online" value={online} />
            <Figura label="Na loja" value={loja} share={parte(loja, online)} />
            <Figura label="No checkout" value={checkout} share={parte(checkout, online)} />
          </dl>
        </div>
        <div className="border-t border-line pt-5">
          <h3 className="text-[12.5px] font-medium text-low">No checkout agora</h3>
          <dl className="mt-2.5 grid grid-cols-3 gap-2">
            <Figura label="Dados" value={etapas[0]} share={parte(etapas[0], checkout)} />
            <Figura label="Endereço" value={etapas[1]} share={parte(etapas[1], checkout)} />
            <Figura label="Pagamento" value={etapas[2]} share={parte(etapas[2], checkout)} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Figura({ label, value, share }: { label: string; value: number; share?: number }) {
  return (
    <div className="min-w-0">
      <dt className="whitespace-nowrap text-[12px] text-low">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-hi">
          <AnimatedNumber value={value} />
        </span>
        {share != null && <span className="text-[12px] tabular-nums text-low">{share}%</span>}
      </dd>
    </div>
  );
}
