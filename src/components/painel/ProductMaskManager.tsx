"use client";

import React, { useState } from "react";
import MascaraInput from "@/components/painel/MascaraInput";
import { thumb } from "@/lib/image";

type P = { id: string; name: string; maskedName: string | null; imageUrl: string | null };

export default function ProductMaskManager({ products }: { products: P[] }) {
  const initial = () => Object.fromEntries(products.map((p) => [p.id, p.maskedName ?? ""]));
  const [masks, setMasks] = useState<Record<string, string>>(initial);
  const [baseline, setBaseline] = useState<Record<string, string>>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [soPendentes, setSoPendentes] = useState(false);

  const dirtyIds = products
    .filter((p) => (masks[p.id] ?? "").trim() !== (baseline[p.id] ?? "").trim())
    .map((p) => p.id);

  // Sem máscara = manda o nome REAL ao gateway. É o que a faixa conta e o que
  // o filtro mostra.
  const semMascara = products.filter((p) => !(masks[p.id] ?? "").trim());

  // PENDENTE = sem máscara. Só isso.
  //
  // O filtro antes também trazia os "nomes repetidos", e por isso não filtrava
  // nada: as máscaras costumam ser nomes reais de OUTROS produtos da mesma
  // loja, então todo produto mascarado casava na regra e a lista vinha
  // inteira — 148 de 148 na Della Decor.
  //
  // O alerta de nome repetido também saiu: ele descrevia o SKU derivado do
  // NOME, que fazia dois produtos virarem um só no catálogo da Appmax. O SKU
  // hoje vem do id do produto (ver `skuFromProductId`), então nomes iguais não
  // colidem mais. O aviso avisava de um problema que não existe.
  const visiveis = soPendentes ? semMascara : products;

  async function saveAll() {
    if (dirtyIds.length === 0) return;
    setSaving(true);
    setMsg(null);
    try {
      const results = await Promise.all(
        dirtyIds.map((id) =>
          fetch("/api/painel/product-masks", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: id, maskedName: masks[id] }),
          }).then((r) => r.ok),
        ),
      );
      const failed = results.filter((ok) => !ok).length;
      // Atualiza o baseline dos que salvaram (limpa o "modificado").
      setBaseline((b) => {
        const nb = { ...b };
        dirtyIds.forEach((id, i) => { if (results[i]) nb[id] = masks[id] ?? ""; });
        return nb;
      });
      setMsg(failed === 0 ? { ok: true, text: "Alterações salvas!" } : { ok: false, text: `${failed} não salvaram. Tente de novo.` });
    } catch {
      setMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setSaving(false);
    }
  }

  if (products.length === 0) {
    return (
      <div className="mt-6 rounded-xl bg-card p-10 text-center text-sm text-low">
        Nenhum produto ativo. Sincronize sua Shopify em <b>Produtos</b> primeiro.
      </div>
    );
  }

  return (
    <div className="mt-6">
      {/* Barra de ação — SEMPRE visível */}
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-sm">
        <span className="text-sm text-mid">
          {dirtyIds.length > 0 ? (
            <><b className="text-hi">{dirtyIds.length}</b> alteração{dirtyIds.length > 1 ? "ões" : ""} não salva{dirtyIds.length > 1 ? "s" : ""}</>
          ) : (
            "Nenhuma alteração pendente"
          )}
        </span>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-xs font-semibold ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
          <button
            onClick={saveAll}
            disabled={saving || dirtyIds.length === 0}
            className="rounded-lg bg-brand px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>

      {semMascara.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-amber-900 dark:text-amber-200">
              <b>{semMascara.length}</b> de {products.length} produtos ainda enviam o <b>nome real</b> ao gateway.
            </p>
            <button
              onClick={() => setSoPendentes((v) => !v)}
              className="flex-shrink-0 rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20"
            >
              {soPendentes ? "Mostrar todos" : "Ver só os pendentes"}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-low text-[12px] font-medium">
              <tr>
                <th className="px-4 py-3">Produto original</th>
                <th className="px-4 py-3">Nome mascarado (enviado ao gateway)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visiveis.map((p) => {
                const value = masks[p.id] ?? "";
                const isDirty = value.trim() !== (baseline[p.id] ?? "").trim();
                const willSend = value.trim() || p.name;
                return (
                  <tr key={p.id} className="align-middle">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb(p.imageUrl, 36)} alt="" className="h-9 w-9 flex-shrink-0 rounded object-cover" />
                        ) : (
                          <div className="h-9 w-9 flex-shrink-0 rounded bg-soft" />
                        )}
                        <span className="font-medium text-hi">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MascaraInput
                          valor={value}
                          onChange={(v) => setMasks((m) => ({ ...m, [p.id]: v }))}
                          // O próprio produto fica de fora: mascarar com o
                          // próprio nome não esconde nada.
                          sugestoes={products.filter((o) => o.id !== p.id)}
                          placeholder={`Padrão: ${p.name}`}
                        />
                        {isDirty && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-amber-400" title="Não salvo" />}
                      </div>
                      <p className="mt-1 truncate text-xs text-dim">
                        Vai para o gateway como: <b className="text-mid">{willSend}</b>
                        {!value.trim() && (
                          <span className="font-semibold text-amber-700 dark:text-amber-400"> — nome real, sem máscara</span>
                        )}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
