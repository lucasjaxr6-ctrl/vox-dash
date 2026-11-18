import Link from "next/link";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { getDomainConfig } from "@/lib/settings";
import { abandonedCartsSql, ABANDON_AFTER_MINUTES } from "@/lib/abandoned-carts";
import { isEmailKindEnabled } from "@/lib/settings";
import RecoveryEmailButton from "@/components/painel/RecoveryEmailButton";
import Pagination from "@/components/painel/Pagination";
import InitialsAvatar from "@/components/painel/InitialsAvatar";
import { planoDaLoja } from "@/lib/plans";
import { PLANOS } from "@/lib/planos";

const PAGE_SIZE = 10;

function brl(c: number) {
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtHora(d: Date) {
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

// Link do WhatsApp para recuperar o carrinho. Se houver domínio próprio, embute o
// link de recuperação (?r=) para pedidos pendentes; leads recebem só a mensagem.
function waLink(phone: string, name: string, store: string, recoveryUrl: string | null) {
  const d = phone.replace(/\D/g, "");
  const intl = d.startsWith("55") ? d : "55" + d;
  let msg = `Olá ${name.split(" ")[0] || ""}, tudo bem? Vi que você começou uma compra na ${store} e quero te ajudar a finalizar.`;
  if (recoveryUrl) msg += ` É só concluir por aqui: ${recoveryUrl}`;
  else msg += " Posso te enviar o Pix pra concluir?";
  return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
}

type LeadRow = {
  id: string; name: string | null; email: string | null; phone: string | null;
  totalCents: number; itemsJson: string | null; step: number; createdAt: Date; updatedAt: Date;
  /** Quantas vezes este cliente voltou com ESTE mesmo carrinho. */
  tentativas: number;
  /** Hora marcada (ou de envio) do e-mail de recuperação. */
  recoveryEmailAt: Date | null;
  /** Id no Resend enquanto o e-mail ainda está agendado (some ao sair). */
  recoveryEmailId: string | null;
};

type Unified = {
  key: string; kind: "lead"; name: string; email: string | null; phone: string | null;
  totalCents: number; itemsLabel: string; when: Date; recoveryUrl: string | null;
  tentativas: number;
  emailSituacao: "nenhum" | "agendado" | "enviado";
  badge: { label: string; cls: string; dot: string };
};

function leadItemsLabel(itemsJson: string | null): string {
  if (!itemsJson) return "—";
  try {
    const arr = JSON.parse(itemsJson) as { name: string; quantity: number }[];
    if (!Array.isArray(arr) || arr.length === 0) return "—";
    return arr.map((i) => `${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ""}`).join(", ");
  } catch {
    return "—";
  }
}

export default async function Carrinhos({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const store = await getActiveStore();
  const { page: pageParam } = await searchParams;

  // A regra do que é um carrinho abandonado (e o agrupamento por cliente ×
  // carrinho) vive em @/lib/abandoned-carts, compartilhada com o Dashboard.
  //
  // A paginação é feita no BANCO. Antes vinham 300 linhas e o corte era em
  // memória: com 1.487 carrinhos, os mais antigos simplesmente não existiam
  // para a tela, e a última página mentia sobre o total.
  //
  // A janela do histórico é a do plano da conta (45/90/120 dias). Os dados
  // antigos continuam no banco: subir de plano devolve a visão na hora.
  const { plano } = store ? await planoDaLoja(store.id) : { plano: "basic" as const };
  const historicoDias = PLANOS[plano].historicoDias;
  const janela = ` AND ac.updatedAt >= DATE_SUB(NOW(3), INTERVAL ${historicoDias} DAY)`;
  const [totalRow] = store
    ? await query<{ n: number }>(`SELECT COUNT(*) AS n FROM (${abandonedCartsSql(janela)}) t`, [store.id])
    : [{ n: 0 }];
  const total = Number(totalRow?.n ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(totalPages, Math.max(1, parseInt(pageParam || "1", 10) || 1));

  const leads = store
    ? await query<LeadRow>(
        `${abandonedCartsSql(janela)} ORDER BY updatedAt DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
        [store.id],
      )
    : [];

  // Ainda com o checkout aberto: o complemento exato da regra de abandono —
  // não avisou saída (ou avisou e voltou) e continua dando sinal de vida.
  const [andamentoRow] = store
    ? await query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM abandoned_carts ac
          WHERE ac.storeId = ? AND ac.status = 'OPEN'
            AND ac.exitedAt IS NULL
            AND ac.updatedAt > DATE_SUB(NOW(3), INTERVAL ${ABANDON_AFTER_MINUTES} MINUTE)`,
        [store.id],
      )
    : [{ n: 0 }];
  const emAndamento = Number(andamentoRow?.n ?? 0);

  const storeName = store?.name ?? "nossa loja";

  // Link de recuperação (?r=): só com domínio próprio verificado.
  const recuperacaoAtiva = store ? await isEmailKindEnabled(store.id, "recovery") : false;
  const dom = store ? await getDomainConfig(store.id) : null;
  const checkoutBase = dom?.customDomain && dom.domainVerified ? `https://${dom.customDomain}/checkout` : null;

  const rows: Unified[] = [];
  for (const l of leads) {
    rows.push({
      key: `l-${l.id}`,
      kind: "lead",
      name: l.name || "Visitante",
      email: l.email,
      phone: l.phone,
      totalCents: l.totalCents,
      itemsLabel: leadItemsLabel(l.itemsJson),
      when: l.updatedAt ?? l.createdAt,
      recoveryUrl: checkoutBase ? `${checkoutBase}?lead=${l.id}` : null,
      tentativas: Number(l.tentativas ?? 1),
      // Ainda tem id no Resend = marcado e não saiu. Sem id mas com data = já foi.
      emailSituacao: l.recoveryEmailId ? "agendado" : l.recoveryEmailAt ? "enviado" : "nenhum",
      badge:
        l.step >= 2
          ? { label: "Preencheu entrega", cls: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300", dot: "bg-sky-500" }
          : { label: "Só contato", cls: "bg-soft text-mid ring-line", dot: "bg-gray-400" },
    });
  }
  // A ordem já vem do banco (updatedAt DESC), junto com a página certa.
  const pagedRows = rows;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-hi">Carrinhos abandonados</h1>
          <p className="mt-1 text-sm text-low">
            Clientes que preencheram o contato no checkout e não chegaram a gerar cobrança. O mesmo
            cliente aparece uma vez por carrinho — se ele voltar com outro produto, vira uma linha nova.
          </p>
          {/* Quem está no checkout AGORA não é abandono — mas some da tela sem
              explicação, e o lojista vê movimento ao vivo com a lista parada.
              Dizer quantos são e quando entram evita a leitura de "bugou". */}
          <p className="mt-1 text-xs text-dim">
            O carrinho entra na lista <b>assim que o cliente fecha o checkout</b> — ou após{" "}
            {ABANDON_AFTER_MINUTES} minutos de silêncio, quando o navegador não avisa a saída.
            {emAndamento > 0 && (
              <> No momento, <b className="text-mid">{emAndamento}</b>{" "}
              {emAndamento === 1 ? "cliente está" : "clientes estão"} com o checkout aberto e ainda não {emAndamento === 1 ? "conta" : "contam"} como abandono.</>
            )}
          </p>
          <p className="mt-1 text-xs text-dim">
            Histórico dos últimos <b className="text-mid">{historicoDias} dias</b> (plano {PLANOS[plano].nome}).{" "}
            {plano !== "enterprise" && (
              <Link href="/painel/plano" className="font-medium text-brand hover:underline dark:text-brand-bright">
                Ver mais com outro plano
              </Link>
            )}
          </p>
        </div>
        {total > 0 && (
          <span className="rounded-full bg-soft px-3 py-1 text-xs font-semibold text-mid">
            {total} {total === 1 ? "carrinho" : "carrinhos"}
          </span>
        )}
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl bg-card">
        {total === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-low">
            Nenhum carrinho abandonado ainda. Eles aparecem aqui quando um cliente preenche o contato mas não conclui a compra.
          </div>
        ) : (
          <>
          {/* No celular, uma lista: as colunas de largura fixa da tabela somam
              mais que a tela e a de Cliente encolhia a zero (ver Vendas). */}
          <ul className="divide-y divide-line md:hidden">
            {pagedRows.map((r) => (
              <li key={r.key} className="flex gap-3 px-4 py-3">
                <InitialsAvatar name={r.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-hi">{r.name}</span>
                      {r.tentativas > 1 && (
                        <span
                          className="shrink-0 rounded-full bg-soft px-1.5 py-0.5 text-[10px] font-bold text-mid"
                          title={`Voltou ${r.tentativas} vezes com este mesmo carrinho`}
                        >
                          {r.tentativas}×
                        </span>
                      )}
                    </span>
                    <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-hi">
                      {r.totalCents > 0 ? brl(r.totalCents) : "-"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-dim">
                    <span className="truncate">{r.email || ""}</span>
                    <span className="flex-shrink-0 tabular-nums">
                      {fmtDate(r.when)} {fmtHora(r.when)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${r.badge.cls}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${r.badge.dot}`} />
                      {r.badge.label}
                    </span>
                    <span className="-my-1 flex flex-shrink-0 items-center gap-1.5">
                      {r.email && (
                        <RecoveryEmailButton
                          cartId={r.key.replace(/^l-/, "")}
                          temEmail
                          ativo={recuperacaoAtiva}
                          situacao={r.emailSituacao}
                        />
                      )}
                      {r.phone && (
                        <a
                          href={waLink(r.phone, r.name, storeName, r.recoveryUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Recuperar no WhatsApp"
                          aria-label="Recuperar no WhatsApp"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                        >
                          <IconWhatsApp />
                        </a>
                      )}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-low text-[12px] font-medium">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="hidden px-4 py-3 md:table-cell">Produtos</th>
                  <th className="w-36 px-4 py-3">Situação</th>
                  <th className="w-24 px-4 py-3 text-right">Valor</th>
                  <th className="w-24 px-4 py-3 text-right">Quando</th>
                  <th className="w-20 px-4 py-3 text-center">E-mail</th>
                  <th className="w-24 px-4 py-3 text-center">WhatsApp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pagedRows.map((r) => (
                  <tr key={r.key} className="transition hover:bg-hover/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <InitialsAvatar name={r.name} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-hi">{r.name}</span>
                            {/* O agrupamento não pode ESCONDER que a pessoa
                                voltou várias vezes — isso é sinal de interesse
                                e muda como o lojista aborda. */}
                            {r.tentativas > 1 && (
                              <span
                                className="shrink-0 rounded-full bg-soft px-1.5 py-0.5 text-[10px] font-bold text-mid"
                                title={`Voltou ${r.tentativas} vezes com este mesmo carrinho`}
                              >
                                {r.tentativas}×
                              </span>
                            )}
                          </div>
                          {r.email && <div className="truncate text-xs text-dim">{r.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <div className="truncate text-mid" title={r.itemsLabel}>{r.itemsLabel}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${r.badge.cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${r.badge.dot}`} />
                        {r.badge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-hi tabular-nums">
                      {r.totalCents > 0 ? brl(r.totalCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <div className="text-low">{fmtDate(r.when)}</div>
                      <div className="text-xs text-dim">{fmtTime(r.when)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <RecoveryEmailButton
                        cartId={r.key.replace(/^l-/, "")}
                        temEmail={Boolean(r.email)}
                        ativo={recuperacaoAtiva}
                        situacao={r.emailSituacao}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {r.phone ? (
                        <a
                          href={waLink(r.phone, r.name, storeName, r.recoveryUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Recuperar no WhatsApp"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300"
                        >
                          <IconWhatsApp />
                        </a>
                      ) : (
                        <span className="text-xs text-dim">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} baseHref="/painel/carrinhos" />
    </div>
  );
}

function IconWhatsApp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.45-.15-.64.15-.19.29-.74.93-.9 1.12-.17.19-.33.22-.62.07-.29-.15-1.22-.45-2.32-1.43-.86-.77-1.44-1.72-1.6-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.64-1.55-.88-2.12-.23-.55-.47-.48-.64-.49l-.55-.01c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38 0 1.4 1.02 2.76 1.17 2.95.14.19 2.01 3.08 4.88 4.32.68.29 1.21.47 1.63.6.68.22 1.31.19 1.8.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5A9.44 9.44 0 0 1 18.7 5.3a9.38 9.38 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.42 9.43zM20.52 3.48A11.76 11.76 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.36-1.67a11.8 11.8 0 0 0 5.6 1.43h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.48-8.42z" />
    </svg>
  );
}
