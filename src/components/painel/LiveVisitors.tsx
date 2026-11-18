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
export default function LiveVisitors({ className = "" }: { className?: string }) {
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
}: {
  label: string;
  value: number;
  loading: boolean;
  share?: number | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="whitespace-nowrap text-[12px] text-low">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-[24px] font-semibold leading-none tracking-[-0.02em] text-hi">
          {loading ? <span className="text-dim">—</span> : <AnimatedNumber value={value} />}
        </span>
        {share != null && !loading && <span className="text-[12px] tabular-nums text-low">{share}%</span>}
      </dd>
    </div>
  );
}
