"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVALO_MS = 20000;

// Fora do componente de propósito: a página remonta a cada troca de ?page=, e
// cada montagem consultava de novo no gateway até 40 pedidos pendentes.
let ultimaPassada = 0;

// Reconcilia os pedidos pendentes da loja (best-effort) ao abrir o painel E a
// cada 20s enquanto a aba está aberta: se algum já foi pago no gateway mas o
// webhook não chegou, ele é liquidado e a página atualiza sozinha mostrando o
// status certo. Sem cron. Só roda com a aba visível (economiza chamadas).
export default function ReconcileOnMount() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    async function run() {
      if (document.visibilityState === "hidden") return;
      // Folga de 1 s: o intervalo não dispara exatamente a cada 20 s.
      if (Date.now() - ultimaPassada < INTERVALO_MS - 1000) return;
      ultimaPassada = Date.now();
      try {
        const res = await fetch("/api/painel/reconcile", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (alive && data?.settled > 0) router.refresh();
      } catch {
        /* silencioso */
      }
    }
    run(); // imediato
    const id = setInterval(run, INTERVALO_MS); // e a cada 20s
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [router]);
  return null;
}
