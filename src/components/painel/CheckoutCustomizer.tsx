"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type Theme,
  type CheckoutTemplate,
  CHECKOUT_TEMPLATES,
  defaultTheme,
  mergeTheme,
  FONTS,
  corPadraoDaBarraTopo,
  COR_PADRAO_SELO_SEGURO,
} from "@/lib/checkout-theme";
import ImageUpload from "@/components/painel/ImageUpload";

// Editor visual do checkout: opções à esquerda, preview ao vivo à direita
// (iframe com o CHECKOUT REAL recebendo o tema por postMessage), toggle
// desktop/mobile e Salvar. O tema é validado e salvo no banco.
//
// A barra lateral segue o editor de tema das plataformas grandes: o modelo num
// seletor no topo (abre a lista, como o seletor de lojas) e as opções em grupos,
// cada linha com o estado atual à direita para dar para ler o checkout inteiro
// sem abrir nada.

type SecaoId =
  | "cores"
  | "tipografia"
  | "bordas"
  | "cabecalho"
  | "avisos"
  | "banner"
  | "urgencia"
  | "escassez"
  | "etapas"
  | "resumo"
  | "frete"
  | "rodape"
  | "aba"
  | "vitrine";

const GRUPOS: { titulo: string; secoes: { id: SecaoId; label: string; icon: React.ReactNode }[] }[] = [
  {
    titulo: "Aparência",
    secoes: [
      { id: "cores", label: "Cores", icon: <IconCores /> },
      { id: "tipografia", label: "Tipografia", icon: <IconTipografia /> },
      { id: "bordas", label: "Bordas", icon: <IconBordas /> },
    ],
  },
  {
    titulo: "Topo do checkout",
    secoes: [
      { id: "cabecalho", label: "Cabeçalho e logo", icon: <IconCabecalho /> },
      { id: "avisos", label: "Barra de avisos", icon: <IconAvisos /> },
      { id: "banner", label: "Banner", icon: <IconBanner /> },
      { id: "urgencia", label: "Urgência", icon: <IconUrgencia /> },
      { id: "escassez", label: "Escassez", icon: <IconEscassez /> },
    ],
  },
  {
    titulo: "Compra",
    secoes: [
      { id: "etapas", label: "Etapas", icon: <IconEtapas /> },
      { id: "resumo", label: "Resumo do pedido", icon: <IconResumo /> },
      { id: "frete", label: "Opções de frete", icon: <IconFrete /> },
    ],
  },
  {
    titulo: "Rodapé e extras",
    secoes: [
      { id: "rodape", label: "Rodapé", icon: <IconRodape /> },
      { id: "aba", label: "Aba do navegador", icon: <IconAba /> },
      { id: "vitrine", label: "Loja virtual (vitrine)", icon: <IconVitrine /> },
    ],
  },
];

// Nome e resumo de cada modelo. `Record` sobre o tipo: um modelo novo em
// CHECKOUT_TEMPLATES não compila sem entrar aqui, e o seletor lista sozinho.
const MODELOS: Record<CheckoutTemplate, { nome: string; descricao: string }> = {
  charm: { nome: "Charm", descricao: "Checkout em 3 etapas" },
};

// Chaves do tema cujo valor é um objeto (aptas ao patch parcial de campos).
type ObjectSection = { [K in keyof Theme]: Theme[K] extends object ? K : never }[keyof Theme];

export default function CheckoutCustomizer() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [storeName, setStoreName] = useState("Checkout");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [open, setOpen] = useState<SecaoId | null>(null);
  const [carregado, setCarregado] = useState(false);
  // O tema como está no banco, para saber se há alteração por salvar.
  const [salvo, setSalvo] = useState(() => JSON.stringify(defaultTheme));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const sujo = carregado && JSON.stringify(theme) !== salvo;

  useEffect(() => {
    (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          fetch("/api/admin/settings"),
          fetch("/api/painel/checkout-theme"),
        ]);
        if (sRes.ok) {
          const { settings } = await sRes.json();
          setStoreName(settings.storeName || "Checkout");
        }
        if (tRes.ok) {
          const { theme: t } = await tRes.json();
          if (t) {
            const m = mergeTheme(t);
            setTheme(m);
            setSalvo(JSON.stringify(m));
          }
        }
      } catch {
        /* silencioso */
      } finally {
        setCarregado(true);
      }
    })();
  }, []);

  // Fechar a aba com alteração por salvar pede confirmação do navegador.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [sujo]);

  // "Salvo" some sozinho; erro fica até a próxima ação.
  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  // Envia o tema atual para o preview (iframe) sempre que ele muda.
  function postTheme() {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "bs-theme", theme, storeName },
      window.location.origin,
    );
  }
  useEffect(() => {
    postTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, storeName]);

  // Quando o preview avisa que está pronto, manda o tema atual.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "bs-preview-ready") postTheme();
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, storeName]);

  // Só seções cujo valor é objeto (exclui "template", que é uma string).
  function patch<K extends ObjectSection>(section: K, p: Partial<Theme[K]>) {
    setTheme((t) => ({ ...t, [section]: { ...t[section], ...p } }) as Theme);
  }

  function updateShipOption(id: string, changes: Partial<Theme["shipping"]["options"][number]>) {
    setTheme((t) => ({
      ...t,
      shipping: { options: t.shipping.options.map((o) => (o.id === id ? { ...o, ...changes } : o)) },
    }));
  }

  async function save() {
    const enviado = theme;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/painel/checkout-theme", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: enviado }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: d?.error ?? "Erro ao salvar." });
        return;
      }
      setSalvo(JSON.stringify(enviado));
      setMsg({ ok: true, text: "Salvo" });
    } catch {
      setMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setSaving(false);
    }
  }

  function voltar() {
    if (sujo) setConfirmarSaida(true);
    else router.push("/painel");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
      {/* Barra superior */}
      <div className="grid h-14 flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-line px-3">
        <div className="relative flex min-w-0 items-center gap-2">
          <button
            onClick={voltar}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-low transition hover:bg-hover hover:text-hi"
            aria-label="Voltar ao painel"
          >
            <IconBack />
          </button>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-hi">Personalizar checkout</div>
            <div className="truncate text-[12px] text-low">{storeName}</div>
          </div>
          {confirmarSaida && (
            <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-line-strong bg-raised p-3.5 shadow-panel-hover animate-fade-up">
              <p className="text-[13px] font-semibold text-hi">Sair sem salvar?</p>
              <p className="mt-0.5 text-[12.5px] text-low">As alterações feitas aqui serão perdidas.</p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => router.push("/painel")}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-red-700"
                >
                  Sair sem salvar
                </button>
                <button
                  onClick={() => setConfirmarSaida(false)}
                  className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-semibold text-mid transition hover:bg-hover"
                >
                  Continuar editando
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Tamanho da pré-visualização">
          <button
            onClick={() => setDevice("mobile")}
            aria-pressed={device === "mobile"}
            className={`rounded-md px-2.5 py-1 transition ${device === "mobile" ? "bg-soft text-hi" : "text-dim hover:text-mid"}`}
            aria-label="Celular"
            title="Celular"
          >
            <IconMobile />
          </button>
          <button
            onClick={() => setDevice("desktop")}
            aria-pressed={device === "desktop"}
            className={`rounded-md px-2.5 py-1 transition ${device === "desktop" ? "bg-soft text-hi" : "text-dim hover:text-mid"}`}
            aria-label="Computador"
            title="Computador"
          >
            <IconDesktop />
          </button>
        </div>

        <div className="flex items-center justify-end gap-3">
          {msg ? (
            <span className={`text-[12.5px] font-medium ${msg.ok ? "text-brand dark:text-brand-bright" : "text-red-600"}`}>{msg.text}</span>
          ) : (
            sujo && <span className="hidden text-[12.5px] text-low sm:inline">Alterações não salvas</span>
          )}
          <button
            onClick={save}
            disabled={saving || !sujo}
            className="rounded-lg bg-brand px-5 py-2 text-[13px] font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>

      {/* Corpo */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[312px] flex-shrink-0 overflow-y-auto border-r border-line">
          <div className="border-b border-line p-4">
            <div className="mb-2 text-[12px] font-semibold text-low">Modelo</div>
            <SeletorDeModelo atual={theme.template} onChange={(template) => setTheme((t) => ({ ...t, template }))} />
          </div>

          {GRUPOS.map((g) => (
            <div key={g.titulo} className="border-b border-line pb-2 last:border-b-0">
              <div className="px-4 pb-1 pt-4 text-[12px] font-semibold text-low">{g.titulo}</div>
              {g.secoes.map((sec) => {
                const aberta = open === sec.id;
                return (
                  <div key={sec.id}>
                    <button
                      onClick={() => setOpen(aberta ? null : sec.id)}
                      aria-expanded={aberta}
                      aria-controls={`secao-${sec.id}`}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-hover ${aberta ? "bg-hover" : ""}`}
                    >
                      <span className={aberta ? "text-hi" : "text-low"}>{sec.icon}</span>
                      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${aberta ? "font-semibold text-hi" : "font-medium text-mid"}`}>
                        {sec.label}
                      </span>
                      <span className="flex-shrink-0">{resumoDaSecao(sec.id)}</span>
                      <IconChevron open={aberta} />
                    </button>
                    {aberta && (
                      <div id={`secao-${sec.id}`} className="space-y-3.5 px-4 pb-5 pt-3">
                        {renderControls(sec.id)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Preview ao vivo = CHECKOUT REAL dentro de um iframe.

            No modo celular o que faltava era ALTURA, não largura: os 390px já
            eram de aparelho real, mas o `h-full` esticava até o pé da tela
            (~1.100px) e a proporção virava uma tira. Aqui a altura é limitada e
            a largura sai da PROPORÇÃO de um celular grande (430x932), alargada
            para 470 a pedido do dono: o quadro fica com cara de aparelho, mas
            com mais respiro para ler o checkout.

            O <iframe> é UM só, com o invólucro mudando de classe: trocar de
            modo não pode remontá-lo, senão o preview recarrega e pisca. */}
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-soft p-4">
          <div
            className={
              device === "mobile"
                ? "h-full max-h-[880px] overflow-hidden rounded-[2.25rem] border-[11px] border-neutral-900 bg-neutral-900 shadow-2xl ring-1 ring-black/10 transition-all"
                : "h-full w-full overflow-hidden rounded-lg border border-line transition-all"
            }
            style={device === "mobile" ? { aspectRatio: "470 / 932" } : undefined}
          >
            <iframe
              ref={iframeRef}
              src="/checkout/preview"
              title="Pré-visualização do checkout"
              className="h-full w-full bg-card"
              onLoad={postTheme}
            />
          </div>
        </div>
      </div>
    </div>
  );

  /** O estado da seção, à direita do nome: dá para ler o checkout sem abrir nada. */
  function resumoDaSecao(id: SecaoId): React.ReactNode {
    const ligado = (on: boolean) => (
      <span className={`text-[12px] ${on ? "text-mid" : "text-dim"}`}>{on ? "Ligado" : "Desligado"}</span>
    );
    switch (id) {
      case "cores":
        return (
          <span className="flex gap-1">
            {[theme.colors.primary, theme.colors.button?.trim() || theme.colors.primary, theme.colors.background].map((c, i) => (
              <span key={i} className="h-3.5 w-3.5 rounded ring-1 ring-inset ring-black/15" style={{ background: c }} />
            ))}
          </span>
        );
      case "tipografia":
        return <span className="text-[12px] text-dim">{theme.typography.fontFamily === "system-ui" ? "Sistema" : theme.typography.fontFamily}</span>;
      case "bordas":
        return <span className="text-[12px] tabular-nums text-dim">{theme.corners.roundness}%</span>;
      case "cabecalho":
        return <span className="text-[12px] text-dim">{theme.header.showLogo ? "Com logo" : "Sem logo"}</span>;
      case "avisos":
        return ligado(theme.announcementBar.enabled);
      case "banner":
        return ligado(theme.banner.enabled);
      case "urgencia":
        return ligado(theme.urgency.enabled || theme.urgency.timerEnabled);
      case "escassez":
        return ligado(theme.scarcity.enabled);
      case "resumo":
        return <span className="text-[12px] text-dim">{theme.summary.startOpen ? "Aberto" : "Fechado"}</span>;
      case "frete": {
        const n = theme.shipping.options.filter((o) => o.enabled).length;
        return <span className="text-[12px] tabular-nums text-dim">{n} {n === 1 ? "ativa" : "ativas"}</span>;
      }
      case "vitrine":
        return ligado(theme.storefront.enabled);
      default:
        return null;
    }
  }

  function renderControls(id: SecaoId) {
    switch (id) {
      case "cores":
        return (
          <>
            <CorField label="Cor principal" hint="Preços, etapas e seleções." value={theme.colors.primary} onChange={(v) => patch("colors", { primary: v })} />
            <CorField
              label="Cor dos botões"
              value={theme.colors.button ?? ""}
              padrao={theme.colors.primary}
              onChange={(v) => patch("colors", { button: v })}
            />
            <CorField label="Texto dos botões" value={theme.colors.buttonText} onChange={(v) => patch("colors", { buttonText: v })} />
            <CorField
              label="Barra no topo"
              hint="A linha logo abaixo do logo."
              value={theme.colors.topBar ?? ""}
              padrao={corPadraoDaBarraTopo(theme.template)}
              onChange={(v) => patch("colors", { topBar: v })}
            />
            <CorField
              label="Pagamento seguro"
              hint="O selo do cabeçalho e do rodapé e a linha abaixo do botão de pagar."
              value={theme.colors.secureBadge ?? ""}
              padrao={COR_PADRAO_SELO_SEGURO}
              onChange={(v) => patch("colors", { secureBadge: v })}
            />
            <CorField label="Fundo da página" value={theme.colors.background} onChange={(v) => patch("colors", { background: v })} />
          </>
        );
      case "tipografia":
        return (
          <Field label="Fonte">
            <select value={theme.typography.fontFamily} onChange={(e) => patch("typography", { fontFamily: e.target.value })} className={inputCls}>
              {FONTS.map((f) => (
                <option key={f} value={f}>{f === "system-ui" ? "Sistema" : f}</option>
              ))}
            </select>
          </Field>
        );
      case "bordas":
        return (
          <>
            <div className="grid grid-cols-3 gap-2">
              <PresetBtn label="Quadrado" active={theme.corners.roundness === 0} onClick={() => patch("corners", { roundness: 0 })} radius={0} />
              <PresetBtn label="Suave" active={theme.corners.roundness === 40} onClick={() => patch("corners", { roundness: 40 })} radius={5} />
              <PresetBtn label="Padrão" active={theme.corners.roundness === 100} onClick={() => patch("corners", { roundness: 100 })} radius={12} />
            </div>
            <Faixa
              label="Arredondamento"
              valor={`${theme.corners.roundness}%`}
              min={0}
              max={100}
              step={5}
              value={theme.corners.roundness}
              onChange={(v) => patch("corners", { roundness: v })}
            />
            <Dica>Foto do cliente, seletores e o círculo das etapas continuam redondos.</Dica>
          </>
        );
      case "cabecalho":
        return (
          <>
            <Interruptor label="Exibir logo" checked={theme.header.showLogo} onChange={(v) => patch("header", { showLogo: v })} />
            <Field label="Logo" div>
              <ImageUpload value={theme.header.logoUrl} onChange={(url) => patch("header", { logoUrl: url })} label="logo" className="mt-1.5" />
            </Field>
            <Faixa
              label="Tamanho da logo"
              valor={`${theme.header.logoHeight}px`}
              min={24}
              max={160}
              step={2}
              value={theme.header.logoHeight}
              onChange={(v) => patch("header", { logoHeight: v })}
            />
            <Field label="Posição da logo" div>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <PresetBtn label="À esquerda" active={theme.header.logoPosition === "left"} onClick={() => patch("header", { logoPosition: "left" })} radius={8} />
                <PresetBtn label="Centralizada" active={theme.header.logoPosition === "center"} onClick={() => patch("header", { logoPosition: "center" })} radius={8} />
              </div>
            </Field>
            <CorField label="Fundo do cabeçalho" value={theme.header.bg} onChange={(v) => patch("header", { bg: v })} />
            <Field label="Assinatura da marca" hint="Aparece sob o nome da loja nos e-mails.">
              <input
                className={inputCls}
                value={theme.header.tagline}
                maxLength={60}
                placeholder="ex.: Casa que inspira"
                onChange={(e) => patch("header", { tagline: e.target.value })}
              />
            </Field>
          </>
        );
      case "avisos":
        return (
          <>
            <Interruptor label="Exibir barra de avisos" checked={theme.announcementBar.enabled} onChange={(v) => patch("announcementBar", { enabled: v })} />
            <Field label="Texto">
              <input value={theme.announcementBar.text} onChange={(e) => patch("announcementBar", { text: e.target.value })} maxLength={120} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <CorField label="Fundo" value={theme.announcementBar.bg} onChange={(v) => patch("announcementBar", { bg: v })} />
              <CorField label="Texto" value={theme.announcementBar.color} onChange={(v) => patch("announcementBar", { color: v })} />
            </div>
          </>
        );
      case "banner":
        return (
          <>
            <Interruptor label="Exibir banner" checked={theme.banner.enabled} onChange={(v) => patch("banner", { enabled: v })} />
            <Field label="Imagem" div>
              <ImageUpload value={theme.banner.imageUrl} onChange={(url) => patch("banner", { imageUrl: url })} label="banner" className="mt-1.5" />
            </Field>
          </>
        );
      case "urgencia":
        return (
          <>
            <Interruptor label="Exibir chamada" checked={theme.urgency.enabled} onChange={(v) => patch("urgency", { enabled: v })} />
            <Field label="Chamada">
              <input className={inputCls} value={theme.urgency.headline} maxLength={120} onChange={(e) => patch("urgency", { headline: e.target.value })} />
            </Field>
            <Divisor />
            <Interruptor label="Exibir cronômetro" checked={theme.urgency.timerEnabled} onChange={(v) => patch("urgency", { timerEnabled: v })} />
            <Field label="Minutos">
              <input
                type="number"
                min={1}
                max={120}
                className={inputCls}
                value={theme.urgency.minutes}
                onChange={(e) => patch("urgency", { minutes: Math.min(120, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <CorField label="Fundo" value={theme.urgency.bg} onChange={(v) => patch("urgency", { bg: v })} />
              <CorField label="Texto" value={theme.urgency.color} onChange={(v) => patch("urgency", { color: v })} />
            </div>
            <Dica>Quando o cronômetro zera, nada é bloqueado: o cliente segue comprando.</Dica>
          </>
        );
      case "escassez":
        return (
          <>
            <Interruptor label="Exibir escassez" checked={theme.scarcity.enabled} onChange={(v) => patch("scarcity", { enabled: v })} />
            <Field label="Texto">
              <input value={theme.scarcity.text} onChange={(e) => patch("scarcity", { text: e.target.value })} maxLength={120} className={inputCls} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <CorField label="Fundo" value={theme.scarcity.bg} onChange={(v) => patch("scarcity", { bg: v })} />
              <CorField label="Texto" value={theme.scarcity.color} onChange={(v) => patch("scarcity", { color: v })} />
            </div>
          </>
        );
      case "etapas":
        return (
          <>
            <Subtitulo>Barra de etapas (1 · 2 · 3)</Subtitulo>
            <Interruptor label="Mostrar no celular" checked={theme.stepBar.mobile} onChange={(v) => patch("stepBar", { mobile: v })} />
            <Interruptor label="Mostrar no computador" checked={theme.stepBar.desktop} onChange={(v) => patch("stepBar", { desktop: v })} />
            <Divisor />
            <Subtitulo>Primeira etapa</Subtitulo>
            <Field label="Título">
              <input
                className={inputCls}
                value={theme.steps.identificationTitle}
                maxLength={60}
                placeholder="Identifique-se"
                onChange={(e) => patch("steps", { identificationTitle: e.target.value })}
              />
            </Field>
            <Field label="Subtítulo">
              <input
                className={inputCls}
                value={theme.steps.identificationSubtitle}
                maxLength={160}
                onChange={(e) => patch("steps", { identificationSubtitle: e.target.value })}
              />
            </Field>
            <Field label="Texto do botão">
              <input
                className={inputCls}
                value={theme.steps.ctaText}
                maxLength={40}
                placeholder="Continuar"
                onChange={(e) => patch("steps", { ctaText: e.target.value })}
              />
            </Field>
          </>
        );
      case "resumo":
        return (
          <>
            <Field label="Título do resumo">
              <input value={theme.summary.title} onChange={(e) => patch("summary", { title: e.target.value })} maxLength={60} className={inputCls} />
            </Field>
            <Interruptor label="Começar aberto" checked={theme.summary.startOpen} onChange={(v) => patch("summary", { startOpen: v })} />
            <Dica>Fechado, a barra mostra só o total e o cliente abre se quiser.</Dica>
          </>
        );
      case "frete":
        return (
          <>
            {theme.shipping.options.map((o, i) => (
              <div key={o.id} className={i > 0 ? "border-t border-line pt-3.5" : ""}>
                <Interruptor label={`Opção ${i + 1}`} forte checked={o.enabled} onChange={(v) => updateShipOption(o.id, { enabled: v })} />
                <div className={`mt-2.5 space-y-2.5 transition-opacity ${o.enabled ? "" : "opacity-50"}`}>
                  <Field label="Nome">
                    <input value={o.name} onChange={(e) => updateShipOption(o.id, { name: e.target.value })} maxLength={60} className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Prazo">
                      <input value={o.eta} onChange={(e) => updateShipOption(o.id, { eta: e.target.value })} maxLength={60} className={inputCls} />
                    </Field>
                    <Field label="Valor (R$)">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={(o.priceCents / 100).toString()}
                        onChange={(e) => updateShipOption(o.id, { priceCents: Math.max(0, Math.round(Number(e.target.value) * 100) || 0) })}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <Field label="Ícone da transportadora">
                    <select value={o.carrier} onChange={(e) => updateShipOption(o.id, { carrier: e.target.value as typeof o.carrier })} className={inputCls}>
                      <option value="">Nenhum</option>
                      <option value="correios">Correios</option>
                      <option value="sedex">Sedex</option>
                      <option value="full">Full</option>
                      <option value="transportadora">Transportadora</option>
                      <option value="expresso">Frete Expresso</option>
                    </select>
                  </Field>
                </div>
              </div>
            ))}
          </>
        );
      case "rodape":
        return (
          <>
            <Field label="Texto do rodapé">
              <input value={theme.footer.text} onChange={(e) => patch("footer", { text: e.target.value })} maxLength={200} className={inputCls} />
            </Field>
            <Interruptor label="Selo de segurança" checked={theme.footer.showSecureBadge} onChange={(v) => patch("footer", { showSecureBadge: v })} />
            <Divisor />
            <Subtitulo>Dados da empresa</Subtitulo>
            <Dica>Opcional. Aparece no rodapé só o que você preencher.</Dica>
            <Field label="Razão social">
              <input value={theme.footer.companyName ?? ""} onChange={(e) => patch("footer", { companyName: e.target.value })} maxLength={120} className={inputCls} />
            </Field>
            <Field label="CNPJ">
              <input
                value={theme.footer.cnpj ?? ""}
                onChange={(e) => patch("footer", { cnpj: mascaraCnpj(e.target.value) })}
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                className={inputCls}
              />
            </Field>
            <Field label="Endereço">
              <input
                value={theme.footer.address ?? ""}
                onChange={(e) => patch("footer", { address: e.target.value })}
                maxLength={200}
                placeholder="Rua, número, bairro, cidade - UF, CEP"
                className={inputCls}
              />
            </Field>
            <Field label="Telefone de contato">
              <input
                value={theme.footer.phone ?? ""}
                onChange={(e) => patch("footer", { phone: mascaraTelefone(e.target.value) })}
                inputMode="tel"
                placeholder="(00) 00000-0000"
                className={inputCls}
              />
            </Field>
            <Field label="E-mail de contato">
              <input
                type="email"
                value={theme.footer.email ?? ""}
                onChange={(e) => patch("footer", { email: e.target.value })}
                maxLength={120}
                placeholder="contato@sualoja.com.br"
                className={inputCls}
              />
            </Field>
          </>
        );
      case "aba":
        return (
          <>
            <Field label="Título da aba" hint="Em branco, usa o nome da loja.">
              <input value={theme.seo.title} onChange={(e) => patch("seo", { title: e.target.value })} maxLength={60} placeholder={storeName} className={inputCls} />
            </Field>
            <Field label="Favicon" hint="PNG quadrado, de preferência 64×64." div>
              <ImageUpload value={theme.seo.faviconUrl} onChange={(url) => patch("seo", { faviconUrl: url })} label="favicon" className="mt-1.5" />
            </Field>
          </>
        );
      case "vitrine":
        return (
          <>
            <Interruptor label="Ativar vitrine" checked={theme.storefront.enabled} onChange={(v) => patch("storefront", { enabled: v })} />
            <Field label="Título da vitrine" hint="A vitrine é uma página separada da loja.">
              <input value={theme.storefront.title} onChange={(e) => patch("storefront", { title: e.target.value })} maxLength={60} className={inputCls} />
            </Field>
          </>
        );
    }
  }
}

// ── Subcomponentes ──
const inputCls =
  "mt-1.5 h-9 w-full rounded-lg border border-line bg-card px-3 text-[13px] text-hi outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

/**
 * Seletor do modelo, no desenho do seletor de lojas: mostra o atual e abre a
 * lista dos modelos ao clicar. Fecha no clique fora e no Escape.
 */
function SeletorDeModelo({ atual, onChange }: { atual: CheckoutTemplate; onChange: (t: CheckoutTemplate) => void }) {
  const [aberto, setAberto] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const m = MODELOS[atual];
  return (
    <div ref={caixaRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={`flex w-full items-center gap-3 rounded-xl border bg-card p-2 pr-3 text-left transition ${
          aberto ? "border-brand/60 ring-2 ring-brand/20" : "border-line hover:border-line-strong hover:bg-hover"
        }`}
      >
        <Esboco />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-hi">{m.nome}</span>
          <span className="block truncate text-[12px] text-low">{m.descricao}</span>
        </span>
        <IconChevron open={aberto} />
      </button>

      {aberto && (
        <div
          role="listbox"
          aria-label="Modelos de checkout"
          className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-line-strong bg-raised p-1 shadow-panel-hover animate-fade-up"
        >
          {CHECKOUT_TEMPLATES.map((id) => {
            const eAtual = id === atual;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={eAtual}
                onClick={() => {
                  onChange(id);
                  setAberto(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-hover"
              >
                <Esboco />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] ${eAtual ? "font-semibold text-hi" : "text-mid"}`}>{MODELOS[id].nome}</span>
                  <span className="block truncate text-[12px] text-low">{MODELOS[id].descricao}</span>
                </span>
                {eAtual && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-brand dark:text-brand-bright">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Mini-esboço do modelo: cabeçalho, as 3 bolinhas da barra de etapas e o formulário. */
function Esboco() {
  return (
    <span className="flex h-10 w-12 flex-shrink-0 flex-col gap-1 rounded-md border border-line bg-white p-1" aria-hidden>
      <span className="h-1 w-full rounded-sm bg-gray-800" />
      <span className="flex flex-1 flex-col items-center gap-1 px-1.5">
        <span className="flex w-full justify-between">
          <span className="h-1 w-1 rounded-full bg-gray-800" />
          <span className="h-1 w-1 rounded-full bg-gray-300" />
          <span className="h-1 w-1 rounded-full bg-gray-300" />
        </span>
        <span className="w-full flex-1 rounded-sm bg-gray-100" />
      </span>
    </span>
  );
}

/** Atalho de arredondamento: o próprio botão mostra o canto que aplica. */
function PresetBtn({ label, active, onClick, radius }: { label: string; active: boolean; onClick: () => void; radius: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ borderRadius: radius }}
      className={`border px-2 py-2.5 text-[12px] font-semibold transition ${active ? "border-brand bg-brand/10 text-hi" : "border-line text-mid hover:bg-hover"}`}
    >
      {label}
    </button>
  );
}

/** `div`: para conteúdo que não é um campo (upload), onde o <label> abriria o arquivo ao clicar no texto. */
function Field({ label, hint, div = false, children }: { label: string; hint?: string; div?: boolean; children: React.ReactNode }) {
  const corpo = (
    <>
      <span className="block text-[12px] font-medium text-mid">{label}</span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">{hint}</span>}
      {children}
    </>
  );
  return div ? <div>{corpo}</div> : <label className="block">{corpo}</label>;
}

/** 00.000.000/0000-00 enquanto digita. Só formata: o campo é opcional e livre. */
function mascaraCnpj(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

/** (00) 0000-0000 ou (00) 00000-0000 enquanto digita. */
function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const corte = d.length === 11 ? 7 : 6;
  if (d.length <= corte) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, corte)}-${d.slice(corte)}`;
}

function Subtitulo({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold text-low">{children}</div>;
}

function Dica({ children }: { children: React.ReactNode }) {
  return <p className="text-[11.5px] leading-snug text-dim">{children}</p>;
}

function Divisor() {
  return <div className="border-t border-line" />;
}

/** Interruptor com o rótulo à esquerda (o mesmo desenho das telas de gateway). */
function Interruptor({ label, checked, onChange, forte = false }: { label: string; checked: boolean; onChange: (v: boolean) => void; forte?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className={`text-[13px] ${forte ? "font-semibold text-hi" : "text-mid"}`}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${checked ? "bg-brand" : "bg-gray-300 dark:bg-white/20"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** Controle deslizante com o valor atual à direita do rótulo. */
function Faixa({
  label,
  valor,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  valor: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-mid">{label}</span>
        <span className="text-[12px] font-semibold tabular-nums text-hi">{valor}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-brand" />
    </label>
  );
}

/**
 * Cor numa peça só: a amostra abre o seletor do sistema e o código ao lado é
 * editável.
 *
 * Com `padrao`, a cor pode ficar VAZIA, significando "herda o padrão". Um
 * `<input type="color">` não sabe ficar vazio (sempre devolve um hex), então a
 * amostra mostra a cor EFETIVA e o botão "Padrão" é o único jeito de voltar
 * atrás. Sem ele, escolher uma cor por engano seria irreversível pela tela.
 */
function CorField({
  label,
  hint,
  value,
  padrao,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  padrao?: string;
  onChange: (v: string) => void;
}) {
  const herda = padrao !== undefined;
  const definido = Boolean(value.trim());
  const efetiva = definido ? value : (padrao ?? "#000000");
  return (
    <div>
      <span className="block text-[12px] font-medium text-mid">{label}</span>
      {hint && <span className="mt-0.5 block text-[11.5px] leading-snug text-dim">{hint}</span>}
      <div className="mt-1.5 flex h-9 items-center gap-2 rounded-lg border border-line bg-card pl-1.5 pr-2 transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <span className="relative h-6 w-6 flex-shrink-0 overflow-hidden rounded-md ring-1 ring-inset ring-black/15" style={{ background: efetiva }}>
          <input
            type="color"
            value={efetiva}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label}: escolher cor`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <input
          value={definido ? value : ""}
          placeholder={padrao}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label}: código da cor`}
          className="min-w-0 flex-1 bg-transparent text-[13px] uppercase tabular-nums text-hi outline-none placeholder:text-dim"
        />
        {herda &&
          (definido ? (
            <button type="button" onClick={() => onChange("")} className="flex-shrink-0 text-[11.5px] font-semibold text-low transition hover:text-hi">
              Padrão
            </button>
          ) : (
            <span className="flex-shrink-0 text-[11.5px] text-dim">padrão</span>
          ))}
      </div>
    </div>
  );
}

// ── Ícones (traço 1.8, no peso dos outros ícones do painel) ──
function Icone({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="block">
      {children}
    </svg>
  );
}
function IconCores() {
  return (
    <Icone>
      <path d="M12 3a9 9 0 0 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9c2.9 0 5.2-2.3 5.2-5.2C21.5 6.4 17.3 3 12 3Z" />
      <circle cx="7.5" cy="11.5" r="1" />
      <circle cx="10" cy="7.5" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </Icone>
  );
}
function IconTipografia() {
  return (
    <Icone>
      <path d="M4 7V5h16v2M12 5v14M9 19h6" />
    </Icone>
  );
}
function IconBordas() {
  return (
    <Icone>
      <path d="M4 20v-9a7 7 0 0 1 7-7h9" />
    </Icone>
  );
}
function IconCabecalho() {
  return (
    <Icone>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
    </Icone>
  );
}
function IconAvisos() {
  return (
    <Icone>
      <path d="m3 11 16-6v14L3 13z" />
      <path d="M7 13.5V17a2 2 0 0 0 4 0v-2" />
    </Icone>
  );
}
function IconBanner() {
  return (
    <Icone>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-4.5-4.5L6 20" />
    </Icone>
  );
}
function IconUrgencia() {
  return (
    <Icone>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 10v3.5l2 2M10 2.5h4" />
    </Icone>
  );
}
function IconEscassez() {
  return (
    <Icone>
      <path d="M12 21a7 7 0 0 0 7-7c0-2.7-1.6-4.6-3-6-.4 1.6-1.4 2.6-2.5 3 .3-3-1.2-5.6-3.5-8 0 3-2 4.6-3.5 6.3A7 7 0 0 0 12 21Z" />
    </Icone>
  );
}
function IconEtapas() {
  return (
    <Icone>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 12h3M14 12h3" />
    </Icone>
  );
}
function IconResumo() {
  return (
    <Icone>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </Icone>
  );
}
function IconFrete() {
  return (
    <Icone>
      <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17" cy="18" r="1.8" />
    </Icone>
  );
}
function IconRodape() {
  return (
    <Icone>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 15h18" />
    </Icone>
  );
}
function IconAba() {
  return (
    <Icone>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" />
    </Icone>
  );
}
function IconVitrine() {
  return (
    <Icone>
      <path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9h16M10 20v-5h4v5" />
    </Icone>
  );
}
function IconBack() {
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>);
}
function IconMobile() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>);
}
function IconDesktop() {
  return (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>);
}
function IconChevron({ open }: { open: boolean }) {
  return (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`flex-shrink-0 text-dim transition-transform duration-200 ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>);
}
