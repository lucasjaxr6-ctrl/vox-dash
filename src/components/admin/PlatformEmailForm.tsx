"use client";

import { useState } from "react";
import CopyField from "./CopyField";
import { WEBHOOK_INBOUND } from "@/lib/plataforma";

/**
 * E-mail da PLATAFORMA (Vox) via Resend.
 *
 * Separado do e-mail das lojas de propósito: cada loja envia pelo domínio dela
 * para o comprador receber a mensagem da marca onde comprou. Este é a Vox
 * falando com o lojista.
 *
 * A chave nunca volta do servidor — o campo fica em branco e só é enviado
 * quando o admin cola uma nova.
 */
export default function PlatformEmailForm({
  configurado,
  fromEmail: fromInicial,
  fromName: nomeInicial,
  inboundEmail: inboundInicial = "",
  temSegredoInbound = false,
}: {
  configurado: boolean;
  fromEmail: string;
  fromName: string;
  inboundEmail?: string;
  temSegredoInbound?: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [fromEmail, setFromEmail] = useState(fromInicial);
  const [fromName, setFromName] = useState(nomeInicial || "Vox");
  const [inboundEmail, setInboundEmail] = useState(inboundInicial);
  const [inboundSecret, setInboundSecret] = useState("");
  const [temSegredo, setTemSegredo] = useState(temSegredoInbound);
  const [salvo, setSalvo] = useState(configurado);
  const [busy, setBusy] = useState(false);
  const [testando, setTestando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvar() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Chave e segredo em branco NÃO vão no corpo: ausente significa
        // "mantém o atual" — nenhum dos dois volta do servidor para comparar.
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(inboundSecret.trim() ? { inboundSecret: inboundSecret.trim() } : {}),
          fromEmail,
          fromName,
          inboundEmail,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, texto: data?.error ?? "Erro ao salvar." });
      setSalvo(Boolean(data.configurado));
      setTemSegredo(Boolean(data.temSegredoInbound));
      setApiKey("");
      setInboundSecret("");
      setMsg({ ok: true, texto: "Configuração salva." });
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  async function testar() {
    setTestando(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => ({}));
      setMsg(
        res.ok
          ? { ok: true, texto: `Enviado para ${data.to}. Confira a caixa de entrada.` }
          : { ok: false, texto: data?.error ?? "Falha ao enviar." },
      );
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setTestando(false);
    }
  }

  const campo = "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-mid">Remetente (e-mail)</span>
          <input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="contato@vox.black"
            className={campo}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-mid">Nome exibido</span>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Vox" className={campo} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-mid">Chave da API do Resend</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={salvo ? "Chave salva — cole uma nova para trocar" : "re_..."}
          className={campo}
        />
      </label>

      {/* Recebimento. O endereço aqui é o que decide o que cai na caixa do
          admin: o webhook casa o destinatário com ele (ou com o domínio dele). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-mid">Recebe em (caixa de entrada)</span>
          <input
            value={inboundEmail}
            onChange={(e) => setInboundEmail(e.target.value)}
            placeholder="contato@vox.black"
            className={campo}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-mid">Signing secret do webhook</span>
          <input
            type="password"
            value={inboundSecret}
            onChange={(e) => setInboundSecret(e.target.value)}
            placeholder={temSegredo ? "Segredo salvo — cole um novo para trocar" : "whsec_..."}
            className={campo}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={salvar}
          disabled={busy}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Salvando..." : "Salvar"}
        </button>
        <button
          onClick={testar}
          disabled={testando || !salvo}
          title={salvo ? "" : "Salve a chave e o remetente primeiro"}
          className="rounded-lg border border-line-strong px-4 py-2 text-sm font-semibold text-mid disabled:opacity-40"
        >
          {testando ? "Enviando..." : "Enviar teste para mim"}
        </button>
      </div>

      <p className="text-xs text-low">
        {salvo ? (
          <>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">Configurado.</span> O domínio do remetente precisa estar
            verificado no Resend — o teste acima confirma isso.
          </>
        ) : (
          <>
            <span className="font-semibold text-amber-600 dark:text-amber-400">Sem configuração.</span> Crie a chave em{" "}
            <a href="https://resend.com/api-keys" target="_blank" rel="noreferrer" className="underline">
              resend.com/api-keys
            </a>{" "}
            e verifique o domínio em <span className="font-mono">Domains</span>.
          </>
        )}
      </p>

      <div className="rounded-lg border border-line bg-soft p-3">
        <p className="mb-2 text-xs text-low">
          Para receber: no Resend, ative o <span className="font-mono">Inbound</span> do domínio, aponte os{" "}
          <b>MX</b> no DNS e mande o webhook para:
        </p>
        <CopyField value={WEBHOOK_INBOUND} />
        <p className="mt-2 text-xs text-low">
          Use a URL <b>exatamente</b> como está aí, com o <span className="font-mono">www</span>: sem ele a Vercel
          responde 308 para o www e o Resend não segue redirect em POST — o e-mail fica lá e nunca chega aqui.
        </p>
        <p className="mt-1.5 text-xs text-low">
          Cole o signing secret acima. Sem ele o webhook é aceito sem verificação — quem descobrir a URL conseguiria
          plantar e-mail na caixa.
        </p>
      </div>

      {msg && <p className={`text-xs font-semibold ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.texto}</p>}
    </div>
  );
}
