"use client";

import React, { useEffect, useState } from "react";
import { TEMPOS_EMAIL, TEMPOS_PADRAO, textoTempo, type KindTempo } from "@/lib/email-tempos";

// Configuração do envio de e-mail (Resend) da LOJA ATIVA. A API key nunca volta
// do servidor. Envia o e-mail de "compra aprovada" ao cliente quando o pagamento
// é confirmado.
/**
 * Os quatro e-mails que o cliente recebe, cada um com o próprio interruptor.
 * A chave casa com a coluna em store_settings e com o `kind` do servidor. A
 * descrição diz DE QUANDO conta o tempo que o lojista escolhe ao lado.
 */
const MODELOS = [
  { key: "emailPixEnabled", tempo: "pix", label: "Pix gerado", desc: "Depois que o Pix é gerado, com o copia e cola." },
  { key: "emailPaidEnabled", tempo: "paid", label: "Pagamento confirmado", desc: "Depois que o pagamento é aprovado." },
  { key: "emailSeparationEnabled", tempo: "separation", label: "Em preparação", desc: "Depois que o pagamento é aprovado, avisando que o pedido está sendo separado." },
  { key: "emailTrackingEnabled", tempo: "tracking", label: "Pedido postado", desc: "Depois que você cadastra o código de rastreio." },
] as const;

/**
 * Reengajamento: vai para quem NÃO comprou. Nasce desligado e só dispara a
 * partir do momento em que é ligado.
 */
const REENGAJAMENTO = [
  {
    key: "emailPixRecoveryEnabled",
    tempo: "pixrecovery",
    label: "Pix não pago",
    desc: "Depois que o Pix é gerado, para quem não pagou.",
  },
  {
    key: "emailRecoveryEnabled",
    tempo: "recovery",
    label: "Recuperação de carrinho",
    desc: "Depois da última atividade no checkout, para quem preencheu o contato e não gerou cobrança.",
  },
] as const;

type ModeloKey = (typeof MODELOS)[number]["key"] | (typeof REENGAJAMENTO)[number]["key"];

export default function ResendForm({
  inboundAddress = "",
  inboundSecretConfigured = false,
}: {
  inboundAddress?: string;
  inboundSecretConfigured?: boolean;
}) {
  const [enabled, setEnabled] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeySet, setApiKeySet] = useState(false);
  // Recebimento (Inbound). Vem do servidor porque o endereço é lido do banco, e
  // não da API de settings — o segredo nunca volta, só o "está configurado".
  const [inboundAddr, setInboundAddr] = useState(inboundAddress);
  const [inboundSecret, setInboundSecret] = useState("");
  const [inboundSecretSet, setInboundSecretSet] = useState(inboundSecretConfigured);
  // Padrão LIGADO: se a leitura falhar, o pior caso é mostrar ativo algo que
  // está ativo mesmo — nunca sugerir que um e-mail está desligado sem estar.
  const [modelos, setModelos] = useState<Record<ModeloKey, boolean>>({
    emailPixEnabled: true,
    emailPaidEnabled: true,
    emailSeparationEnabled: true,
    emailTrackingEnabled: true,
    // Estes começam FALSOS: vão para quem não comprou.
    emailRecoveryEnabled: false,
    emailPixRecoveryEnabled: false,
  });
  const [tempos, setTempos] = useState<Record<KindTempo, number>>(TEMPOS_PADRAO);
  // Os campos de tempo guardam o que está sendo digitado: recriados ao ler o servidor.
  const [leitura, setLeitura] = useState(0);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings } = await res.json();
        setEnabled(Boolean(settings.resendEnabled));
        setFromEmail(settings.resendFromEmail || "");
        setApiKeySet(Boolean(settings.resendConfigured));
        setModelos((m) => {
          const novo = { ...m };
          for (const { key } of [...MODELOS, ...REENGAJAMENTO]) {
            if (settings[key] !== undefined) novo[key] = Boolean(settings[key]);
          }
          return novo;
        });
        if (settings.emailTempos) {
          setTempos({ ...TEMPOS_PADRAO, ...settings.emailTempos });
          setLeitura((n) => n + 1);
        }
      } catch {
        /* silencioso */
      }
    })();
  }, []);

  async function save() {
    for (const m of [...MODELOS, ...REENGAJAMENTO]) {
      const { min, max } = TEMPOS_EMAIL[m.tempo];
      const v = tempos[m.tempo];
      if (!Number.isInteger(v)) return setMsg(`${m.label}: informe o tempo em números inteiros.`);
      if (v < min) return setMsg(`${m.label}: o mínimo é ${textoTempo(min)}.`);
      if (v > max) return setMsg(`${m.label}: o máximo é ${textoTempo(max)}.`);
    }
    setBusy(true);
    setMsg(null);
    const payload: Record<string, unknown> = {
      resendEnabled: enabled,
      resendFromEmail: fromEmail.trim(),
      ...modelos,
      emailTempos: tempos,
    };
    if (apiKey.trim()) payload.resendApiKey = apiKey.trim();
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg(data?.error ?? "Erro ao salvar.");
      setApiKey("");
      setApiKeySet(Boolean(data.settings?.resendConfigured));

      // O recebimento fica noutro endpoint (endereço + segredo do webhook), mas
      // para o lojista é o mesmo formulário: um botão salva os dois.
      const resIn = await fetch("/api/painel/inbox", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboundEmail: inboundAddr.trim(), inboundSecret: inboundSecret.trim() }),
      });
      if (!resIn.ok) {
        const erro = await resIn.json().catch(() => ({}));
        // Metade salvou: dizer exatamente o que ficou de fora.
        return setMsg(`Envio salvo, mas o recebimento falhou: ${erro?.error ?? "erro ao salvar"}`);
      }
      if (inboundSecret.trim()) {
        setInboundSecret("");
        setInboundSecretSet(true);
      }
      setMsg("Configurações salvas!");
    } catch {
      setMsg("Erro de rede.");
    } finally {
      setBusy(false);
    }
  }

  /** `template` vazio = só a checagem da configuração; "all" = os 4 modelos. */
  async function sendTest(template?: string) {
    if (!testTo.trim()) return setTestMsg("Informe um e-mail para o teste.");
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/admin/resend-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim(), ...(template ? { template } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setTestMsg(data?.error ?? "Falha no envio.");
      const enviados: string[] = data?.enviados ?? [];
      const falhas: string[] = data?.falhas ?? [];
      setTestMsg(
        `Enviado${enviados.length > 1 ? "s" : ""}: ${enviados.join(", ")}. Confira a caixa de entrada.` +
          (falhas.length ? ` Falhou: ${falhas.join(" · ")}` : ""),
      );
    } catch {
      setTestMsg("Erro de rede.");
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-hi">Resend</h2>
            <p className="text-xs text-low">Conta que a loja usa para enviar e receber e-mails dos clientes.</p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled((v) => !v)}
            aria-pressed={enabled}
            className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${enabled ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>

        {/* Envio e recebimento na MESMA área: é uma conta só do Resend, e separar
            em dois cards fazia parecer que eram dois cadastros diferentes. */}
        <div className="mt-5 text-low text-[12px] font-medium">Envio</div>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-mid">API Key</span>
            <input type="password" className={input} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={apiKeySet ? "••••••••••••" : "re_..."} autoComplete="off" />
            <span className="mt-1 block text-[11px] text-dim">Crie em <b>resend.com</b>. Fica criptografada e não é exibida de volta.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-mid">Remetente (e-mail do domínio verificado)</span>
            <input className={input} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="pedidos@sualoja.com" autoComplete="off" />
            <span className="mt-1 block text-[11px] text-dim"><b>Verifique o domínio</b> no Resend, senão o envio é recusado. O nome exibido é o da loja.</span>
          </label>
        </div>

        <div className="mt-5 text-low text-[12px] font-medium">Recebimento</div>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-mid">Endereço que esta loja recebe</span>
            <input className={input} value={inboundAddr} onChange={(e) => setInboundAddr(e.target.value)} placeholder="contato@sualoja.com" autoComplete="off" />
            <span className="mt-1 block text-[11px] text-dim">O que chegar aqui aparece na <b>Caixa de entrada</b>, com resposta pelo painel.</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-mid">Signing secret do Inbound</span>
            <input type="password" className={input} value={inboundSecret} onChange={(e) => setInboundSecret(e.target.value)} placeholder={inboundSecretSet ? "••••••••••••" : "whsec_..."} autoComplete="off" />
            <span className="mt-1 block text-[11px] text-dim">
              Ative o <b>Inbound</b> do domínio no Resend, aponte os <b>MX</b> no DNS e mande o webhook para{" "}
              <code className="break-all rounded bg-soft px-1 ring-1 ring-line">{origin}/api/webhooks/resend-inbound</code>.
            </span>
          </label>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
            {busy ? "Salvando..." : "Salvar configurações"}
          </button>
          {msg && <span className="text-sm text-mid">{msg}</span>}
        </div>
      </div>

      {/* Quais e-mails o cliente recebe */}
      <div className="rounded-2xl bg-card p-6">
        <h3 className="text-sm font-bold text-hi">E-mails enviados ao cliente</h3>
        <p className="mt-1 text-sm text-low">
          Desligue apenas o que não quiser enviar. O Resend continua ligado para os demais.
        </p>

        {/* Dois grupos, MESMO formato de linha. A caixa que separava o
            reengajamento quebrava o ritmo da lista e desalinhava o interruptor;
            um subtítulo faz a separação sem sair do padrão. */}
        <Grupo
          titulo="Depois da compra"
          nota="O cliente espera estes: desligue só o que não fizer sentido na sua operação."
          itens={MODELOS}
          modelos={modelos}
          setModelos={setModelos}
          tempos={tempos}
          setTempos={setTempos}
          leitura={leitura}
        />
        <Grupo
          titulo="Quem não comprou"
          itens={REENGAJAMENTO}
          modelos={modelos}
          setModelos={setModelos}
          tempos={tempos}
          setTempos={setTempos}
          leitura={leitura}
        />

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-60">
            {busy ? "Salvando..." : "Salvar"}
          </button>
          {msg && <span className="text-sm text-mid">{msg}</span>}
          {/* Aviso explícito: desligar aqui some com o e-mail para o cliente,
              e o efeito não é visível em lugar nenhum depois. */}
          {MODELOS.some((m) => !modelos[m.key]) && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {MODELOS.filter((m) => !modelos[m.key]).length} e-mail(s) desligado(s): o cliente não recebe.
            </span>
          )}
        </div>
      </div>

      {/* Teste */}
      <div className="rounded-2xl bg-card p-6">
        <h3 className="text-sm font-bold text-hi">Enviar e-mail de teste</h3>
        <p className="mt-1 text-sm text-low">Salve as configurações acima primeiro. Se falhar, o erro exato do Resend aparece aqui (ex.: domínio não verificado).</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Arrow function: passar `sendTest` direto mandaria o evento do clique
              como se fosse o nome do modelo. */}
          <input className={`${input} max-w-xs`} value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="seu@email.com" autoComplete="off" />
          <button onClick={() => sendTest()} disabled={testBusy} className="rounded-lg border border-line bg-card px-4 py-2 text-sm font-semibold text-mid hover:border-line-strong disabled:opacity-50">
            {testBusy ? "Enviando..." : "Testar configuração"}
          </button>
        </div>

        <div className="mt-4 pt-4">
          <h4 className="text-sm font-bold text-hi">Ver como cada e-mail chega</h4>
          <p className="mt-1 text-sm text-low">
            Envia o modelo real com <b>dados de exemplo</b>. Nenhum pedido ou cliente de verdade é usado.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["all", "Enviar todos"],
              ["pix", "Pix gerado"],
              ["paid", "Pagamento confirmado"],
              ["separation", "Em preparação"],
              ["tracking", "Pedido postado"],
              ["recovery", "Carrinho abandonado"],
              ["pixrecovery", "Pix não pago"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => sendTest(key)}
                disabled={testBusy}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                  key === "all"
                    ? "bg-brand text-white hover:bg-brand-hover"
                    : "border border-line bg-card text-mid hover:border-line-strong"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {testMsg && <p className="mt-3 text-sm text-mid">{testMsg}</p>}
      </div>

      <p className="text-xs text-dim">A API key é criptografada (AES-256-GCM) antes de ir ao banco e nunca é exibida novamente.</p>
    </div>
  );
}

const input =
  "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/** Um grupo de interruptores, todos na mesma linha-padrão. */
function Grupo({
  titulo,
  nota,
  itens,
  modelos,
  setModelos,
  tempos,
  setTempos,
  leitura,
}: {
  titulo: string;
  /** Opcional: grupo que se explica sozinho não leva nota. */
  nota?: string;
  itens: readonly { key: ModeloKey; tempo: KindTempo; label: string; desc: string }[];
  modelos: Record<ModeloKey, boolean>;
  setModelos: React.Dispatch<React.SetStateAction<Record<ModeloKey, boolean>>>;
  tempos: Record<KindTempo, number>;
  setTempos: React.Dispatch<React.SetStateAction<Record<KindTempo, number>>>;
  leitura: number;
}) {
  return (
    <div className="mt-5">
      <div className="text-low text-[12px] font-medium">{titulo}</div>
      {nota && <p className="mt-1 text-[12px] text-dim">{nota}</p>}
      <div className="mt-2 divide-y divide-line border-t border-line">
        {itens.map((m) => (
          <div key={m.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5">
            <div className="min-w-0 flex-1 basis-56">
              <div className="text-[14px] font-semibold text-hi">{m.label}</div>
              <div className="mt-0.5 text-[12.5px] text-low">{m.desc}</div>
            </div>
            <div className="flex items-center gap-3">
              <TempoDeEnvio
                key={`${m.tempo}-${leitura}`}
                kind={m.tempo}
                rotulo={m.label}
                minutos={tempos[m.tempo]}
                desligado={!modelos[m.key]}
                onChange={(v) => setTempos((t) => ({ ...t, [m.tempo]: v }))}
              />
              <button
                type="button"
                onClick={() => setModelos((s) => ({ ...s, [m.key]: !s[m.key] }))}
                aria-pressed={modelos[m.key]}
                aria-label={`${modelos[m.key] ? "Desativar" : "Ativar"} o e-mail ${m.label}`}
                className={`relative h-6 w-11 flex-shrink-0 rounded-full transition ${
                  modelos[m.key] ? "bg-brand" : "bg-gray-300 dark:bg-white/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all ${
                    modelos[m.key] ? "left-[22px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const UNIDADES = [
  { valor: 1, nome: "Minutos" },
  { valor: 60, nome: "Horas" },
  { valor: 1440, nome: "Dias" },
] as const;

/**
 * Quanto tempo depois do evento o e-mail sai: o campo do tempo e, ao lado, a barrinha
 * com a unidade. Guarda o texto digitado em vez de derivar tudo dos minutos: senão,
 * digitar "60 minutos" viraria "1 hora" no meio da digitação. Só oferece a unidade
 * que cabe no limite deste e-mail.
 */
function TempoDeEnvio({
  kind,
  rotulo,
  minutos,
  desligado,
  onChange,
}: {
  kind: KindTempo;
  rotulo: string;
  minutos: number;
  desligado: boolean;
  onChange: (minutos: number) => void;
}) {
  const { min, max, padrao } = TEMPOS_EMAIL[kind];
  const unidadeInicial = minutos <= 0 ? 0 : minutos % 1440 === 0 ? 1440 : minutos % 60 === 0 ? 60 : 1;
  const [unidade, setUnidade] = useState<number>(unidadeInicial);
  const [numero, setNumero] = useState(minutos > 0 ? String(minutos / unidadeInicial) : "");

  function aplicar(novoNumero: string, novaUnidade: number) {
    setNumero(novoNumero);
    setUnidade(novaUnidade);
    onChange(novaUnidade === 0 ? 0 : novoNumero.trim() === "" ? Number.NaN : Number(novoNumero) * novaUnidade);
  }

  return (
    <div className={`flex items-center gap-1.5 ${desligado ? "opacity-50" : ""}`}>
      {/* Em "Imediato" o campo fica, travado: as linhas continuam alinhadas. */}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        value={unidade === 0 ? "" : numero}
        placeholder={unidade === 0 ? "0" : undefined}
        disabled={desligado || unidade === 0}
        onChange={(e) => aplicar(e.target.value, unidade)}
        aria-label={`Tempo de envio do e-mail ${rotulo}`}
        className="w-16 rounded-lg border border-line bg-card px-2 py-1.5 text-center text-[13px] text-hi outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <select
        value={unidade}
        disabled={desligado}
        onChange={(e) => {
          const nova = Number(e.target.value);
          // Saindo de "Imediato", começa do padrão do e-mail ou de 10 minutos.
          aplicar(unidade === 0 && nova !== 0 ? (nova === 1 ? String(padrao || Math.min(10, max)) : "1") : numero, nova);
        }}
        aria-label={`Unidade do tempo de envio do e-mail ${rotulo}`}
        className="w-[6.5rem] rounded-lg border border-line bg-card px-2 py-1.5 text-[13px] text-mid outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      >
        {min === 0 && <option value={0}>Imediato</option>}
        {UNIDADES.filter((u) => u.valor <= max).map((u) => (
          <option key={u.valor} value={u.valor}>
            {u.nome}
          </option>
        ))}
      </select>
    </div>
  );
}
