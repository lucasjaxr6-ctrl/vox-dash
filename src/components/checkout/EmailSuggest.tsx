"use client";

import React, { useEffect, useState } from "react";
import { emailSuggestions } from "@/lib/checkout-helpers";

/**
 * Lista de provedores que aparece quando o cliente digita o "@" no e-mail.
 *
 * Precisa ficar DENTRO de um elemento `relative` (o campo), porque se posiciona
 * logo abaixo dele.
 *
 * Detalhes que não são decoração:
 *  • `onMouseDown` em vez de `onClick`: o clique só dispara depois do blur do
 *    campo, e a lista já teria sumido — a sugestão nunca seria escolhida.
 *  • `preventDefault` no mesmo evento mantém o foco no campo, então o cliente
 *    continua digitando de onde parou.
 *  • `tabIndex={-1}`: o Tab pula as sugestões e vai para o próximo campo. Sem
 *    isso, sair do e-mail pelo teclado entraria na lista em vez do CPF.
 */
export default function EmailSuggest({
  value,
  onPick,
}: {
  value: string;
  onPick: (email: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  // Voltou a digitar → volta a sugerir (inclusive depois de fechar no Esc).
  useEffect(() => setDismissed(false), [value]);

  const list = emailSuggestions(value);
  if (dismissed || list.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl">
      {list.map((s) => (
        <button
          key={s}
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(s);
            setDismissed(true);
          }}
          className="block w-full truncate px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
