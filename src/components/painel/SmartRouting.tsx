"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import GatewayPicker from "@/components/painel/GatewayPicker";
import { IconeMetodo } from "@/components/painel/MetodoIcon";
import { GATEWAYS } from "@/lib/gateways";
import { MAX_GATEWAYS, MAX_RETENTATIVA, regraVazia, validarRegra, type Metodo, type RegraMetodo, type SmartRouting as SR } from "@/lib/smart-routing";

/**
 * Smart Routing — Pix e cartão têm regras SEPARADAS (abas). Em cada método há
 * dois modos, cada um com o seu toggle, e os dois podem ficar ligados juntos:
 *
 *  - Roteamento condicional: a partir de um valor, outro gateway. Nasceu da
 *    Beehive, que não gera Pix acima de R$ 500 — a venda morria sem aviso.
 *  - Distribuição automática: os pedidos são sorteados entre 2 a 4 gateways,
 *    na porcentagem digitada pelo lojista (precisa somar 100%).
 *
 * O Pix tem um terceiro, a Retentativa: se a cobrança não gerar, tenta o próximo
 * gateway da lista (app/api/checkout/pix). No cartão não existe: ver smart-routing.ts.
 *
 * Com os dois ligados, o condicional tem PRIORIDADE: o pedido que atinge o
 * valor vai para o gateway dele; abaixo do valor, vale a distribuição.
 *
 * Tudo é salvo junto em store_settings.smartRoutingJson; quem aplica é
 * lib/settings.ts → resolveOrderGateway (servidor) e, no cartão, o checkout
 * (lib/smart-routing.ts → escolherGatewayCartao), conferido pelo servidor.
 */

// Quem faz cartão DENTRO do checkout (lib/settings.ts → gatewayCanCard). A Pagou
// fica de fora: o cartão dela é um iframe que não dá para trocar no meio.
const FAZ_CARTAO = ["appmax", "freepay", "fintpag", "hylexpay", "hypercash", "beehive", "pagniv", "blackcat", "pagarme", "veopag", "mangofy", "nuvra", "bluevision", "wappi", "mercadopago"];
const TODOS = GATEWAYS.map((g) => g.key as string);
const nomeGateway = (k: string) => GATEWAYS.find((g) => g.key === k)?.name || k;

const METODOS: { id: Metodo; nome: string }[] = [
  { id: "pix", nome: "Pix" },
  { id: "cartao", nome: "Cartão" },
];

/** "1.234,56" -> 123456 centavos. Aceita o que o lojista digitar. */
function paraCentavos(texto: string): number {
  const limpo = texto.replace(/[^\d,.]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function paraTexto(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const ligado = (r: RegraMetodo) => r.condicional.ativo || r.distribuicao.ativo || !!r.retentativa?.ativo;

export default function SmartRouting() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [salvo, setSalvo] = useState<SR | null>(null);
  const [sr, setSr] = useState<SR>({ pix: regraVazia(), cartao: regraVazia() });
  // O valor do condicional é editado como texto ("1.234,56") e só vira
  // centavos ao sair do campo e ao salvar.
  const [valorTexto, setValorTexto] = useState<Record<Metodo, string>>({ pix: "", cartao: "" });
  const [aba, setAba] = useState<Metodo>("pix");
  const [principal, setPrincipal] = useState<Record<Metodo, string | null>>({ pix: null, cartao: null });
  const [prontos, setProntos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings: s } = await res.json();
        const inicial: SR = s.smartRouting ?? { pix: regraVazia(), cartao: regraVazia() };
        setSr(inicial);
        setSalvo(inicial);
        setValorTexto({ pix: paraTexto(inicial.pix.condicional.minCents), cartao: paraTexto(inicial.cartao.condicional.minCents) });
        setPrincipal({ pix: s.activePixProvider || null, cartao: s.activeCardProvider || null });
        setProntos(Array.isArray(s.gatewaysComCredencial) ? s.gatewaysComCredencial : []);
      } catch {
        /* silencioso: a seção some, o resto da página segue */
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  const mudar = (m: Metodo, f: (r: RegraMetodo) => RegraMetodo) => {
    setAviso(null);
    setSr((x) => ({ ...x, [m]: f(x[m]) }));
  };

  // Estado final (com o valor do condicional já em centavos) — o que vai salvar.
  const final = useMemo<SR>(
    () => ({
      pix: { ...sr.pix, condicional: { ...sr.pix.condicional, minCents: paraCentavos(valorTexto.pix) } },
      cartao: { ...sr.cartao, condicional: { ...sr.cartao.condicional, minCents: paraCentavos(valorTexto.cartao) } },
    }),
    [sr, valorTexto],
  );
  const sujo = !salvo || JSON.stringify(salvo) !== JSON.stringify(final);

  async function salvar() {
    const erro = validarRegra(final.pix, "Pix") ?? validarRegra(final.cartao, "Cartão");
    if (erro) {
      // Leva o lojista para a aba do problema.
      setAba(erro.startsWith("Cartão") ? "cartao" : "pix");
      return setAviso({ ok: false, texto: erro });
    }
    setBusy(true);
    setAviso(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ smartRouting: final }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setAviso({ ok: false, texto: data?.error ?? "Não foi possível salvar." });
      setSalvo(final);
      setValorTexto({ pix: paraTexto(final.pix.condicional.minCents), cartao: paraTexto(final.cartao.condicional.minCents) });
      setAviso({ ok: true, texto: "Smart Routing salvo." });
      router.refresh();
    } catch {
      setAviso({ ok: false, texto: "Erro de rede. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  if (carregando) return null;

  const r = sr[aba];
  const permitidos = aba === "pix" ? TODOS : FAZ_CARTAO;
  const nomeMetodo = aba === "pix" ? "Pix" : "cartão";
  const ambos = r.condicional.ativo && r.distribuicao.ativo;

  const toggleCondicional = () => mudar(aba, (x) => ({ ...x, condicional: { ...x.condicional, ativo: !x.condicional.ativo } }));
  const toggleDistribuicao = () =>
    mudar(aba, (x) => {
      const ativo = !x.distribuicao.ativo;
      // Ligar pela primeira vez já traz duas linhas 50/50.
      const fatias = ativo && x.distribuicao.fatias.length < 2 ? [{ g: "", p: 50 }, { g: "", p: 50 }] : x.distribuicao.fatias;
      return { ...x, distribuicao: { ativo, fatias } };
    });
  const toggleRetentativa = () =>
    mudar("pix", (x) => {
      const ativo = !x.retentativa?.ativo;
      // Ligar pela primeira vez já traz uma linha para escolher o gateway.
      const gateways = ativo && !x.retentativa?.gateways.length ? [""] : (x.retentativa?.gateways ?? []);
      return { ...x, retentativa: { ativo, gateways } };
    });

  return (
    <section aria-labelledby="sr-titulo" className="mt-6 rounded-2xl bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="sr-titulo" className="text-[16px] font-semibold text-hi">
            Smart Routing
          </h2>
          <p className="mt-1 text-[13px] text-low">Regras separadas para Pix e cartão. Os modos podem ficar ligados juntos.</p>
        </div>

        {/* Abas Pix / Cartão, com o estado de cada uma à vista. */}
        <div role="tablist" aria-label="Método de pagamento" className="flex rounded-xl bg-soft p-1">
          {METODOS.map((m) => {
            const on = aba === m.id;
            const ativo = salvo ? ligado(salvo[m.id]) : false;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setAba(m.id)}
                title={ativo ? `Smart Routing ligado no ${m.nome}` : `Smart Routing desligado no ${m.nome}`}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150 ${
                  on ? "bg-card text-hi shadow-panel" : "text-low hover:text-hi"
                }`}
              >
                {/* O ícone substitui a bolinha e mantém o que ela dizia: verde
                    com alguma regra ligada, cinza sem nenhuma. */}
                <IconeMetodo metodo={m.id} size={14} className={ativo ? "text-emerald-500" : "text-dim"} />
                {m.nome}
                <span className="sr-only">{ativo ? "(ligado)" : "(desligado)"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div key={aba} role="tabpanel" className="mt-5 animate-fade-up space-y-3">
        <Modo
          titulo="Roteamento condicional"
          texto={`A partir de um valor, o ${nomeMetodo} vai para outro gateway.`}
          ligado={r.condicional.ativo}
          onToggle={toggleCondicional}
          selo={ambos ? "Prioridade" : undefined}
          icone={<path d="M3.5 5h17l-6.5 7.5V19l-4-2v-4.5z" />}
        >
          <Condicional
            metodo={aba}
            regra={r}
            valorTexto={valorTexto[aba]}
            setValorTexto={(v) => {
              setAviso(null);
              setValorTexto((x) => ({ ...x, [aba]: v }));
            }}
            setGateway={(g) => mudar(aba, (x) => ({ ...x, condicional: { ...x.condicional, gateway: g } }))}
            principal={principal[aba]}
            permitidos={permitidos}
            prontos={prontos}
          />
        </Modo>

        {/* Com os dois ligados, a regra de prioridade fica escrita entre eles. */}
        {ambos && (
          <p className="flex items-start gap-2 rounded-lg bg-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-mid">
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-shrink-0 text-brand dark:text-brand-bright">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4.5M12 16h.01" />
            </svg>
            <span>
              Os dois estão ligados: pedidos de{" "}
              <b className="font-semibold text-hi">{valorTexto[aba] ? `R$ ${valorTexto[aba]}` : "o valor do condicional"} ou mais</b> vão para{" "}
              <b className="font-semibold text-hi">{r.condicional.gateway ? nomeGateway(r.condicional.gateway) : "o gateway do condicional"}</b>; abaixo disso, vale a
              distribuição.
            </span>
          </p>
        )}

        <Modo
          titulo="Distribuição automática"
          texto={`Divide os pedidos de ${nomeMetodo} entre até ${MAX_GATEWAYS} gateways, na porcentagem que você definir.`}
          ligado={r.distribuicao.ativo}
          onToggle={toggleDistribuicao}
          icone={
            <>
              <path d="M3 12h4c4.5 0 4.5-6 9-6h4M17 3l3 3-3 3" />
              <path d="M7 12c4.5 0 4.5 6 9 6h4M17 15l3 3-3 3" />
            </>
          }
        >
          <Distribuicao
            metodo={aba}
            regra={r}
            setFatias={(f) => mudar(aba, (x) => ({ ...x, distribuicao: { ...x.distribuicao, fatias: f } }))}
            permitidos={permitidos}
            prontos={prontos}
          />
        </Modo>

        {aba === "pix" && (
          <Modo
            titulo="Retentativa"
            texto="Se o Pix não gerar, tenta no próximo gateway da lista. O cliente recebe o código sem perceber a troca."
            ligado={!!r.retentativa?.ativo}
            onToggle={toggleRetentativa}
            icone={
              <>
                <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
                <path d="M20 4v4.5h-4.5" />
                <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
                <path d="M4 20v-4.5h4.5" />
              </>
            }
          >
            <Retentativa
              gateways={r.retentativa?.gateways ?? []}
              setGateways={(gateways) => mudar("pix", (x) => ({ ...x, retentativa: { ativo: true, gateways } }))}
              // Com outra regra ligada, o principal pode ser a reserva de quem saiu por ela.
              principal={r.condicional.ativo || r.distribuicao.ativo ? null : principal.pix}
              permitidos={permitidos}
              prontos={prontos}
            />
          </Modo>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button
          type="button"
          onClick={salvar}
          disabled={busy || !sujo}
          className="rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-white transition-[background-color,opacity] duration-150 hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
        {aviso ? (
          <span role="status" className={`text-[13px] font-medium ${aviso.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {aviso.texto}
          </span>
        ) : (
          sujo && <span className="text-[12.5px] text-low">Alterações não salvas (Pix e cartão salvam juntos).</span>
        )}
      </div>
    </section>
  );
}

/* ── Bloco de um modo: cabeçalho com toggle, conteúdo quando ligado ─────── */

function Modo({
  titulo,
  texto,
  ligado,
  onToggle,
  selo,
  icone,
  children,
}: {
  titulo: string;
  texto: string;
  ligado: boolean;
  onToggle: () => void;
  selo?: string;
  icone: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl ring-1 ring-inset transition-[box-shadow,background-color] duration-200 ${ligado ? "bg-brand/[0.04] ring-brand/35" : "bg-soft ring-transparent"}`}>
      <div className="flex items-center gap-3.5 p-4">
        <span
          aria-hidden
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${ligado ? "bg-brand text-white" : "bg-card text-low"}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            {icone}
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-hi">{titulo}</span>
            {selo && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand dark:text-brand-bright">{selo}</span>
            )}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-low">{texto}</span>
        </span>
        <Toggle ligado={ligado} onClick={onToggle} rotulo={titulo} />
      </div>
      {ligado && <div className="animate-fade-up border-t border-line px-4 pb-4 pt-4">{children}</div>}
    </div>
  );
}

function Toggle({ ligado, onClick, rotulo }: { ligado: boolean; onClick: () => void; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      onClick={onClick}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200 ease-fluid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
        ligado ? "bg-brand" : "bg-[var(--c-line-strong)]"
      }`}
    >
      <span
        aria-hidden
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-fluid ${
          ligado ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/* ── Roteamento condicional ─────────────────────────────────────────────── */

function Condicional({
  metodo,
  regra,
  valorTexto,
  setValorTexto,
  setGateway,
  principal,
  permitidos,
  prontos,
}: {
  metodo: Metodo;
  regra: RegraMetodo;
  valorTexto: string;
  setValorTexto: (v: string) => void;
  setGateway: (g: string) => void;
  principal: string | null;
  permitidos: string[];
  prontos: string[];
}) {
  const cents = paraCentavos(valorTexto);
  const destino = regra.condicional.gateway;
  const completo = cents > 0 && !!destino;
  const dist = regra.distribuicao.ativo;
  // Abaixo do valor: a distribuição (se ligada) ou o gateway principal.
  const abaixo = dist ? "Distribuição automática" : principal ? nomeGateway(principal) : "Gateway principal";
  // No cartão sem distribuição, a regra só vale com um principal de cartão inline.
  const semBase = metodo === "cartao" && !dist && (!principal || principal === "pagou");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-2 xl:gap-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <Campo rotulo={`Quando o ${metodo === "pix" ? "Pix" : "pedido"} for de`}>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-low">R$</span>
            <input
              value={valorTexto}
              onChange={(ev) => setValorTexto(ev.target.value)}
              onBlur={() => setValorTexto(paraTexto(paraCentavos(valorTexto)))}
              inputMode="decimal"
              placeholder="500,00"
              className={`${campo} h-10 pl-9 tabular-nums`}
            />
          </div>
          <span className="mt-1.5 block text-[12px] text-low">ou mais</span>
        </Campo>
        <div>
          <span className="mb-1.5 block text-[12.5px] font-medium text-mid">Usar o gateway</span>
          <GatewayPicker
            value={destino}
            onChange={setGateway}
            permitidos={permitidos}
            prontos={prontos}
            bloqueados={principal && !dist ? { [principal]: "já é o principal" } : {}}
            rotulo="Gateway do roteamento condicional"
          />
        </div>
      </div>

      <div className="rounded-xl bg-card p-3 ring-1 ring-inset ring-line">
        <Rota faixa={completo ? `Até R$ ${paraTexto(cents - 1)}` : "Abaixo do valor"} gateway={abaixo} nota={dist ? undefined : "principal"} />
        <Rota faixa={completo ? `R$ ${paraTexto(cents)} ou mais` : "A partir do valor"} gateway={destino ? nomeGateway(destino) : "—"} destaque />
        <p className="mt-2 px-1 text-[12px] leading-relaxed text-low">
          {semBase
            ? "Para valer no cartão, a loja precisa de um gateway principal de cartão ativo (que não seja a Pagou) ou da distribuição ligada."
            : "Se o gateway escolhido ficar sem credencial, a regra é ignorada e o pedido segue o fluxo normal, em vez de falhar."}
        </p>
      </div>
    </div>
  );
}

function Rota({ faixa, gateway, nota, destaque = false }: { faixa: string; gateway: string; nota?: string; destaque?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] ${destaque ? "bg-brand/[0.07]" : ""}`}>
      <span className="min-w-0 flex-1 truncate tabular-nums text-mid">{faixa}</span>
      <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-dim">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
      <span className={`min-w-0 truncate font-semibold ${destaque ? "text-brand dark:text-brand-bright" : "text-hi"}`}>{gateway}</span>
      {nota && <span className="flex-shrink-0 text-[11.5px] text-low">{nota}</span>}
    </div>
  );
}

/* ── Distribuição automática ────────────────────────────────────────────── */

function Distribuicao({
  metodo,
  regra,
  setFatias,
  permitidos,
  prontos,
}: {
  metodo: Metodo;
  regra: RegraMetodo;
  setFatias: (f: RegraMetodo["distribuicao"]["fatias"]) => void;
  permitidos: string[];
  prontos: string[];
}) {
  const fatias = regra.distribuicao.fatias;
  const soma = fatias.reduce((s, f) => s + (f.p || 0), 0);
  const fecha = soma === 100;

  const set = (i: number, p: Partial<{ g: string; p: number }>) => setFatias(fatias.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const remover = (i: number) => setFatias(fatias.filter((_, j) => j !== i));
  const adicionar = () => setFatias([...fatias, { g: "", p: Math.max(0, 100 - soma) }]);
  // Divide 100 em partes inteiras; a sobra vai para os primeiros (ex.: 34/33/33).
  const igualar = () => {
    const n = fatias.length;
    const base = Math.floor(100 / n);
    setFatias(fatias.map((f, i) => ({ ...f, p: base + (i < 100 - base * n ? 1 : 0) })));
  };

  return (
    <div>
      <div className="hidden grid-cols-[1.75rem_minmax(0,1fr)_7rem_2.25rem] gap-3 px-0.5 pb-2 text-[12px] font-medium text-low sm:grid">
        <span />
        <span>Gateway</span>
        <span>Porcentagem</span>
        <span />
      </div>
      <ol className="space-y-2">
        {fatias.map((f, i) => {
          const usados = Object.fromEntries(fatias.filter((o, j) => j !== i && o.g).map((o) => [o.g, "já está na lista"]));
          return (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_5.25rem_2.25rem] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_7rem_2.25rem] sm:gap-3">
              <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-card text-[12px] font-semibold tabular-nums text-mid ring-1 ring-inset ring-line sm:flex">
                {i + 1}
              </span>
              <GatewayPicker
                value={f.g}
                onChange={(g) => set(i, { g })}
                permitidos={permitidos}
                prontos={prontos}
                bloqueados={usados}
                rotulo={`Gateway ${i + 1} da distribuição`}
              />
              <div className="relative">
                <input
                  value={f.p ? String(f.p) : ""}
                  onChange={(ev) => {
                    const n = Number(ev.target.value.replace(/\D/g, "").slice(0, 3));
                    set(i, { p: Math.min(100, n) });
                  }}
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={`Porcentagem do gateway ${i + 1}`}
                  className={`${campo} h-10 pr-8 text-right tabular-nums`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-low">%</span>
              </div>
              {fatias.length > 2 ? (
                <button
                  type="button"
                  onClick={() => remover(i)}
                  aria-label={`Remover gateway ${i + 1}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-low transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {fatias.length < MAX_GATEWAYS ? (
            <button
              type="button"
              onClick={adicionar}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-mid transition-colors duration-150 hover:border-brand hover:text-brand dark:hover:text-brand-bright"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              Adicionar gateway
            </button>
          ) : (
            <span className="text-[12.5px] text-low">Máximo de {MAX_GATEWAYS} gateways.</span>
          )}
          <button type="button" onClick={igualar} className="rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-low transition-colors duration-150 hover:text-hi">
            Dividir igualmente
          </button>
        </div>
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums ring-1 ring-inset ${
            fecha
              ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
              : "bg-red-500/10 text-red-600 ring-red-500/20 dark:text-red-400"
          }`}
        >
          Total {soma}%
          {!fecha && <span className="font-medium">· {soma < 100 ? `faltam ${100 - soma}%` : `${soma - 100}% a mais`}</span>}
        </span>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-low">
        Cada pedido é sorteado na proporção definida. Se um gateway ficar sem credencial, ele sai do sorteio e os
        demais dividem os pedidos.
        {metodo === "cartao" && " A Pagou não entra na distribuição do cartão (o formulário dela é próprio)."}
      </p>
    </div>
  );
}

/* ── Retentativa (só Pix) ───────────────────────────────────────────────── */

function Retentativa({
  gateways,
  setGateways,
  principal,
  permitidos,
  prontos,
}: {
  gateways: string[];
  setGateways: (g: string[]) => void;
  principal: string | null;
  permitidos: string[];
  prontos: string[];
}) {
  return (
    <div>
      <span className="mb-2 block text-[12.5px] font-medium text-mid">Se falhar, tentar em</span>
      <ol className="space-y-2">
        {gateways.map((g, i) => {
          const bloqueados: Record<string, string> = Object.fromEntries(gateways.filter((o, j) => j !== i && o).map((o) => [o, "já está na lista"]));
          if (principal) bloqueados[principal] = "já é o principal";
          return (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_2.25rem] sm:gap-3">
              <span className="hidden h-7 w-7 items-center justify-center rounded-full bg-card text-[12px] font-semibold tabular-nums text-mid ring-1 ring-inset ring-line sm:flex">
                {i + 1}
              </span>
              <GatewayPicker
                value={g}
                onChange={(novo) => setGateways(gateways.map((o, j) => (j === i ? novo : o)))}
                permitidos={permitidos}
                prontos={prontos}
                bloqueados={bloqueados}
                rotulo={`Gateway ${i + 1} da retentativa`}
              />
              {gateways.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setGateways(gateways.filter((_, j) => j !== i))}
                  aria-label={`Remover gateway ${i + 1} da retentativa`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-low transition-colors duration-150 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ol>
      {gateways.length < MAX_RETENTATIVA && (
        <button
          type="button"
          onClick={() => setGateways([...gateways, ""])}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-mid transition-colors duration-150 hover:border-brand hover:text-brand dark:hover:text-brand-bright"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Adicionar gateway
        </button>
      )}
    </div>
  );
}

/* ── Peças ──────────────────────────────────────────────────────────────── */

const campo =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-[13.5px] text-hi outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-dim hover:border-line-strong focus:border-brand focus:ring-2 focus:ring-brand/20";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-mid">{rotulo}</span>
      {children}
    </label>
  );
}
