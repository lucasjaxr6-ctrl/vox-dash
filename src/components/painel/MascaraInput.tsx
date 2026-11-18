"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { thumb } from "@/lib/image";

export type Sugestao = { id: string; name: string; imageUrl: string | null };

// Campo da máscara: digitação LIVRE com sugestões dos produtos da loja.
//
// Na prática o lojista usa o nome real de OUTRO produto do catálogo como
// máscara — foi o que os dados mostraram. Digitar isso à mão exige lembrar o
// nome inteiro e abre espaço para erro de digitação, então aqui a lista aparece
// e filtra conforme se escreve.
//
// O campo continua ABERTO de propósito: escolher da lista é um atalho, não uma
// obrigação. Quem quiser inventar um nome digita e pronto.
export default function MascaraInput({
  valor,
  onChange,
  sugestoes,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  sugestoes: Sugestao[];
  placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  // Posição da lista na tela. Ela é renderizada por PORTAL no <body> porque a
  // tabela vive dentro de `overflow-hidden` + `overflow-x-auto` — os dois
  // cortariam um menu absoluto. Portal escapa de qualquer recorte.
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!aberto) return;
    const medir = () => {
      const r = campoRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    medir();
    // `true` na captura: pega o scroll de QUALQUER contêiner acima, não só o
    // da janela — a tabela rola por dentro.
    window.addEventListener("scroll", medir, true);
    window.addEventListener("resize", medir);
    return () => {
      window.removeEventListener("scroll", medir, true);
      window.removeEventListener("resize", medir);
    };
  }, [aberto]);

  const filtradas = useMemo(() => {
    const q = valor.trim().toLowerCase();
    // Sem texto, mostra as primeiras; com texto, filtra por trecho.
    const base = q ? sugestoes.filter((s) => s.name.toLowerCase().includes(q)) : sugestoes;
    return base.slice(0, 50);
  }, [valor, sugestoes]);

  // Clique fora fecha. Sem isto a lista ficaria aberta ao clicar noutra linha.
  //
  // A LISTA precisa entrar na conta: ela é renderizada por portal no <body>,
  // então NÃO está dentro de `caixaRef`. Checando só o campo, o clique numa
  // sugestão contava como "fora": a lista desmontava no mousedown e o onClick
  // do item nunca chegava a disparar — o nome não mudava.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (caixaRef.current?.contains(alvo)) return;
      if (listaRef.current?.contains(alvo)) return;
      setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!aberto) return setAberto(true);
      if (filtradas.length === 0) return;
      e.preventDefault();
      const passo = e.key === "ArrowDown" ? 1 : -1;
      setFoco((f) => (f + passo + filtradas.length) % filtradas.length);
    } else if (e.key === "Enter") {
      // Enter só escolhe se a lista está aberta E há item em foco; senão
      // deixa passar, para não sequestrar o texto que a pessoa digitou.
      if (aberto && filtradas[foco]) {
        e.preventDefault();
        onChange(filtradas[foco].name);
        setAberto(false);
      }
    } else if (e.key === "Escape") {
      setAberto(false);
    }
  }

  return (
    <div ref={caixaRef} className="relative w-full">
      <input
        ref={campoRef}
        value={valor}
        onChange={(e) => {
          onChange(e.target.value);
          setAberto(true);
          setFoco(0);
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={teclado}
        placeholder={placeholder}
        maxLength={255}
        autoComplete="off"
        role="combobox"
        aria-expanded={aberto}
        aria-autocomplete="list"
        className="w-full min-w-[180px] rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />

      {aberto && pos && createPortal(
        <div
          ref={listaRef}
          // `fixed` + coordenadas medidas: o portal sai da tabela, então não
          // herda posicionamento nem recorte dela.
          style={{ left: pos.left, top: pos.top, width: pos.width }}
          className="panel-root fixed z-[60] overflow-hidden rounded-xl border border-line-strong bg-raised shadow-panel-hover"
          onMouseDown={(e) => e.preventDefault()} // não tira o foco do campo
        >
          {filtradas.length === 0 ? (
            <p className="px-3 py-3 text-xs text-dim">
              Nenhum produto com esse texto — o que você digitou será usado assim mesmo.
            </p>
          ) : (
            <ul className="max-h-60 overflow-y-auto p-1">
              {filtradas.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setFoco(i)}
                    onClick={() => {
                      onChange(s.name);
                      setAberto(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
                      i === foco ? "bg-hover" : ""
                    }`}
                  >
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb(s.imageUrl, 28)} alt="" className="h-7 w-7 flex-shrink-0 rounded object-cover" />
                    ) : (
                      <span className="h-7 w-7 flex-shrink-0 rounded bg-soft" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-mid">{s.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
