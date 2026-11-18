"use client";

import { useEffect, useState } from "react";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";

type Live = {
  online: number;
  loja: number;
  checkout: number;
  funnel: { dados: number; endereco: number; pagamento: number; comprou: number };
  states: { name: string; count: number }[];
  cities: { name: string; count: number }[];
  visitors: { city: string | null; state: string | null; scope: string; step: number }[];
};

// Quem está na loja AGORA. Atualiza a cada 5s; os números deslizam de uma
// batida para a outra em vez de trocar num estalo.
//
// Sem ponto piscando: "ao vivo" é dito uma vez, em texto. Um indicador em loop
// disputa o olho com os números o tempo todo e não informa nada a mais.
// `variant="strip"`: faixa compacta do topo do dashboard (seção "Agora"), com
// os mesmos seis números e porcentagens do cartão, lado a lado numa linha só.
export default function LiveVisitors({ className = "", variant = "card" }: { className?: string; variant?: "card" | "strip" }) {
  const [d, setD] = useState<Live | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/painel/live", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as Live;
          if (alive) setD(j);
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const online = d?.online ?? 0;
  const loja = d?.loja ?? 0;
  const checkout = d?.checkout ?? 0;
  const share = (n: number) => (online > 0 ? Math.round((n / online) * 100) : 0);
  // Etapa de quem está no checkout AGORA (passo máximo alcançado na sessão),
  // em relação a quem está no checkout.
  const inCheckout = (n: number) => (checkout > 0 ? Math.round((n / checkout) * 100) : 0);
  const steps = [
    { label: "Dados", n: d?.funnel?.dados ?? 0 },
    { label: "Endereço", n: d?.funnel?.endereco ?? 0 },
    { label: "Pagamento", n: d?.funnel?.pagamento ?? 0 },
  ];

  if (variant === "strip") {
    // Faixa baixa e discreta: uma linha com os seis números, sem caixas internas.
    const Fig = ({ label, value, share }: { label: string; value: number; share?: number | null }) => (
      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <dt className="text-[12px] text-low">{label}</dt>
        <dd className="flex items-baseline gap-1">
          <span className="text-[15px] font-semibold tabular-nums text-hi">{loading ? <span className="text-dim">—</span> : <AnimatedNumber value={value} />}</span>
          {share != null && !loading && <span className="text-[11.5px] tabular-nums text-dim">{share}%</span>}
        </dd>
      </div>
    );
    return (
      <section
        className={`flex min-w-0 flex-col gap-3 rounded-[22px] bg-card px-5 py-3.5 ring-1 ring-line lg:flex-row lg:items-center lg:gap-6 ${className}`}
        aria-label="Visitantes ao vivo"
      >
        <div className="flex shrink-0 items-center gap-2" title="Atualiza a cada 5 segundos">
          <span aria-hidden className={`h-2 w-2 rounded-full ${online > 0 ? "bg-emerald-500" : "bg-dim"}`} />
          <h2 className="text-[13px] font-medium text-mid">Visitantes ao vivo</h2>
        </div>
        <dl className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <Fig label="Online" value={online} />
            <Fig label="Na loja" value={loja} share={online > 0 ? share(loja) : null} />
            <Fig label="No checkout" value={checkout} share={online > 0 ? share(checkout) : null} />
          </div>
          <span aria-hidden className="hidden h-4 w-px bg-line sm:block" />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="w-full text-[12px] text-low sm:w-auto">No checkout agora</span>
            {steps.map((st) => (
              <Fig key={st.label} label={st.label} value={st.n} share={checkout > 0 ? inCheckout(st.n) : null} />
            ))}
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className={`flex min-w-0 flex-col rounded-2xl bg-card p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold text-hi">Visitantes ao vivo</h2>
          <p className="mt-0.5 text-[12.5px] text-low">Atualiza a cada 5 segundos</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-low">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${online > 0 ? "bg-emerald-500" : "bg-dim"}`} />
          Agora
        </span>
      </div>

      {/* Dois blocos iguais (título + três números), espalhados pela altura do
          cartão: sem isso tudo se amontoava no topo e sobrava vazio embaixo. */}
      <div className="mt-5 flex flex-1 flex-col justify-around gap-6">
        <div>
          <h3 className="text-[12.5px] font-medium text-low">Agora na loja</h3>
          <dl className="mt-2.5 grid grid-cols-3 gap-2">
            <LiveFigure label="Online" value={online} loading={loading} />
            <LiveFigure label="Na loja" value={loja} loading={loading} share={online > 0 ? share(loja) : null} />
            <LiveFigure label="No checkout" value={checkout} loading={loading} share={online > 0 ? share(checkout) : null} />
          </dl>
        </div>
        <div className="border-t border-line pt-5">
          <h3 className="text-[12.5px] font-medium text-low">No checkout agora</h3>
          <dl className="mt-2.5 grid grid-cols-3 gap-2">
            {steps.map((s) => (
              <LiveFigure key={s.label} label={s.label} value={s.n} loading={loading} share={checkout > 0 ? inCheckout(s.n) : null} />
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function LiveFigure({
  label,
  value,
  loading,
  share,
  size = "md",
}: {
  label: string;
  value: number;
  loading: boolean;
  share?: number | null;
  size?: "sm" | "md";
}) {
  return (
    <div className="min-w-0">
      <dt className="whitespace-nowrap text-[12px] text-low">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className={`${size === "sm" ? "text-[20px]" : "text-[24px]"} font-semibold leading-none tracking-[-0.02em] text-hi`}>
          {loading ? <span className="text-dim">—</span> : <AnimatedNumber value={value} />}
        </span>
        {share != null && !loading && <span className="text-[12px] tabular-nums text-low">{share}%</span>}
      </dd>
    </div>
  );
}
