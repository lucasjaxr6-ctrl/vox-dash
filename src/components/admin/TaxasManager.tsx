"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type Transacao = {
  id: string;
  loja: string | null;
  txnId: string | null;
  amountCents: number;
  status: string;
  feeCount: number;
  criadoEm: string;
  pagoEm: string | null;
};

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Rótulo de cada situação de cobrança, no vocabulário de quem acompanha.
 *
 * "PENDING" vira "Pix gerado" e não "Pendente": o que aconteceu foi a geração
 * do Pix — "pendente" descreveria o pagamento, e confundiria com as taxas
 * pendentes dos cartões acima, que são outra coisa.
 */
const SITUACAO: Record<string, { texto: string; classe: string }> = {
  PENDING: { texto: "Pix gerado", classe: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/20" },
  PAID: { texto: "Pago", classe: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/20" },
  EXPIRED: { texto: "Expirado", classe: "bg-soft text-mid ring-line" },
  CANCELLED: { texto: "Cancelado", classe: "bg-soft text-low ring-line" },
};

/**
 * Taxas padrão da plataforma + movimentação das cobranças.
 *
 * Não há liga/desliga: a cobrança é sempre ativa. A taxa INDIVIDUAL de cada
 * loja também não se edita aqui — ela mora na ficha do lojista, em Usuários.
 */
export default function TaxasManager({
  pct: pctInicial,
  recoveryPct: recInicial,
  transacoes,
}: {
  pct: number;
  recoveryPct: number;
  transacoes: Transacao[];
}) {
  const router = useRouter();
  const [pct, setPct] = useState(String(pctInicial));
  const [rec, setRec] = useState(String(recInicial));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  async function salvarPadrao() {
    setBusy(true);
    setMsg(null);
    const normal = Number(String(pct).replace(",", "."));
    const recup = Number(String(rec).replace(",", "."));
    if (!Number.isFinite(normal) || !Number.isFinite(recup)) {
      setBusy(false);
      return setMsg({ ok: false, texto: "Percentual inválido." });
    }
    try {
      const res = await fetch("/api/admin/platform/fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pct: normal, recoveryPct: recup }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setMsg({ ok: false, texto: data?.error ?? "Erro ao salvar." });
      setMsg({ ok: true, texto: `Taxas salvas: ${num(normal)}% e ${num(recup)}% em recuperadas.` });
      router.refresh();
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  const campo = "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand";

  return (
    <div className="space-y-5">
      <section className="rounded-2xl bg-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-32">
            <span className="mb-1 block text-xs font-semibold text-mid">Taxa padrão</span>
            <div className="relative">
              <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={campo} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-low">
                %
              </span>
            </div>
          </label>

          <label className="block w-40">
            <span className="mb-1 block text-xs font-semibold text-mid">Venda recuperada</span>
            <div className="relative">
              <input value={rec} onChange={(e) => setRec(e.target.value)} inputMode="decimal" className={campo} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-low">
                %
              </span>
            </div>
          </label>

          <button
            onClick={salvarPadrao}
            disabled={busy}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </div>

        <p className="mt-3 max-w-4xl text-xs text-low">
          Valem para toda loja que não tiver taxa própria — a taxa de cada lojista é definida em{" "}
          <Link href="/admin/usuarios" className="font-semibold text-mid underline">
            Usuários
          </Link>
          . A cobrança está sempre ativa: cada venda aprovada gera taxa na hora. Venda recuperada (Pix não pago ou
          carrinho abandonado) paga a taxa de recuperada, pela mesma regra de atribuição de 72h que o painel do
          lojista usa. Estorno e chargeback cancelam a taxa daquela venda.
        </p>
        {msg && (
          <p className={`mt-2 text-xs font-semibold ${msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{msg.texto}</p>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-card">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-bold text-hi">Transações</h2>
          <p className="mt-0.5 text-xs text-low">
            Cobranças geradas pelos lojistas para quitar a taxa. A baixa é automática quando o Pix cai.
          </p>
        </div>

        {transacoes.length === 0 ? (
          <div className="px-5 py-14 text-center text-sm text-low">
            Nenhuma cobrança ainda. Aparece aqui assim que um lojista gerar o Pix da taxa dele.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-2.5">Quando</th>
                  <th className="px-3 py-2.5">Loja</th>
                  <th className="px-3 py-2.5 text-right">Valor</th>
                  <th className="px-3 py-2.5 text-right">Vendas</th>
                  <th className="px-5 py-2.5 text-right">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {transacoes.map((t) => {
                  const s = SITUACAO[t.status] ?? SITUACAO.PENDING;
                  return (
                    <tr key={t.id} className="transition hover:bg-hover">
                      <td className="whitespace-nowrap px-5 py-3 text-low">
                        {t.criadoEm}
                        {t.pagoEm && <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">pago {t.pagoEm}</span>}
                      </td>
                      <td className="px-3 py-3 font-semibold text-hi">{t.loja ?? "(loja removida)"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums text-hi">
                        {brl(t.amountCents)}
                      </td>
                      {/* Quantas taxas entraram nesta cobrança: sem isso o
                          valor é um número solto, sem como conferir a origem. */}
                      <td className="px-3 py-3 text-right tabular-nums text-low">{t.feeCount}</td>
                      <td className="px-5 py-3 text-right">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${s.classe}`}
                        >
                          {s.texto}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
