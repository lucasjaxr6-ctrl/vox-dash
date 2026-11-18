"use client";

import { useEffect, useRef, useState } from "react";
import Icone from "./Icone";

type Fase = "normal" | "verificando" | "bloqueado" | "trocado";

const LEGENDA: Record<Fase, string> = {
  normal: "Demonstração: o cartão sai pelo Gateway A, e o Gateway B fica configurado no painel.",
  verificando: "Demonstração: o cartão sai pelo Gateway A, e o Gateway B fica configurado no painel.",
  bloqueado: "O Gateway A bloqueou a conta. No painel, você troca o cartão para o Gateway B, que já está configurado.",
  trocado: "Pronto: os próximos pedidos saem pelo Gateway B. Checkout, domínio e produtos continuam os mesmos.",
};

/**
 * Simulador do Smart Routing.
 *
 * No HTML original o Gateway B assumia sozinho quando o A falhava. A VOX não
 * faz isso: o roteamento não detecta queda, e quem troca o gateway é o
 * lojista, no painel (lib/settings.ts → getPaymentRouting). Por isso o
 * visitante faz os dois passos — simular o bloqueio e depois trocar — e a
 * legenda diz o que acontece em cada um.
 */
export default function Simulador() {
  const [fase, setFase] = useState<Fase>("normal");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function avancar() {
    if (fase === "normal") {
      setFase("verificando");
      timer.current = window.setTimeout(() => setFase("bloqueado"), 500);
    } else if (fase === "bloqueado") {
      setFase("trocado");
    } else if (fase === "trocado") {
      setFase("normal");
    }
  }

  const aFalhou = fase === "bloqueado" || fase === "trocado";
  const bAtivo = fase === "trocado";

  return (
    <div className="simulator reveal delay-1">
      <div className="simulator-top">
        <div>
          <small>Simulador</small>
          <strong>Roteamento de pagamentos</strong>
        </div>
        <span className="system-badge">
          <i />
          Sistema online
        </span>
      </div>
      <div className="sim-body">
        <div className="sim-order">
          <span className="order-icon">
            <Icone nome="sacola" />
          </span>
          <div>
            <small>Novo pedido</small>
            <strong>#VX-92841 • R$&nbsp;429,90</strong>
          </div>
          <span className="method">CARTÃO</span>
        </div>
        <div className="timeline">
          <div className="time-row done">
            <span>1</span>
            <div>
              <strong>Checkout VOX</strong>
              <small>Pedido criado</small>
            </div>
            <b>12:41:08</b>
          </div>
          <div className="time-connector" />
          <div className={`time-row${aFalhou ? " failed" : ""}`}>
            <span>2</span>
            <div>
              <strong>Gateway A</strong>
              <small>{aFalhou ? "Conta bloqueada pelo gateway" : fase === "verificando" ? "Verificando resposta…" : "Tentando autorização…"}</small>
            </div>
            <b className={aFalhou ? undefined : "loading-dot"}>{aFalhou ? "BLOQUEADO" : "•••"}</b>
          </div>
          <div className="time-connector" />
          <div className={`time-row${bAtivo ? " activated" : " muted"}`}>
            <span>3</span>
            <div>
              <strong>Gateway B</strong>
              <small>{bAtivo ? "Ativado por você no painel" : "Configurado no painel"}</small>
            </div>
            <b>{bAtivo ? "ATIVO" : "RESERVA"}</b>
          </div>
        </div>
        <button type="button" className="simulate-button" onClick={avancar} disabled={fase === "verificando"}>
          {fase === "bloqueado" ? (
            <>
              <Icone nome="troca" tamanho={16} traco={2} /> Trocar o cartão para o Gateway B
            </>
          ) : fase === "trocado" ? (
            <>
              <Icone nome="reiniciar" tamanho={16} traco={2} /> Reiniciar simulação
            </>
          ) : (
            <>
              <Icone nome="raio" tamanho={16} traco={2} /> {fase === "verificando" ? "Verificando…" : "Simular gateway bloqueado"}
            </>
          )}
        </button>
        <p className="sim-note" aria-live="polite">
          {LEGENDA[fase]}
        </p>
      </div>
    </div>
  );
}
