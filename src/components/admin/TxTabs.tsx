"use client";

import { useState } from "react";

/**
 * Abas do detalhe da transação. Só recebe abas que TÊM conteúdo — quem monta
 * decide o que existe, então nunca aparece aba vazia por decoração.
 */
export default function TxTabs({ tabs }: { tabs: { key: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const current = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`rounded-lg px-4 py-2 text-[13px] font-semibold transition ${
              current?.key === t.key
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "text-low hover:bg-hover hover:text-hi"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl bg-card">{current?.content}</div>
    </div>
  );
}
