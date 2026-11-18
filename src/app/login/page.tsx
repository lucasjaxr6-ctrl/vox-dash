"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motivoCelularInvalido, motivoDocumentoInvalido } from "@/lib/documentos";

type Mode = "login" | "register";

// Campos da 1ª etapa do cadastro (espelho de REGISTER_STEP1_FIELDS em
// lib/validation.ts — repetido aqui para não levar o zod para o navegador).
const STEP1 = ["name", "phone", "email", "password", "storeName"];

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

// Extrai uma mensagem legível do JSON de erro retornado pela API.
function readError(data: any): { msg: string; field: string | null } {
  if (data?.issues) {
    const [field, first] = Object.entries(data.issues)[0] ?? [];
    if (Array.isArray(first) && first[0]) return { msg: String(first[0]), field: String(field) };
  }
  return { msg: data?.error ?? "Não foi possível concluir.", field: null };
}

const digits = (v: string) => v.replace(/\D/g, "");

function maskPhone(v: string) {
  const d = digits(v).slice(0, 11);
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

const VAZIO = {
  name: "",
  phone: "",
  email: "",
  password: "",
  storeName: "",
  document: "",
  cep: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
};
type Form = typeof VAZIO;

/** Conferência da 1ª etapa antes de avançar. O servidor valida tudo de novo. */
function checarEtapa1(f: Form): string | null {
  if (f.name.trim().split(/\s+/).filter(Boolean).length < 2) return "Informe seu nome completo (nome e sobrenome).";
  // Mesma regra do servidor (lib/documentos.ts): DDD que existe, sem número
  // repetido ou em sequência.
  const celular = motivoCelularInvalido(f.phone);
  if (celular) return celular;
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return "Informe um e-mail válido.";
  if (f.password.length < 8) return "A senha precisa ter no mínimo 8 caracteres.";
  if (!/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) return "A senha precisa ter letras e números.";
  if (f.storeName.trim().length < 2) return "Informe o nome da loja.";
  return null;
}

/**
 * Para onde ir depois de entrar. O layout do painel manda para o login com
 * ?next=<página> e é para ela que se volta, não para o Início. Só caminho
 * interno do painel/admin: aceitar qualquer valor faria do login um
 * redirecionador para outros sites.
 */
function destino(role: string | undefined): string {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (role === "ADMIN") return /^\/(painel|admin)(\/|$)/.test(next) ? next : "/admin";
  if (role === "MERCHANT") return /^\/painel(\/|$)/.test(next) ? next : "/painel/inicio";
  return "/checkout";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<Form>(VAZIO);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cepBusy, setCepBusy] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);

  // "Criar conta grátis" da landing chega com ?cadastro=1: abre direto no cadastro.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("cadastro") === "1") setMode("register");
  }, []);

  // Se já estiver logado, encaminha para o painel (não mostra o login de novo).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) return;
        const { user } = await res.json();
        if (user) router.replace(destino(user.role));
      } catch {
        /* ignora */
      }
    })();
  }, [router]);

  function set<K extends keyof Form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // CEP completo: busca o endereço e pula para o número.
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

  async function submit() {
    setMsg(null);
    if (mode === "register" && step === 1) {
      const erro = checarEtapa1(form);
      if (erro) return setMsg(erro);
      return setStep(2);
    }
    if (mode === "register") {
      const erroDoc = motivoDocumentoInvalido(form.document);
      if (erroDoc) return setMsg(erroDoc);
    }

    setBusy(true);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload = mode === "login" ? { email: form.email, password: form.password } : form;

    try {
      // fetch same-origin envia o cookie e o header Origin (validado no middleware).
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const { msg, field } = readError(data);
        setMsg(msg);
        // Erro num campo da 1ª etapa: volta para ela, onde o campo está.
        if (mode === "register" && field && STEP1.includes(field)) setStep(1);
        return;
      }
      // Sem ?next=, o painel do lojista abre no Início.
      router.push(destino(data.user?.role));
      router.refresh();
    } catch {
      setMsg("Erro de rede. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  const cadastro = mode === "register";
  const titulo = !cadastro ? "Entrar" : step === 1 ? "Criar conta" : "Dados da empresa";
  const subtitulo = !cadastro
    ? "Acesse sua conta para continuar."
    : step === 1
      ? "Etapa 1 de 2 — seus dados e a sua loja."
      : "Etapa 2 de 2 — documento e endereço.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        {cadastro && (
          <div className="mb-5 flex gap-1.5" aria-hidden>
            <span className="h-1.5 flex-1 rounded-full bg-brand" />
            <span className={`h-1.5 flex-1 rounded-full ${step === 2 ? "bg-brand" : "bg-gray-200"}`} />
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-800">{titulo}</h1>
        <p className="mt-1 text-sm text-gray-400">{subtitulo}</p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* ── Login ou etapa 1 ── */}
          {(!cadastro || step === 1) && (
            <>
              {cadastro && (
                <Campo label="Nome completo">
                  <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Seu nome e sobrenome" autoComplete="name" />
                </Campo>
              )}
              {cadastro && (
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
              )}
              <Campo label="E-mail">
                <input type="email" className={input} value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="voce@email.com" autoComplete="email" />
              </Campo>
              <Campo label="Senha" dica={cadastro ? "Mínimo de 8 caracteres, com letras e números." : undefined}>
                <input
                  type="password"
                  className={input}
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={cadastro ? "Mínimo 8 caracteres" : "Sua senha"}
                  autoComplete={cadastro ? "new-password" : "current-password"}
                />
              </Campo>
              {cadastro && (
                <Campo label="Nome da loja">
                  <input className={input} value={form.storeName} onChange={(e) => set("storeName", e.target.value)} placeholder="Ex.: Minha Loja Oficial" autoComplete="organization" />
                </Campo>
              )}
            </>
          )}

          {/* ── Etapa 2 ── */}
          {cadastro && step === 2 && (
            <>
              <Campo label="CPF ou CNPJ">
                <input className={input} value={form.document} onChange={(e) => set("document", maskDocument(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" autoFocus />
              </Campo>
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
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </Campo>
              </div>
            </>
          )}

          {msg && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{msg}</div>}

          <div className="flex gap-2">
            {cadastro && step === 2 && (
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setMsg(null);
                }}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-300 px-4 py-3.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M19 12H5" />
                  <path d="m11 6-6 6 6 6" />
                </svg>
                Voltar
              </button>
            )}
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-brand py-3.5 font-bold uppercase tracking-wide text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {busy ? "Aguarde..." : !cadastro ? "Entrar" : step === 1 ? "Continuar" : "Criar conta"}
            </button>
          </div>
        </form>

        <button
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setStep(1);
            setMsg(null);
          }}
          className="mt-5 w-full text-center text-sm text-gray-500"
        >
          {mode === "login" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}

function Campo({ label, dica, children }: { label: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</span>
      {children}
      {dica && <span className="mt-1 block text-xs text-gray-400">{dica}</span>}
    </label>
  );
}

const input =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-gray-400";
