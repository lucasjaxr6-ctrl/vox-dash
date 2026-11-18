"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { maskCPF, maskPhone } from "@/lib/checkout-helpers";

// "Editar cliente" na tela do pedido: nome, e-mail, CPF/CNPJ, WhatsApp e
// endereço. Substitui o antigo "Corrigir e-mail / reenviar": corrige o cadastro
// e nada mais (não dispara e-mail, não mexe na Shopify).

type Endereco = { cep: string; street: string; number: string; complement: string; neighborhood: string; city: string; uf: string };
export type ClienteInicial = { name: string; email: string; document: string; phone: string; address: Partial<Endereco> | null };

/** CPF até 11 dígitos, CNPJ a partir de 12. */
function maskDocumento(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) return maskCPF(d);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}
const maskCep = (v: string) => v.replace(/\D/g, "").slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");

export default function EditarCliente({ orderId, inicial }: { orderId: string; inicial: ClienteInicial }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-hi transition hover:bg-hover"
      >
        <IconEditar />
        Editar cliente
      </button>
      {aberto && <Janela orderId={orderId} inicial={inicial} onFechar={() => setAberto(false)} />}
    </>
  );
}

function Janela({ orderId, inicial, onFechar }: { orderId: string; inicial: ClienteInicial; onFechar: () => void }) {
  const router = useRouter();
  const a = inicial.address ?? {};
  const [f, setF] = useState({
    name: inicial.name,
    email: inicial.email,
    document: maskDocumento(inicial.document),
    phone: maskPhone(inicial.phone),
    cep: maskCep(a.cep ?? ""),
    street: a.street ?? "",
    number: a.number ?? "",
    complement: a.complement ?? "",
    neighborhood: a.neighborhood ?? "",
    city: a.city ?? "",
    uf: (a.uf ?? "").toUpperCase(),
  });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);

  const campo = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));

  // Esc fecha, como as outras janelas do painel.
  const fechar = useCallback(onFechar, [onFechar]);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) fechar();
    };
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [fechar, busy]);

  /** CEP completo: preenche rua, bairro, cidade e UF (mesma busca do checkout). */
  async function aoMudarCep(v: string) {
    const mascarado = maskCep(v);
    campo("cep", mascarado);
    const d = mascarado.replace(/\D/g, "");
    if (d.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`/api/cep/${d}`);
      if (!res.ok) return;
      const r = await res.json();
      setF((x) => ({
        ...x,
        street: r.street || x.street,
        neighborhood: r.neighborhood || x.neighborhood,
        city: r.city || x.city,
        uf: (r.state || x.uf).toUpperCase(),
      }));
    } catch {
      /* sem CEP: o lojista preenche à mão */
    } finally {
      setBuscandoCep(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      const res = await fetch("/api/painel/orders/customer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          name: f.name,
          email: f.email,
          document: f.document,
          phone: f.phone,
          address: {
            cep: f.cep,
            street: f.street,
            number: f.number,
            complement: f.complement,
            neighborhood: f.neighborhood,
            city: f.city,
            uf: f.uf,
          },
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A validação devolve a mensagem de cada campo; a primeira diz o que corrigir.
        const primeira = d?.issues ? (Object.values(d.issues).flat()[0] as string | undefined) : undefined;
        setErro(primeira ?? d?.error ?? "Não foi possível salvar.");
        return;
      }
      router.refresh();
      onFechar();
    } catch {
      setErro("Erro de rede. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="panel-root fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={() => !busy && fechar()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-cliente-titulo"
    >
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-line bg-card p-5 shadow-panel-hover"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="editar-cliente-titulo" className="text-base font-bold text-hi">Editar cliente</h2>
            <p className="mt-0.5 text-xs text-low">Corrige o cadastro deste pedido. Nenhum e-mail é enviado ao cliente.</p>
          </div>
          <button
            type="button"
            onClick={fechar}
            disabled={busy}
            aria-label="Fechar"
            className="-mr-1 -mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-dim transition hover:bg-hover hover:text-hi"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <h3 className="mt-5 text-[13px] font-semibold text-hi">Cliente</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Campo label="Nome" className="sm:col-span-2">
            <input className={input} value={f.name} onChange={(e) => campo("name", e.target.value)} maxLength={120} autoComplete="off" />
          </Campo>
          <Campo label="E-mail" className="sm:col-span-2">
            <input type="email" className={input} value={f.email} onChange={(e) => campo("email", e.target.value)} maxLength={254} autoComplete="off" />
          </Campo>
          <Campo label="CPF ou CNPJ">
            <input inputMode="numeric" className={input} value={f.document} onChange={(e) => campo("document", maskDocumento(e.target.value))} autoComplete="off" />
          </Campo>
          <Campo label="WhatsApp">
            <input inputMode="tel" className={input} value={f.phone} onChange={(e) => campo("phone", maskPhone(e.target.value))} placeholder="(11) 91234-5678" autoComplete="off" />
          </Campo>
        </div>

        <h3 className="mt-5 text-[13px] font-semibold text-hi">Endereço</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-6">
          <Campo label={buscandoCep ? "CEP (buscando...)" : "CEP"} className="sm:col-span-2">
            <input inputMode="numeric" className={input} value={f.cep} onChange={(e) => aoMudarCep(e.target.value)} placeholder="00000-000" autoComplete="off" />
          </Campo>
          <Campo label="Rua" className="sm:col-span-4">
            <input className={input} value={f.street} onChange={(e) => campo("street", e.target.value)} maxLength={160} autoComplete="off" />
          </Campo>
          <Campo label="Número" className="sm:col-span-2">
            <input className={input} value={f.number} onChange={(e) => campo("number", e.target.value)} maxLength={20} autoComplete="off" />
          </Campo>
          <Campo label="Complemento (opcional)" className="sm:col-span-4">
            <input className={input} value={f.complement} onChange={(e) => campo("complement", e.target.value)} maxLength={120} autoComplete="off" />
          </Campo>
          <Campo label="Bairro" className="sm:col-span-2">
            <input className={input} value={f.neighborhood} onChange={(e) => campo("neighborhood", e.target.value)} maxLength={120} autoComplete="off" />
          </Campo>
          <Campo label="Cidade" className="sm:col-span-3">
            <input className={input} value={f.city} onChange={(e) => campo("city", e.target.value)} maxLength={120} autoComplete="off" />
          </Campo>
          <Campo label="UF" className="sm:col-span-1">
            <input className={`${input} uppercase`} value={f.uf} onChange={(e) => campo("uf", e.target.value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase())} autoComplete="off" />
          </Campo>
        </div>

        {erro && (
          <p role="alert" className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] font-medium text-red-600 dark:text-red-400">
            {erro}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-[11.5px] text-dim">O pedido na Shopify, se houver, não é alterado.</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fechar}
              disabled={busy}
              className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-mid transition hover:bg-hover hover:text-hi"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-brand px-4 py-2 text-[13px] font-bold text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

const input =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-hi outline-none placeholder:text-dim focus:border-brand focus:ring-2 focus:ring-brand/20";

function Campo({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[12px] font-medium text-low">{label}</span>
      {children}
    </label>
  );
}

function IconEditar() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
