"use client";

import React, { useCallback, useRef, useState } from "react";

// Corpo do e-mail renderizado como o cliente vê.
//
// HTML de terceiro SEMPRE em iframe isolado. O `sandbox` fica sem
// `allow-scripts`, então nada roda ali dentro; `allow-same-origin` entra só
// para conseguirmos MEDIR a altura do conteúdo. As duas permissões juntas é que
// seriam perigosas (script com acesso ao nosso documento) — separadas, não.
//
// `allow-popups` + `allow-popups-to-escape-sandbox` existem para os LINKS
// funcionarem: sem eles o clique em "Acompanhar entrega" não fazia nada, e o
// lojista não conseguia conferir para onde o botão do e-mail leva o cliente.
// Abrir em aba nova (via <base target="_blank">) em vez de navegar o próprio
// iframe: o contrário trocaria o conteúdo do quadro pela página externa e o
// lojista perderia o e-mail que estava lendo, sem botão de voltar.
//
// Continua sem `allow-scripts`, então nada disso dá execução de código a um
// e-mail de terceiro — só a capacidade de abrir um endereço que a pessoa
// clicou de propósito.
//
// A altura acompanha o conteúdo em vez de um `h-[50vh]` fixo: o e-mail de
// rastreio tem uns 1200px e, preso numa janelinha, obrigava a rolar dentro da
// rolagem para ler o fim.
// `claro`: o admin da plataforma não vive dentro de `.panel-root`, então os
// tokens de tema (border-line, bg-soft…) não existem lá e a borda sumiria.
// Nessas telas usamos a paleta cinza fixa do admin.
/**
 * Injeta `<base target="_blank">` para todo link do e-mail abrir em aba nova.
 *
 * O `<base>` precisa estar no `<head>`; quando o e-mail traz um (o caso
 * normal), entra logo depois dele, senão o navegador o descarta por vir
 * depois de conteúdo do corpo. Sem `<head>`, vai na frente de tudo — o
 * analisador cria o head implícito e o respeita.
 *
 * Um `<base>` do próprio e-mail é raríssimo, mas se existir o nosso vem
 * antes e vence: o primeiro declarado é o que vale.
 */
function comAberturaEmAbaNova(html: string): string {
  const base = '<base target="_blank">';
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length);
  return base + html;
}

export default function EmailBody({
  html,
  text,
  claro = false,
}: {
  html?: string | null;
  text?: string | null;
  claro?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [altura, setAltura] = useState(600);

  const medir = useCallback(() => {
    const frame = ref.current;
    try {
      const doc = frame?.contentDocument;
      if (!frame || !doc?.body) return;
      // ZERA a altura antes de medir. `scrollHeight` nunca é MENOR que a janela
      // do próprio iframe: medindo a 600px, uma citação de três linhas também
      // devolvia 600 e a caixa ficava enorme e vazia. Com 0, o valor lido é o
      // do conteúdo de verdade.
      frame.style.height = "0px";
      const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
      // Teto generoso: e-mail malformado pode reportar altura absurda.
      const final = Math.min(20000, Math.max(80, h + 24));
      frame.style.height = `${final}px`;
      setAltura(final);
    } catch {
      // Sem acesso ao documento (navegador mais restritivo): volta ao padrão.
      if (frame) frame.style.height = `${altura}px`;
    }
  }, [altura]);

  if (html) {
    return (
      <iframe
        ref={ref}
        title="conteúdo do e-mail"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={comAberturaEmAbaNova(html)}
        onLoad={medir}
        style={{ height: altura }}
        className={`w-full rounded-xl bg-white ${claro ? "border border-gray-200" : "border border-line"}`}
      />
    );
  }

  if (text) {
    return (
      <pre
        className={`whitespace-pre-wrap break-words rounded-xl p-4 font-sans text-sm leading-relaxed ${
          claro ? "border border-gray-200 bg-gray-50 text-gray-700" : "border border-line bg-soft text-mid"
        }`}
      >
        {text}
      </pre>
    );
  }

  return <p className={`text-sm ${claro ? "text-gray-400" : "text-dim"}`}>(sem conteúdo)</p>;
}
