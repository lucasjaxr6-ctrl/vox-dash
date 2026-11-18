"use client";

import { useEffect, useState } from "react";
import { URL_PLATAFORMA, DOMINIO_PLATAFORMA } from "@/lib/plataforma";

/**
 * Os endereços que o lojista cola no app dele na Appmax, prontos para copiar,
 * na mesma ordem da tela "Configuração de URLs do seu aplicativo" deles.
 *
 * Sempre com o domínio CANÔNICO (www.vox.black), nunca `window.location`:
 * quem abria o painel por `vox.black` (sem www) via a URL sem www, que responde
 * 308 — e a Appmax não segue redirecionamento, então a instalação falhava com
 * "re-check your validation URL". Foi exatamente o caso da Elvora.
 */
export default function AppmaxUrls() {
  const [dominioLoja, setDominioLoja] = useState<string | null>(null);

  // O domínio do checkout da loja entra na lista de domínios (a Appmax usa
  // os domínios para reconhecer de onde vêm as vendas).
  useEffect(() => {
    fetch("/api/painel/domain")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDominioLoja(d?.customDomain ?? null))
      .catch(() => {});
  }, []);

  const urls = [
    { rotulo: "URL de Webhook", valor: `${URL_PLATAFORMA}/api/webhooks/appmax` },
    { rotulo: "URL da sua plataforma", valor: `${URL_PLATAFORMA}/painel` },
    { rotulo: "URL de validação / Health check", valor: `${URL_PLATAFORMA}/api/appmax/health` },
  ];
  const dominios = [DOMINIO_PLATAFORMA, ...(dominioLoja ? [dominioLoja] : [])];

  return (
    <div className="rounded-xl border border-line bg-soft p-4">
      <div className="text-sm font-bold text-hi">O que colocar no app da Appmax</div>
      <p className="mt-0.5 text-xs text-low">
        Na Appmax, em <b>Configuração de URLs do seu aplicativo</b>, cole cada endereço no campo de mesmo nome e clique em{" "}
        <b>Salvar configurações</b>. Copie exatamente como está: com <b>https</b>, com <b>www</b> e sem barra no final.
      </p>
      <dl className="mt-3 space-y-2">
        {urls.map((u) => (
          <Linha key={u.rotulo} rotulo={u.rotulo} valor={u.valor} />
        ))}
        <Linha
          rotulo={dominios.length > 1 ? "Domínios" : "Domínio"}
          valor={dominios.join(", ")}
          copias={dominios}
          nota={dominioLoja ? undefined : "Configure o domínio do checkout em Domínio para ele entrar aqui também."}
        />
      </dl>
    </div>
  );
}

function Linha({ rotulo, valor, copias, nota }: { rotulo: string; valor: string; copias?: string[]; nota?: string }) {
  return (
    <div className="rounded-lg bg-card px-3 py-2 ring-1 ring-line">
      <dt className="text-[11.5px] font-semibold text-low">{rotulo}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2">
        {(copias ?? [valor]).map((v) => (
          <Copiar key={v} valor={v} />
        ))}
      </dd>
      {nota && <p className="mt-1 text-[11px] text-dim">{nota}</p>}
    </div>
  );
}

function Copiar({ valor }: { valor: string }) {
  const [ok, setOk] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setOk(true);
      setTimeout(() => setOk(false), 1600);
    } catch {
      /* área de transferência bloqueada: o texto continua selecionável */
    }
  }
  return (
    <span className="flex min-w-0 max-w-full items-center gap-2">
      <code className="min-w-0 select-all break-all rounded bg-soft px-1.5 py-0.5 text-[12.5px] text-hi">{valor}</code>
      <button
        type="button"
        onClick={copiar}
        className="flex-shrink-0 rounded-md px-2 py-1 text-[11.5px] font-semibold text-brand transition hover:bg-hover dark:text-brand-bright"
      >
        {ok ? "Copiado ✓" : "Copiar"}
      </button>
    </span>
  );
}
