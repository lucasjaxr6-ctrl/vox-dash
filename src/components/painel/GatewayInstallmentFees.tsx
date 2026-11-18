"use client";

import { useEffect, useState } from "react";

// Juros de parcelamento DESTE gateway (1x a 12x + taxa fixa).
//
// Cada gateway cobra uma taxa diferente da adquirente, então a tabela que o
// lojista repassa ao cliente também é por gateway. Ela é usada IDÊNTICA no
// checkout (para mostrar as parcelas) e no servidor (para cobrar) — gross-up:
//   total = (valor + taxa fixa) ÷ (1 − taxa da parcela)
//
// Sem tabela própria, o gateway usa a tabela geral da loja (a antiga, que
// ficava em Formas de Pagamento) ou o padrão da plataforma — e é ela que
// aparece preenchida aqui, para o lojista ver o que está valendo.

const NS = Array.from({ length: 12 }, (_, i) => i + 1); // 1x..12x

function pct(v: number): string {
  // decimal (0.1138) -> "11.38" (sem zeros à toa)
  return (Math.round(v * 1e6) / 1e4).toString();
}
function parsePct(s: string): number | null {
  const t = String(s).replace(",", ".").trim();
  if (t === "") return 0;
  const v = Number(t);
  if (!isFinite(v) || v < 0 || v >= 95) return null;
  return Math.round((v / 100) * 1e6) / 1e6;
}

type Tabela = { rates: Record<string, number>; fixedCents: number };

export default function GatewayInstallmentFees({ gateway, nome }: { gateway: string; nome: string }) {
  const [rates, setRates] = useState<Record<number, string>>({});
  const [fixed, setFixed] = useState("");
  const [propria, setPropria] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function preencher(settings: Record<string, unknown>) {
    const porGateway = (settings?.cardInstallmentFeesByGateway ?? {}) as Record<string, Tabela>;
    const minha = porGateway[gateway];
    const geral = (settings?.cardInstallmentFees ?? {}) as Record<string, number>;
    const r: Record<number, string> = {};
    for (const n of NS) r[n] = pct(Number((minha ? minha.rates[String(n)] : n === 1 ? 0 : geral[String(n)]) ?? 0));
    setRates(r);
    const fixo = minha ? minha.fixedCents : Number(settings?.cardInstallmentFixedCents ?? 299);
    setFixed((fixo / 100).toFixed(2));
    setPropria(Boolean(minha));
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (!res.ok) return;
        const { settings } = await res.json();
        preencher(settings);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateway]);

  async function enviar(corpo: Record<string, unknown>, sucesso: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardInstallmentFeesGateway: { gateway, ...corpo } }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, text: d?.error ?? "Erro ao salvar." });
      preencher(d.settings ?? {});
      setMsg({ ok: true, text: sucesso });
    } catch {
      setMsg({ ok: false, text: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  function salvar() {
    const fees: Record<string, number> = {};
    for (const n of NS) {
      const v = parsePct(rates[n] ?? "");
      if (v === null) return setMsg({ ok: false, text: `Taxa inválida em ${n}x.` });
      fees[String(n)] = v;
    }
    const fixedCents = Math.round(Number(String(fixed).replace(",", ".") || "0") * 100);
    if (!isFinite(fixedCents) || fixedCents < 0) return setMsg({ ok: false, text: "Taxa fixa inválida." });
    enviar({ rates: fees, fixedCents }, "Juros salvos!");
  }

  const inputCls = "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

  return (
    <div className="mt-5 rounded-2xl bg-card p-6">
      <h2 className="text-base font-bold text-hi">Juros de parcelamento</h2>
      <p className="mt-0.5 text-sm text-low">
        Taxa de cada parcela no cartão pela {nome}, repassada ao cliente.{" "}
        {propria ? "Tabela própria deste gateway." : "Usando a tabela padrão. Salve para personalizar."}
      </p>

      {loading ? (
        <div className="mt-4 text-sm text-dim">Carregando…</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {NS.map((n) => (
              <label key={n} className="block">
                <span className="mb-1 block text-xs font-semibold text-mid">Taxa em {n}x (%)</span>
                <input
                  className={inputCls}
                  value={rates[n] ?? ""}
                  onChange={(e) => setRates((r) => ({ ...r, [n]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
            ))}
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-mid">Taxa fixa (R$)</span>
              <input className={inputCls} value={fixed} onChange={(e) => setFixed(e.target.value)} inputMode="decimal" placeholder="2.99" />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={salvar} disabled={busy} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-hover disabled:opacity-50">
              {busy ? "Salvando…" : "Salvar juros"}
            </button>
            {propria && (
              <button
                type="button"
                onClick={() => enviar({ reset: true }, "Voltou para a tabela padrão.")}
                disabled={busy}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-mid transition hover:bg-hover disabled:opacity-50"
              >
                Usar tabela padrão
              </button>
            )}
            {msg && <span className={`text-sm font-medium ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span>}
          </div>
          <p className="mt-3 rounded-lg bg-soft px-3 py-2 text-xs text-low ring-1 ring-line">
            Fórmula: <b>total cobrado = (valor + taxa fixa) ÷ (1 − taxa da parcela)</b>. Parcela com taxa 0% sai sem juros
            (e sem a taxa fixa). Ex.: 12x com 31,89% e R$ 2,99 fixo, num pedido de R$ 100 → o cliente paga ~R$ 151.
          </p>
        </>
      )}
    </div>
  );
}
