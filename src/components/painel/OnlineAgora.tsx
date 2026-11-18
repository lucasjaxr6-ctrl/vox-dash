"use client";

import { useEffect, useState } from "react";
import AnimatedNumber from "@/components/painel/dashboard/AnimatedNumber";

/**
 * Só o número de quem está online agora, para o cartão do Início. Mesma fonte
 * e mesmo ritmo (5 s) do "Visitantes ao vivo" da Dashboard, para os dois nunca
 * mostrarem números diferentes lado a lado.
 */
export default function OnlineAgora() {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      try {
        const r = await fetch("/api/painel/live", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { online?: number };
        if (vivo) setOnline(Number(j.online ?? 0));
      } catch {
        /* tenta na próxima batida */
      }
    };
    carregar();
    const id = setInterval(carregar, 5000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);

  if (online === null) return <span className="text-dim">—</span>;
  return <AnimatedNumber value={online} />;
}
