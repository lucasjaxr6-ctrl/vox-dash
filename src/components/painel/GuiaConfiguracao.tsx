"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { INICIO, etapaDaRota, ehRotaDeConfiguracao, rotaPermitida, type EtapaRota } from "@/lib/onboarding-rotas";

/**
 * Envolve o conteúdo do painel durante (e depois) da configuração inicial.
 *
 * • Trava: com a configuração pendente, rota fora das etapas pendentes mostra
 *   o aviso "conclua a configuração primeiro" no lugar da página. Numa carga
 *   completa o layout nem renderiza a página; aqui cobre a navegação pelo
 *   menu, que não refaz o layout.
 * • Volta sozinho: numa tela de etapa, confere a cada 3 s; quando a etapa fica
 *   pronta, leva de volta ao Início para a próxima.
 * • Seta: nas telas de configuração. Durante o passo a passo leva ao Início;
 *   depois, volta para onde o lojista estava.
 */
export default function GuiaConfiguracao({
  travado,
  etapas,
  children,
}: {
  travado: boolean;
  etapas: EtapaRota[];
  children: React.ReactNode;
}) {
  const path = usePathname() || INICIO;
  const router = useRouter();
  const permitido = !travado || rotaPermitida(path, etapas);
  const etapaAtual = travado ? etapaDaRota(path, etapas) : null;
  const vigiar = Boolean(etapaAtual && !etapaAtual.feito);

  // As etapas chegam do layout, que a navegação comum não refaz. Ao voltar ao
  // Início com a configuração pendente, refaz: o botão de lá aponta para a
  // etapa ATUAL (ex.: "Sincronizar" depois de conectar a Shopify), e uma lista
  // velha aqui barraria esse clique.
  useEffect(() => {
    if (travado && path === INICIO) router.refresh();
  }, [travado, path, router]);

  // Conferência da etapa aberta. Volta ao Início quando ela fica pronta OU
  // quando muda de tela (a Shopify conectada passa a pedir a sincronização,
  // que mora em Produtos) — nos dois casos, o próximo passo está no Início.
  const voltando = useRef(false);
  useEffect(() => {
    if (!vigiar) return;
    voltando.current = false;
    let vivo = true;
    const conferir = async () => {
      try {
        const r = await fetch("/api/painel/onboarding", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { concluido: boolean; etapas: EtapaRota[] };
        if (!vivo || voltando.current) return;
        const agora = etapaDaRota(path, j.etapas);
        if (j.concluido || !agora || agora.feito) {
          voltando.current = true;
          router.replace(INICIO);
          // O layout guarda quais etapas faltam; só um refresh o refaz.
          router.refresh();
        }
      } catch {
        /* rede oscilou: confere na próxima batida */
      }
    };
    const id = setInterval(conferir, 3000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [vigiar, path, router]);

  if (!permitido) return <AvisoTravado etapas={etapas} />;

  function voltar() {
    // Aberta direto (sem histórico no app): o "antes" não existe — vai ao Início.
    if (window.history.length > 1) router.back();
    else router.push(INICIO);
  }

  return (
    <>
      {ehRotaDeConfiguracao(path) && (
        <div className="mb-4">
          {travado ? (
            <Link href={INICIO} className={SETA}>
              <Seta />
              Voltar para o Início
            </Link>
          ) : (
            <button type="button" onClick={voltar} className={SETA}>
              <Seta />
              Voltar
            </button>
          )}
        </div>
      )}
      {children}
    </>
  );
}

/**
 * Seção travada: no lugar da página, um aviso no meio da tela dizendo o que
 * falta e o caminho de volta. Redirecionar calado fazia parecer que o menu
 * estava quebrado.
 */
function AvisoTravado({ etapas }: { etapas: EtapaRota[] }) {
  const faltam = etapas.filter((e) => !e.feito);
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-card p-7 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <h1 className="mt-4 text-[18px] font-semibold tracking-tight text-hi">Conclua a configuração da sua loja primeiro</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-low">
          Esta seção é liberada assim que você terminar o passo a passo do Início.
          {faltam.length > 0 && (
            <>
              {" "}
              {faltam.length === 1 ? "Falta" : "Faltam"}:{" "}
              <b className="font-semibold text-mid">{faltam.map((e) => e.titulo ?? e.id).join(", ")}</b>.
            </>
          )}
        </p>
        <Link
          href={INICIO}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-[13.5px] font-semibold text-white transition hover:bg-brand-hover"
        >
          <Seta />
          Voltar para o Início
        </Link>
      </div>
    </div>
  );
}

const SETA =
  "-ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-low transition hover:bg-hover hover:text-hi";

function Seta() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}
