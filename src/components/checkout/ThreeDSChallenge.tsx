"use client";

import React, { useEffect, useRef } from "react";
import { pollCardStatus } from "@/lib/checkout-helpers";

// Desafio 3DS 2.0 do Mercado Pago. Renderiza o iframe do banco (ACS), auto-submete
// o `creq` para a `external_resource_url` e, enquanto o cliente autentica, faz o
// poll do status do pedido. Ao aprovar/recusar, avisa o formulário via onResult.
export default function ThreeDSChallenge({
  url,
  creq,
  orderId,
  onResult,
}: {
  url: string;
  creq: string;
  orderId: string;
  onResult: (r: "approved" | "rejected" | "pending") => void;
}) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Submete o desafio dentro do iframe (o form já aponta target=iframe).
    try {
      const form = document.getElementById("vox-3ds-form");
      if (form instanceof HTMLFormElement) form.submit();
    } catch {
      /* segue pro poll mesmo assim */
    }
    // Enquanto o banco autentica, o MP atualiza o pagamento (webhook + este poll).
    let alive = true;
    (async () => {
      const final = await pollCardStatus(orderId, { intervalMs: 3000, maxTries: 40 }); // ~2 min
      if (alive) onResult(final);
    })();
    return () => {
      alive = false;
    };
  }, [orderId, onResult]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <p className="mb-1 text-center text-sm font-bold text-gray-800">Confirmação do seu banco</p>
        <p className="mb-3 text-center text-xs text-gray-500">Autentique a compra para aprovar o pagamento.</p>
        {/* Form auto-submetido no iframe abaixo (POST creq -> ACS do banco). */}
        <form id="vox-3ds-form" name="vox-3ds-form" target="vox-3ds-frame" method="post" action={url}>
          <input type="hidden" name="creq" value={creq} />
        </form>
        <iframe
          id="vox-3ds-frame"
          name="vox-3ds-frame"
          title="Autenticação do banco"
          className="h-[420px] w-full rounded-lg border border-gray-200 bg-white"
        />
        <p className="mt-3 text-center text-xs text-gray-400">Não feche esta janela até concluir.</p>
      </div>
    </div>
  );
}
