"use client";

import { useEffect, useId, useRef, useState } from "react";
import { mountPagouCard, type PagouMount } from "@/lib/pagou-card";

/**
 * Campo de cartão da Pagou.ai.
 *
 * Aqui NÃO existem inputs nossos: quem desenha número, validade e CVV é um
 * iframe da Pagou (Payment Element). O dado do cartão nunca entra no nosso DOM
 * nem no nosso servidor — só volta um token. Por isso este bloco substitui os
 * campos de cartão dos outros gateways em vez de conviver com eles.
 */
export default function PagouCardFields({
  publicKey,
  sandbox,
  onReady,
}: {
  publicKey: string;
  sandbox: boolean;
  /** Entrega ao formulário o handle usado para submeter o pagamento. */
  onReady: (mount: PagouMount | null) => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selector = `pagou-card-${id}`;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // O callback do pai muda a cada render; o efeito não pode depender dele,
  // senão remonta o iframe a cada tecla digitada no formulário.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let alive = true;
    // Guardado fora do `alive` para a limpeza conseguir soltar o iframe mesmo
    // quando a montagem termina DEPOIS de o componente sair da tela.
    let montado: PagouMount | null = null;
    (async () => {
      const mount = await mountPagouCard({ publicKey, sandbox, selector: `#${selector}` });
      montado = mount;
      if (!alive) {
        mount?.destroy();
        return;
      }
      setLoading(false);
      if (!mount) {
        setError("Não foi possível carregar o formulário de cartão. Recarregue a página ou pague com Pix.");
        onReadyRef.current(null);
        return;
      }
      onReadyRef.current(mount);
    })();
    return () => {
      alive = false;
      // A doc do SDK pede unmount/destroy ao sair do checkout; sem isso o iframe
      // e a sessão do Element ficam vivos a cada troca de forma de pagamento.
      montado?.destroy();
    };
    // Só remonta se a loja/ambiente mudar.
  }, [publicKey, sandbox, selector]);

  return (
    <div>
      <div id={selector} className="min-h-[92px] rounded-lg border border-gray-300 bg-white px-3 py-3" />
      {loading && <p className="mt-2 text-xs text-gray-400">Carregando o formulário seguro do cartão...</p>}
      {error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{error}</p>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        Os dados do cartão são digitados num ambiente seguro da operadora e não passam pela loja.
      </p>
    </div>
  );
}
