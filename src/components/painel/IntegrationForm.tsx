"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";

// Escopos usados pelo app da Shopify (Admin API).
const SHOPIFY_SCOPES =
  "read_customers,write_customers,read_orders,write_orders,read_draft_orders,write_draft_orders,read_products,write_products,read_themes,write_themes,read_discounts,read_price_rules,read_script_tags,write_script_tags";

// Integração da Shopify (por loja), em duas colunas: à esquerda o que o
// lojista preenche (domínio, Client ID, Secret); à direita o que ele consulta
// ou copia (status, URLs, escopos). Explicação longa saiu da tela: o passo a
// passo fica atrás de "Está com dúvidas?".
//
// Registrar webhooks e pedido de teste saíram da tela a pedido do dono (as
// rotas continuam): o "Conectar" já cadastra os webhooks no callback do OAuth.
//
// O Token Admin vem sozinho no "Conectar" (OAuth). O Secret nunca volta do
// servidor: o campo mostra os pontinhos quando já está salvo.
export default function IntegrationForm() {
  const [storeName, setStoreName] = useState("");
  /** Só o subdomínio: o ".myshopify.com" fica fixo ao lado do campo. */
  const [sub, setSub] = useState("");
  const [orderSync, setOrderSync] = useState(true); // enviar pedidos p/ Shopify
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [adminTokenSet, setAdminTokenSet] = useState(false);
  const [secretSet, setSecretSet] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [instBusy, setInstBusy] = useState(false);
  const [instMsg, setInstMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<CheckoutHealth | null>(null);
  const [healthBusy, setHealthBusy] = useState(true);
  /** Remover o checkout mexe na loja do lojista: pede um segundo clique. */
  const [confirmar, setConfirmar] = useState<"remover" | null>(null);
  const [verDetalhes, setVerDetalhes] = useState(false);
  const [verPassos, setVerPassos] = useState(false);

  const [appUrl, setAppUrl] = useState("/api/postback/shopify/installapp");
  const [callbackUrl, setCallbackUrl] = useState("/api/postback/shopify/callback");

  useEffect(() => {
    setAppUrl(`${window.location.origin}/api/postback/shopify/installapp`);
    setCallbackUrl(`${window.location.origin}/api/postback/shopify/callback`);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings } = await res.json();
        setStoreName(settings.storeName ?? "");
        setSub(subdominio(settings.shopifyStoreDomain ?? ""));
        setOrderSync(settings.shopifyOrderSyncEnabled !== false);
        setClientId(settings.shopifyApiKey ?? "");
        setAdminTokenSet(Boolean(settings.adminTokenConfigured));
        setSecretSet(Boolean(settings.shopifyApiSecretConfigured));
      } catch {
        /* silencioso */
      }
    })();
    // Estado real do checkout na loja, já ao abrir a página.
    checkCheckout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiado(value);
      setTimeout(() => setCopiado(null), 1500);
    } catch {
      /* clipboard indisponível */
    }
  }

  /** Salva o formulário. Devolve se deu certo (o "Conectar" salva antes de ir). */
  async function save(): Promise<boolean> {
    if (sub && !/^[a-z0-9][a-z0-9-]*$/.test(sub)) {
      setMsg({ ok: false, text: "Domínio inválido. Use só o nome da loja, ex.: minha-loja." });
      return false;
    }
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {
      shopifyStoreDomain: sub ? `${sub}.myshopify.com` : "",
      shopifyOrderSyncEnabled: orderSync,
    };
    // Só envia o que foi digitado (em branco = manter o valor atual).
    if (clientId.trim()) payload.shopifyApiKey = clientId.trim();
    if (secret.trim()) {
      // O Secret do app é também o segredo de assinatura dos webhooks.
      payload.shopifyApiSecret = secret.trim();
      payload.shopifyWebhookSecret = secret.trim();
    }

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data?.error ?? "Erro ao salvar." });
        return false;
      }
      setSecret("");
      setAdminTokenSet(Boolean(data.settings.adminTokenConfigured));
      setSecretSet(Boolean(data.settings.shopifyApiSecretConfigured));
      setMsg({ ok: true, text: "Salvo" });
      return true;
    } catch {
      setMsg({ ok: false, text: "Erro de rede." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function connectShopify() {
    if (!sub) {
      setMsg({ ok: false, text: "Informe o domínio MyShopify." });
      return;
    }
    // O servidor precisa do Client ID/Secret salvos para iniciar o OAuth.
    if (!(await save())) return;
    window.location.href = `/api/postback/shopify/installapp?shop=${encodeURIComponent(`${sub}.myshopify.com`)}`;
  }

  /** Diagnóstico ao vivo: o que está REALMENTE instalado na Shopify agora. */
  async function checkCheckout() {
    setHealthBusy(true);
    try {
      const res = await fetch("/api/painel/shopify/install-checkout");
      if (res.ok) setHealth(await res.json());
    } catch {
      /* silencioso */
    } finally {
      setHealthBusy(false);
    }
  }

  async function installCheckout(method: "POST" | "DELETE") {
    setConfirmar(null);
    setInstBusy(true);
    setInstMsg(null);
    try {
      const res = await fetch("/api/painel/shopify/install-checkout", { method });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInstMsg(data?.error ?? "Erro ao atualizar o checkout na loja.");
        return;
      }
      if (method === "POST") {
        // Mostra o MOTIVO de cada caminho que falhou. Sem isso, um "tema:
        // falhou" não diz se foi permissão, tema sem </head> ou erro de leitura.
        const falhas = [
          data.scriptTag ? null : `ScriptTag: ${data.scriptTagError ?? "falhou"}`,
          data.themeSnippet ? null : `Tema: ${data.themeSnippetError ?? "falhou"}`,
        ].filter(Boolean);
        setInstMsg(falhas.length === 0 ? "Checkout instalado." : `Instalado parcialmente. ${falhas.join(" | ")}`);
      } else {
        setInstMsg(`Checkout removido da loja${data.removed ? ` (${data.removed})` : ""}.`);
      }
      await checkCheckout();
    } catch {
      setInstMsg("Erro de rede.");
    } finally {
      setInstBusy(false);
    }
  }

  const snippetOk = Boolean(health?.themeSnippet.present && health.themeSnippet.upToDate);
  const checkoutAtivo = Boolean(health?.shopifyConnected && health.domainReady && (health.scriptTagOk || snippetOk));

  return (
    // `grid-cols-1` (minmax(0,1fr)) e não a coluna automática: sem ele, a linha
    // comprida dos escopos esticava a coluna além da tela no notebook.
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {/* ── Esquerda: o que o lojista preenche ── */}
      <section className="rounded-2xl bg-card">
        <div className="p-6">
          <h2 className="text-[15px] font-semibold text-hi">{storeName ? `Olá, ${storeName}` : "Conectar Shopify"}</h2>
          <p className="mt-0.5 text-[13px] text-low">Vamos instalar o checkout da VOX na sua loja Shopify.</p>

          <div className="mt-6 space-y-4">
            <Field label="Domínio MyShopify">
              <span className="flex h-10 overflow-hidden rounded-lg border border-line bg-soft transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 text-sm text-hi outline-none placeholder:text-dim"
                  value={sub}
                  onChange={(e) => setSub(subdominio(e.target.value))}
                  placeholder="minha-loja"
                  autoComplete="off"
                  spellCheck={false}
                />
                <span className="flex flex-shrink-0 items-center border-l border-line bg-hover px-3 text-[13px] text-low">.myshopify.com</span>
              </span>
            </Field>
            <Field label="Client ID">
              <input className={input} value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="ex.: f9fc4944e72c..." autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Secret">
              <input
                type="password"
                className={input}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={secretSet ? "••••••••••••" : "shpss_..."}
                autoComplete="new-password"
              />
            </Field>

            <div className="flex items-center justify-between gap-4 pt-1">
              <div className="min-w-0">
                <div className="text-sm font-medium text-hi">Enviar pedidos para a Shopify</div>
                <div className="text-[12.5px] text-low">Cada compra no checkout vira um pedido na sua Shopify.</div>
              </div>
              <Interruptor checked={orderSync} onChange={setOrderSync} label="Enviar pedidos para a Shopify" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4">
          {msg && (
            <span className={`mr-auto text-[13px] font-medium ${msg.ok ? "text-brand dark:text-brand-bright" : "text-red-600"}`}>{msg.text}</span>
          )}
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-60"
          >
            {busy ? "Salvando..." : "Salvar"}
          </button>
          <button
            onClick={connectShopify}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
          >
            {adminTokenSet ? "Reconectar Shopify" : "Conectar com Shopify"}
          </button>
        </div>
      </section>

      {/* ── Direita: status, o que copiar e as ferramentas ── */}
      <div className="space-y-5">
        <section className="rounded-2xl bg-card p-6">
          <h3 className="text-[15px] font-semibold text-hi">Status da integração</h3>
          <div className="mt-4 divide-y divide-line rounded-xl border border-line">
            <StatusRow label="Shopify" ok={adminTokenSet} okText="Conectada" offText="Não conectada" />
            <StatusRow
              label="Checkout na loja"
              ok={checkoutAtivo}
              okText="Ativo"
              offText={healthBusy && !health ? "Verificando..." : "Inativo"}
              neutro={healthBusy && !health}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => installCheckout("POST")}
              disabled={instBusy}
              className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-60"
            >
              {instBusy ? "Aguarde..." : "Instalar checkout"}
            </button>
            <button
              onClick={checkCheckout}
              disabled={healthBusy}
              className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-mid transition hover:bg-hover disabled:opacity-60"
            >
              {healthBusy ? "Verificando..." : "Verificar"}
            </button>
            <button
              onClick={() => setConfirmar(confirmar === "remover" ? null : "remover")}
              disabled={instBusy}
              className="rounded-lg px-3 py-2 text-[13px] font-semibold text-red-600 transition hover:bg-red-500/10 disabled:opacity-60"
            >
              Remover
            </button>
          </div>
          {health?.shopifyConnected && !health.domainReady && (
            <p className="mt-3 text-[13px] text-amber-600">
              Verifique seu domínio na aba{" "}
              <Link href="/painel/dominio" className="font-semibold underline underline-offset-2">Domínio</Link> para ativar o checkout.
            </p>
          )}
          {confirmar === "remover" && (
            <Confirmacao
              texto="A loja volta para o checkout da Shopify."
              acao="Remover checkout"
              perigo
              onConfirmar={() => installCheckout("DELETE")}
              onCancelar={() => setConfirmar(null)}
            />
          )}
          {instMsg && <p className="mt-3 break-words text-[13px] text-mid">{instMsg}</p>}

          {health && (
            <button onClick={() => setVerDetalhes((v) => !v)} className="mt-4 text-[12.5px] font-semibold text-low transition hover:text-hi">
              {verDetalhes ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          )}
          {verDetalhes && health && <CheckoutHealthPanel h={health} />}

          <div className="mt-5 border-t border-line pt-4">
            <button
              onClick={() => setVerPassos((v) => !v)}
              aria-expanded={verPassos}
              className="flex w-full items-center justify-between text-left text-[13px] font-semibold text-brand transition hover:text-brand-hover dark:text-brand-bright"
            >
              Está com dúvidas? Veja o passo a passo
              <Chevron open={verPassos} />
            </button>
            {verPassos && (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-mid">
                <li>No Shopify Partners, crie um app em <b>Apps → Create app → Create app manually</b>.</li>
                <li>Em <b>Configuration</b>, cole as duas URLs e os escopos abaixo.</li>
                <li>Copie o <b>Client ID</b> e o <b>Client secret</b> do app para esta tela.</li>
                <li>Clique em <b>Conectar com Shopify</b> e autorize.</li>
              </ol>
            )}
          </div>
        </section>

        <section className="rounded-2xl bg-card p-6">
          <h3 className="text-[15px] font-semibold text-hi">URLs do app</h3>
          <div className="mt-4 space-y-3">
            <CopyRow label="App URL" value={appUrl} copiado={copiado === appUrl} onCopy={() => copy(appUrl)} />
            <CopyRow label="Allowed redirection URL" value={callbackUrl} copiado={copiado === callbackUrl} onCopy={() => copy(callbackUrl)} />
          </div>
        </section>

        <section className="rounded-2xl bg-card p-6">
          <h3 className="text-[15px] font-semibold text-hi">Escopos do app</h3>
          <div className="mt-4">
            <CopyRow value={SHOPIFY_SCOPES} copiado={copiado === SHOPIFY_SCOPES} onCopy={() => copy(SHOPIFY_SCOPES)} />
          </div>
        </section>
      </div>
    </div>
  );
}

/** Aceita o que o lojista colar (URL, domínio inteiro) e fica só com o nome da loja. */
function subdominio(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.myshopify\.com$/, "");
}

type CheckoutHealth = {
  installed: boolean;
  src: string | null;
  status: string | null;
  checkedAt: string | null;
  expectedSrc: string | null;
  shopifyConnected: boolean;
  domainReady: boolean;
  scriptTags: { id: string; src: string }[];
  scriptTagOk?: boolean;
  scriptTagStale?: boolean;
  themeSnippet: { present: boolean; upToDate: boolean };
};

/**
 * O estado REAL do checkout na loja, item por item. O caso que mais dói é o
 * "desatualizado": o ScriptTag existe, então parece instalado, mas aponta para
 * um endereço que não responde mais, e a loja cai no checkout nativo da
 * Shopify em silêncio.
 */
function CheckoutHealthPanel({ h }: { h: CheckoutHealth }) {
  if (!h.shopifyConnected) return <StatusLine tone="warn" text="Shopify não conectada." />;
  if (!h.domainReady) return <StatusLine tone="warn" text="Domínio próprio ainda não verificado (aba Domínio)." />;

  const snippetOk = h.themeSnippet.present && h.themeSnippet.upToDate;
  const anyOk = h.scriptTagOk || snippetOk;

  return (
    <div className="mt-3 space-y-2">
      <StatusLine
        tone={anyOk ? "ok" : "err"}
        text={anyOk ? "Checkout ativo na loja." : "Checkout inativo: o botão de finalizar compra cai no checkout da Shopify."}
      />
      <StatusLine
        tone={h.scriptTagOk ? "ok" : h.scriptTagStale ? "err" : "warn"}
        text={
          h.scriptTagOk
            ? "ScriptTag instalado e apontando para o endereço certo."
            : h.scriptTagStale
              ? `ScriptTag desatualizado: aponta para ${h.scriptTags[0]?.src ?? "outro endereço"}`
              : "ScriptTag ausente."
        }
      />
      <StatusLine
        tone={snippetOk ? "ok" : "warn"}
        text={
          snippetOk
            ? "Snippet presente no tema publicado."
            : h.themeSnippet.present
              ? "Snippet no tema aponta para outro endereço."
              : "Snippet ausente do tema publicado."
        }
      />
      {h.expectedSrc && <p className="break-all pt-1 font-mono text-[11px] text-dim">esperado: {h.expectedSrc}</p>}
      {h.checkedAt && (
        <p className="text-[11px] text-dim">
          Última verificação automática: {new Date(h.checkedAt).toLocaleString("pt-BR")}
          {h.status ? ` (${h.status})` : ""}
        </p>
      )}
    </div>
  );
}

function StatusLine({ tone, text }: { tone: "ok" | "warn" | "err"; text: string }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : "text-red-600";
  return (
    <p className={`flex items-start gap-2 text-[13px] ${color}`}>
      <span className="mt-0.5 flex-shrink-0">{tone === "ok" ? <IconOk /> : <IconAlerta />}</span>
      <span>{text}</span>
    </p>
  );
}

/** Uma linha do status: o que é à esquerda, o estado em selo à direita. */
function StatusRow({ label, ok, okText, offText, neutro = false }: { label: string; ok: boolean; okText: string; offText: string; neutro?: boolean }) {
  const cls = neutro
    ? "bg-hover text-low"
    : ok
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-red-500/10 text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3">
      <span className="text-[13px] text-mid">{label}</span>
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${cls}`}>
        {!neutro && (ok ? <IconOk /> : <IconX />)}
        {ok ? okText : offText}
      </span>
    </div>
  );
}

function Confirmacao({
  texto,
  acao,
  perigo = false,
  onConfirmar,
  onCancelar,
}: {
  texto: string;
  acao: string;
  perigo?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-soft p-3">
      <p className="text-[13px] text-mid">{texto}</p>
      <div className="mt-2.5 flex gap-2">
        <button
          onClick={onConfirmar}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white transition ${perigo ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:bg-brand-hover"}`}
        >
          {acao}
        </button>
        <button onClick={onCancelar} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-mid transition hover:bg-hover">
          Cancelar
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-mid">{label}</span>
      {children}
    </label>
  );
}

function Interruptor({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-line-strong"}`}
    >
      {/* A bolinha é branca nos dois temas: contrasta com o verde ligado e com
          o trilho apagado. */}
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Valor para copiar numa linha só (cortado com reticências) + botão de copiar. */
function CopyRow({ label, value, copiado, onCopy }: { label?: string; value: string; copiado: boolean; onCopy: () => void }) {
  return (
    <div>
      {label && <span className="mb-1.5 block text-[12.5px] font-medium text-low">{label}</span>}
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-soft px-3 py-2 font-mono text-[12px] text-mid" title={value}>
          {value}
        </code>
        <button
          onClick={onCopy}
          aria-label={label ? `Copiar ${label}` : "Copiar"}
          title="Copiar"
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border transition ${
            copiado ? "border-brand/40 bg-brand/10 text-brand dark:text-brand-bright" : "border-line text-low hover:bg-hover hover:text-hi"
          }`}
        >
          {copiado ? <IconOk /> : <IconCopiar />}
        </button>
      </div>
    </div>
  );
}

const input =
  "h-10 w-full rounded-lg border border-line bg-soft px-3 text-sm text-hi outline-none transition placeholder:text-dim focus:border-brand focus:ring-2 focus:ring-brand/20";

function IconOk() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconX() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function IconAlerta() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 8v4.5M12 16h.01" />
    </svg>
  );
}
function IconCopiar() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
