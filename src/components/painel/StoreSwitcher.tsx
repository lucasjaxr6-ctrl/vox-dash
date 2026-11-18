"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Store = { id: string; name: string };

// Seletor da loja ativa do painel.
//
// Era um <select> nativo: a lista aberta é desenhada pelo SISTEMA, com a faixa
// azul do Windows, e não aceita nem cor nem fonte do painel. Aqui é um listbox
// próprio, então a lista segue o tema — e dá para mostrar inicial, marcação da
// ativa e renomear sem sair do lugar.
//
// Renomear e criar usavam window.prompt, que abre um diálogo do navegador tão
// fora do tema quanto o <select>. Viraram campos embutidos no próprio painel.

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function StoreSwitcher() {
  const router = useRouter();
  const [stores, setStores] = useState<Store[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [aberto, setAberto] = useState(false);
  // Item sob o teclado. Separado da seleção: navegar com as setas não troca de
  // loja, só move o destaque — trocar recarrega o painel inteiro.
  const [foco, setFoco] = useState(0);
  /** null = nenhum campo aberto; "criar" ou o id da loja sendo renomeada. */
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState("");

  const caixaRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/painel/stores");
      if (!res.ok) return;
      const data = await res.json();
      setStores(data.stores ?? []);
      setActiveId(data.activeStoreId ?? null);
    } catch {
      /* silencioso */
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const fechar = useCallback(() => {
    setAberto(false);
    setEditando(null);
    setRascunho("");
  }, []);

  // Clique fora e Escape fecham. Sem isto o painel ficaria aberto para sempre
  // em quem abre sem querer e clica em outro lugar.
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) fechar();
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        fechar();
        gatilhoRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto, fechar]);

  // Abriu um campo de texto: foca e seleciona o conteúdo, para renomear ser um
  // gesto só (abrir, digitar por cima).
  useEffect(() => {
    if (editando) campoRef.current?.select();
  }, [editando]);

  const ativa = stores.find((s) => s.id === activeId) ?? null;

  async function select(storeId: string) {
    if (storeId === activeId) return fechar();
    setBusy(true);
    try {
      const res = await fetch("/api/painel/stores/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });
      if (res.ok) {
        setActiveId(storeId);
        fechar();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    const nome = rascunho.trim();
    if (!nome) return setEditando(null);
    setBusy(true);
    try {
      const criando = editando === "criar";
      const res = criando
        ? await fetch("/api/painel/stores", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: nome }),
          })
        : // Renomeia a LOJA ATIVA (a rota de settings opera sobre ela).
          await fetch("/api/admin/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ storeName: nome }),
          });
      if (res.ok) {
        setEditando(null);
        setRascunho("");
        await load();
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function navegar(e: React.KeyboardEvent) {
    if (editando) return; // digitando: as setas pertencem ao campo
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!aberto) return abrir();
      // Sem lojas não há o que percorrer, e o módulo por zero daria NaN.
      if (stores.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setFoco((f) => (f + passo + stores.length) % stores.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      setFoco(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setFoco(stores.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!aberto) return abrir();
      const alvo = stores[foco];
      if (alvo) select(alvo.id);
    }
  }

  function abrir() {
    // Abre já com o destaque na loja ativa, não no topo da lista.
    setFoco(Math.max(0, stores.findIndex((s) => s.id === activeId)));
    setAberto(true);
  }

  return (
    <div ref={caixaRef} className="relative">
      <div className="flex items-center gap-1.5 px-1 pb-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-bright" />
        <span className="text-low text-[12px] font-medium">Loja ativa</span>
      </div>

      <button
        ref={gatilhoRef}
        type="button"
        // NÃO desabilita com a lista vazia: é justamente aí que o lojista
        // precisa abrir para achar o "Criar nova loja".
        disabled={busy}
        onClick={() => (aberto ? fechar() : abrir())}
        onKeyDown={navegar}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls="lista-lojas"
        // Diz ao leitor de tela qual item está sob as setas — o foco real
        // continua no gatilho, então sem isto ele anunciaria sempre o mesmo.
        aria-activedescendant={aberto && stores[foco] ? `loja-${stores[foco].id}` : undefined}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 text-left transition disabled:opacity-60 ${
          aberto ? "border-brand/60 ring-2 ring-brand/20" : "border-line hover:border-line-strong hover:bg-hover"
        }`}
      >
        <Avatar nome={ativa?.name ?? "?"} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-hi">
            {ativa?.name ?? (stores.length === 0 ? "Nenhuma loja" : "Selecione")}
          </span>
          {stores.length > 1 && (
            <span className="block text-[10.5px] text-dim">
              {stores.length} lojas nesta conta
            </span>
          )}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`flex-shrink-0 text-dim transition-transform duration-200 ${aberto ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-panel-hover animate-fade-up"
          id="lista-lojas"
          role="listbox"
          aria-label="Escolher loja ativa"
        >
          <ul className="max-h-64 overflow-y-auto p-1">
            {stores.map((s, i) => {
              const eAtiva = s.id === activeId;
              const emEdicao = editando === s.id;
              return (
                <li key={s.id}>
                  {emEdicao ? (
                    <CampoNome
                      inputRef={campoRef}
                      valor={rascunho}
                      onChange={setRascunho}
                      onSalvar={salvar}
                      onCancelar={() => setEditando(null)}
                      busy={busy}
                    />
                  ) : (
                    <div
                      onMouseEnter={() => setFoco(i)}
                      className={`group flex items-center gap-2.5 rounded-lg px-2 py-2 ${
                        i === foco ? "bg-hover" : ""
                      }`}
                    >
                      {/* `role="option"` fica no BOTÃO, não no contêiner: a
                          opção é o que se escolhe, e o lápis ao lado é outra
                          ação — aninhar os dois numa opção só confunde o
                          leitor de tela. */}
                      <button
                        type="button"
                        id={`loja-${s.id}`}
                        role="option"
                        aria-selected={eAtiva}
                        onClick={() => select(s.id)}
                        disabled={busy}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-60"
                      >
                        <Avatar nome={s.name} ativa={eAtiva} />
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${eAtiva ? "font-semibold text-hi" : "text-mid"}`}>
                          {s.name}
                        </span>
                        {eAtiva && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-brand">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                      {/* Renomear só na ativa: a rota de settings opera sobre a
                          loja do cookie, então renomear outra editaria a errada. */}
                      {eAtiva && (
                        <button
                          type="button"
                          title="Renomear"
                          aria-label={`Renomear ${s.name}`}
                          onClick={() => {
                            setRascunho(s.name);
                            setEditando(s.id);
                          }}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-dim opacity-0 transition hover:bg-soft hover:text-hi focus:opacity-100 group-hover:opacity-100"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-line p-1">
            {editando === "criar" ? (
              <CampoNome
                inputRef={campoRef}
                valor={rascunho}
                onChange={setRascunho}
                onSalvar={salvar}
                onCancelar={() => setEditando(null)}
                busy={busy}
                placeholder="Nome da nova loja"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRascunho("");
                  setEditando("criar");
                }}
                disabled={busy}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-semibold text-low transition hover:bg-hover hover:text-brand disabled:opacity-60"
              >
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-line-strong">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                Criar nova loja
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Inicial da loja num ladrilho. Dá identidade visual sem precisar de logo. */
function Avatar({ nome, ativa = true }: { nome: string; ativa?: boolean }) {
  return (
    <span
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold ${
        ativa ? "bg-brand/15 text-brand" : "bg-soft text-low"
      }`}
    >
      {initials(nome)}
    </span>
  );
}

/** Campo embutido para criar/renomear — no lugar do window.prompt. */
function CampoNome({
  inputRef,
  valor,
  onChange,
  onSalvar,
  onCancelar,
  busy,
  placeholder,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  valor: string;
  onChange: (v: string) => void;
  onSalvar: () => void;
  onCancelar: () => void;
  busy: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-1 p-1">
      <input
        ref={inputRef}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter salva, Escape cancela. `stopPropagation` para o Escape não
          // vazar e fechar o painel inteiro junto.
          if (e.key === "Enter") {
            e.preventDefault();
            onSalvar();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancelar();
          }
        }}
        placeholder={placeholder ?? "Nome da loja"}
        maxLength={60}
        autoFocus
        className="min-w-0 flex-1 rounded-lg border border-brand/50 bg-card px-2 py-1.5 text-[12.5px] text-hi outline-none ring-2 ring-brand/20 placeholder:text-dim"
      />
      <button
        type="button"
        onClick={onSalvar}
        disabled={busy || !valor.trim()}
        aria-label="Salvar"
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-brand text-white transition hover:bg-brand-hover disabled:opacity-40"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
    </div>
  );
}
