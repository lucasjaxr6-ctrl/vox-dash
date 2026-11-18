"use client";

import React, { useEffect, useState } from "react";

type Info = {
  customDomain: string | null;
  verified: boolean;
  verifiedAt: string | null;
  cnameTarget: string;
  cnameHost: string | null;
  txtHost: string | null;
  txtValue: string | null;
  vercelManaged: boolean;
  misconfigured: boolean;
  vercelError?: string;
};

export default function DomainManager() {
  const [info, setInfo] = useState<Info | null>(null);
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/painel/domain");
      if (res.ok) {
        const data: Info = await res.json();
        setInfo(data);
        setDomain(data.customDomain ?? "");
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/domain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Erro ao salvar.");
        return;
      }
      setInfo(data);
      setDomain(data.customDomain ?? "");
      if (data.vercelError) setMsg(data.vercelError);
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  async function removeDomain() {
    if (!confirm("Excluir o domínio atual? Você poderá cadastrar um novo em seguida.")) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/domain", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data?.error ?? "Erro ao excluir.");
        return;
      }
      setInfo(data);
      setDomain("");
      setMsg("Domínio removido. Cadastre um novo acima.");
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/domain/verify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.verified) {
        setMsg("Domínio verificado com sucesso!");
        await load();
      } else {
        setMsg(data?.error ?? "Não foi possível verificar ainda.");
      }
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <p className="text-sm text-low">Carregando...</p>;

  const hasDomain = !!info?.customDomain;

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-hi">Domínio próprio</h1>
      <p className="mt-1 text-sm text-low">
        Use o subdomínio que preferir no checkout — ex.: <b>checkout.sualoja.com</b>, <b>seguro.sualoja.com</b> ou <b>pay.sualoja.com</b>. Se digitar só o domínio raiz, usamos <b>checkout.</b> por padrão. Aponte o DNS e verifique abaixo.
      </p>

      {/* Domínio */}
      <div className="mt-6 rounded-xl bg-card p-6">
        <label className="block">
          <span className="block text-sm font-bold text-hi">Seu domínio</span>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="checkout.sualoja.com"
              className="w-72 rounded-lg border border-line px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            <button onClick={save} disabled={saving} className="rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
              {saving ? "Salvando..." : hasDomain ? "Atualizar" : "Conectar domínio"}
            </button>
            {hasDomain && (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${info!.verified ? "bg-green-500/10 text-green-700 dark:text-green-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${info!.verified ? "bg-green-500" : "bg-amber-500"}`} />
                {info!.verified ? "Verificado" : "Pendente"}
              </span>
            )}
            {hasDomain && (
              <button
                onClick={removeDomain}
                disabled={saving}
                className="rounded-lg border border-red-500/25 bg-card px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-300"
              >
                Excluir domínio
              </button>
            )}
          </div>
        </label>
        {msg && <p className="mt-3 text-sm text-mid">{msg}</p>}
      </div>

      {/* Instruções DNS */}
      {hasDomain && (
        <div className="mt-5 rounded-xl bg-card p-6">
          <h2 className="text-sm font-bold text-hi">Configuração do DNS</h2>
          <p className="mt-1 text-sm text-low">
            No painel do seu provedor de domínio, crie os dois registros abaixo.
          </p>

          <p className="mt-4 text-low text-[12px] font-medium">
            {info!.txtValue ? "1. Apontar o tráfego (CNAME)" : "Apontar o tráfego (CNAME)"}
          </p>
          <DnsRow type="CNAME" name={info!.cnameHost ?? ""} value={info!.cnameTarget} />

          {info!.txtValue && (
            <>
              <p className="mt-5 text-low text-[12px] font-medium">
                2. Verificar a propriedade (TXT)
              </p>
              <DnsRow type="TXT" name={info!.txtHost ?? ""} value={info!.txtValue} />
            </>
          )}

          <p className="mt-3 text-xs text-dim">
            Dica: no campo <b>Nome/Host</b> use exatamente o valor acima (ex.:{" "}
            <code className="rounded bg-soft px-1 ring-1 ring-line">checkout</code>). Seu
            provedor completa com o domínio sozinho. Seu checkout ficará em{" "}
            <b>https://{info!.customDomain}</b>.
          </p>

          {info!.vercelManaged && info!.misconfigured && !info!.verified && (
            <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
              O CNAME ainda não foi detectado (pode estar propagando). Assim que apontar, o SSL é emitido automaticamente.
            </p>
          )}

          <div className="mt-5 flex items-center gap-3">
            <button onClick={verify} disabled={verifying} className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-mid hover:border-line-strong disabled:opacity-60">
              {verifying ? "Verificando..." : "Verificar domínio"}
            </button>
            <span className="text-xs text-dim">A propagação do DNS pode levar de minutos a algumas horas.</span>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-xl bg-blue-500/10 p-4 text-sm text-mid">
        {info?.vercelManaged ? (
          <>
            <b>SSL automático:</b> ao apontar o CNAME, o domínio é registrado na hospedagem e o certificado
            HTTPS é emitido sozinho — não precisa configurar nada manualmente. Só um <b>CNAME</b> basta.
          </>
        ) : (
          <>
            <b>Importante:</b> apontar o DNS e verificar registra o domínio aqui. A entrega do tráfego e o
            certificado SSL (HTTPS) são configurados na hospedagem/proxy da aplicação para o host de destino acima.
          </>
        )}
      </div>
    </div>
  );
}

function DnsRow({ type, name, value }: { type: string; name: string; value: string }) {
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-soft p-3 sm:grid-cols-[80px_1fr_1fr]">
      <Cell label="Tipo" value={type} />
      <Cell label="Nome / Host" value={name} copyable />
      <Cell label="Valor / Destino" value={value} copyable />
    </div>
  );
}

function Cell({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard indisponível */
    }
  }
  return (
    <div className="min-w-0">
      <div className="text-low text-[12px] font-medium">{label}</div>
      <div className="flex items-center gap-1">
        <code className="truncate font-mono text-xs text-hi">{value}</code>
        {copyable && value && (
          <button onClick={copy} className="flex-shrink-0 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
            {copied ? "✓" : "copiar"}
          </button>
        )}
      </div>
    </div>
  );
}
