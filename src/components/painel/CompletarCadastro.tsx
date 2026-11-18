"use client";

import React, { useRef, useState } from "react";
import { motivoCelularInvalido, motivoDocumentoInvalido } from "@/lib/documentos";

// Tela que o layout do painel mostra no lugar de tudo enquanto a conta não
// tiver celular, documento e endereço — contas criadas antes do cadastro em
// duas etapas. Os mesmos campos e máscaras da etapa 2 do cadastro (login/page).

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const digits = (v: string) => v.replace(/\D/g, "");

function maskPhone(v: string) {
  const d = digits(v).replace(/^55(?=\d{11}$)/, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// CPF até 11 dígitos; a partir do 12º vira CNPJ — um campo só para os dois.
function maskDocument(v: string) {
  const d = digits(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

function maskCep(v: string) {
  const d = digits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

const ROTULOS: Record<string, string> = {
  phone: "Celular",
  document: "CPF ou CNPJ",
  cep: "CEP",
  street: "Rua",
  number: "Número",
  neighborhood: "Bairro",
  city: "Cidade",
  state: "UF",
};

export default function CompletarCadastro({ nome, telefone }: { nome: string; telefone: string }) {
  const [form, setForm] = useState({
    phone: maskPhone(telefone),
    document: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cepBusy, setCepBusy] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function buscarCep(valor: string) {
    const d = digits(valor);
    if (d.length !== 8) return;
    setCepBusy(true);
    try {
      const res = await fetch(`/api/cep/${d}`);
      if (!res.ok) return;
      const a = await res.json();
      setForm((f) => ({
        ...f,
        street: a.street || f.street,
        neighborhood: a.neighborhood || f.neighborhood,
        city: a.city || f.city,
        state: a.state || f.state,
      }));
      numeroRef.current?.focus();
    } catch {
      /* sem CEP automático: o lojista preenche à mão */
    } finally {
      setCepBusy(false);
    }
  }

  async function salvar() {
    setMsg(null);
    // As mesmas regras do servidor (lib/documentos.ts), para avisar na hora.
    const erro = motivoCelularInvalido(form.phone) ?? motivoDocumentoInvalido(form.document);
    if (erro) return setMsg(erro);
    setBusy(true);
    try {
      const res = await fetch("/api/painel/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const [campo, erros] = Object.entries(data?.issues ?? {})[0] ?? [];
        const texto = Array.isArray(erros) && erros[0] ? String(erros[0]) : data?.error;
        setMsg(texto ? (campo && ROTULOS[campo] ? `${ROTULOS[campo]}: ${texto}` : texto) : "Não foi possível salvar.");
        return;
      }
      // Recarga completa: o layout (que decide mostrar esta tela) não é
      // refeito numa navegação comum.
      window.location.assign("/painel/inicio");
    } catch {
      setMsg("Erro de rede. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function sair() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const primeiroNome = nome.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-[520px] py-6 sm:py-10">
      <div className="mb-8 flex items-center justify-between">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vox-logo.png" alt="VoxCheckout" width={59} height={32} className="h-8 w-auto select-none" draggable={false} />
        <button onClick={sair} className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-low transition hover:bg-hover hover:text-hi">
          Sair
        </button>
      </div>

      <h1 className="text-[24px] font-semibold tracking-tight text-hi">
        {primeiroNome ? `${primeiroNome}, complete seu cadastro` : "Complete seu cadastro"}
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-low">
        Faltam alguns dados da sua conta. Preencha para continuar usando o painel.
      </p>

      <form
        className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-5 sm:p-6"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Celular">
            <input
              className={input}
              value={form.phone}
              onChange={(e) => set("phone", maskPhone(e.target.value))}
              placeholder="(11) 91234-5678"
              inputMode="tel"
              autoComplete="tel-national"
            />
          </Campo>
          <Campo label="CPF ou CNPJ">
            <input
              className={input}
              value={form.document}
              onChange={(e) => set("document", maskDocument(e.target.value))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              autoFocus
            />
          </Campo>
        </div>

        <Campo label="CEP" dica={cepBusy ? "Buscando endereço..." : undefined}>
          <input
            className={input}
            value={form.cep}
            onChange={(e) => {
              const v = maskCep(e.target.value);
              set("cep", v);
              buscarCep(v);
            }}
            placeholder="00000-000"
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </Campo>
        <Campo label="Rua">
          <input className={input} value={form.street} onChange={(e) => set("street", e.target.value)} autoComplete="address-line1" />
        </Campo>
        <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
          <Campo label="Número">
            <input ref={numeroRef} className={input} value={form.number} onChange={(e) => set("number", e.target.value)} />
          </Campo>
          <Campo label="Complemento">
            <input className={input} value={form.complement} onChange={(e) => set("complement", e.target.value)} placeholder="Opcional" autoComplete="address-line2" />
          </Campo>
        </div>
        <Campo label="Bairro">
          <input className={input} value={form.neighborhood} onChange={(e) => set("neighborhood", e.target.value)} />
        </Campo>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
          <Campo label="Cidade">
            <input className={input} value={form.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
          </Campo>
          <Campo label="UF">
            <select className={input} value={form.state} onChange={(e) => set("state", e.target.value)} autoComplete="address-level1">
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </Campo>
        </div>

        {msg && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 text-[13px] font-medium text-red-500">
            {msg}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-brand py-3 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
        >
          {busy ? "Salvando..." : "Salvar e continuar"}
        </button>
      </form>
    </div>
  );
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-hi">{label}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-low">{dica}</span>}
    </label>
  );
}

const input =
  "w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-hi outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-dim";
