import Link from "next/link";
import { query } from "@/lib/db";
import { getActiveStore } from "@/lib/stores";
import { getDomainConfig, isShopifyOrderSyncEnabled } from "@/lib/settings";
import Pagination, { TransicaoLista, AreaPendente } from "@/components/painel/Pagination";
import ReconcileOnMount from "@/components/painel/ReconcileOnMount";
import { orderStatusBadge } from "@/lib/order-status";
import InitialsAvatar from "@/components/painel/InitialsAvatar";
import ContadorTentativas from "@/components/painel/ContadorTentativas";
import ExportarVendas from "@/components/painel/ExportarVendas";

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
function fmtDiaMes(d: Date) {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Todos" },
  { key: "PENDING", label: "Pendentes" },
  { key: "PAID", label: "Pagos" },
  { key: "SHIPPED", label: "Enviados" },
  { key: "CANCELLED", label: "Cancelados" },
];

// Link do WhatsApp (recuperação de venda): número + mensagem já com o link do
// checkout remontado (produtos embutidos) para a pessoa finalizar.
function waLink(phone: string, name: string, store: string, recoveryUrl: string | null) {
  const d = phone.replace(/\D/g, "");
  const intl = d.startsWith("55") ? d : "55" + d;
  let msg = `Olá ${name.split(" ")[0] || ""}, tudo bem? Vi seu pedido na ${store} e quero te ajudar a concluir a compra.`;
  if (recoveryUrl) msg += ` É só finalizar por aqui: ${recoveryUrl}`;
  else msg += " Posso te enviar o Pix?";
  return `https://wa.me/${intl}?text=${encodeURIComponent(msg)}`;
}

export default async function Vendas({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; email?: string }> }) {
  const store = await getActiveStore();
  const { status, page: pageParam, email: emailParam } = await searchParams;
  const active = FILTERS.some((f) => f.key === status) ? (status ?? "") : "";
  const email = (emailParam ?? "").trim().slice(0, 120);

  // Filtro comum às duas consultas (contagem e listagem), para a paginação bater
  // com o que está na tela. O e-mail do pedido de visitante fica em
  // orders.customerEmail; o de cliente logado, em users.email — daí o COALESCE.
  // `cardHiddenBy IS NULL`: tentativas de cartão empilhadas numa recusa mais
  // nova do mesmo cartão saem da lista — a mais nova mostra "Recusado N×".
  const conds = ["o.storeId = ?", "o.cardHiddenBy IS NULL"];
  const params: unknown[] = [store?.id ?? ""];
  if (active) {
    conds.push("o.status = ?");
    params.push(active);
  }
  if (email) {
    // Escapa os curingas do LIKE: quem digitar "%" procura o caractere, não tudo.
    conds.push("COALESCE(u.email, o.customerEmail) LIKE ? ESCAPE '!'");
    params.push(`%${email.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  }
  const where = conds.join(" AND ");

  const listar = (offset: number) =>
    query<any>(
      `SELECT o.id, o.status, o.totalCents, o.createdAt, o.pixRenovadoEm, o.trackingCode, o.paymentMethod, o.cardAttempts,
              COALESCE(u.name, o.customerName) AS userName,
              COALESCE(u.email, o.customerEmail) AS userEmail,
              COALESCE(o.customerPhone, u.phone) AS phone,
              (SELECT GROUP_CONCAT(p.name SEPARATOR ', ')
                 FROM order_items oi JOIN products p ON p.id = oi.productId
                 WHERE oi.orderId = o.id) AS items
       FROM orders o LEFT JOIN users u ON u.id = o.userId
       WHERE ${where}
       -- Pela última atividade: um Pix recuperado hoje sobe para o topo, em vez de
       -- ficar na data em que o pedido nasceu. A Beehive mostra a cobrança nova com a
       -- data do dia, e o lojista procurava a venda aqui e não achava.
       ORDER BY COALESCE(o.pixRenovadoEm, o.createdAt) DESC, o.id DESC LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params,
    );

  // Contagem, página, domínio e Shopify AO MESMO TEMPO. Eram quatro idas ao
  // banco em fila, cada uma esperando a anterior, e cada troca de página
  // pagava a soma: era a demora que fazia o lojista clicar duas, três vezes.
  // A página pedida vai direto para a consulta; só se ela passar do fim
  // (endereço digitado à mão) a lista é refeita com a última página.
  const pedida = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const [contagem, primeiraLista, dom, syncOn] = store
    ? await Promise.all([
        query<{ c: number }>(`SELECT COUNT(*) AS c FROM orders o LEFT JOIN users u ON u.id = o.userId WHERE ${where}`, params),
        listar((pedida - 1) * PAGE_SIZE),
        // Link de recuperação: ?r=<orderId> — o checkout carrega os itens e os
        // dados do cliente já preenchidos. Só existe com domínio próprio verificado.
        getDomainConfig(store.id),
        isShopifyOrderSyncEnabled(store.id),
      ])
    : [[], [], null, true];
  const total = Number(contagem[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(totalPages, pedida);
  const orders = store && page !== pedida ? await listar((page - 1) * PAGE_SIZE) : primeiraLista;

  const storeName = store?.name ?? "nossa loja";

  const checkoutBase = dom?.customDomain && dom.domainVerified ? `https://${dom.customDomain}/checkout` : null;
  const recoveryUrlFor = (orderId: string) => (checkoutBase ? `${checkoutBase}?r=${orderId}` : null);

  // Indicação: envio de pedidos para a Shopify desligado (default é ligado, então
  // só aparece se o lojista desativou de propósito).
  const shopifySyncOff = !syncOn;

  // Filtros que o export herda: os mesmos da lista, sem a página.
  const exportParams = new URLSearchParams();
  if (active) exportParams.set("status", active);
  if (email) exportParams.set("email", email);
  const exportQs = exportParams.toString();

  return (
    <div>
      <ReconcileOnMount />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-hi">Vendas</h1>
          <p className="mt-1 text-sm text-low">Pedidos da sua loja. Recupere vendas pendentes pelo WhatsApp.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shopifySyncOff && (
            <Link
              href="/painel/shopify"
              title="Ativar em Integração Shopify"
              className="inline-flex items-center gap-1.5 rounded-full bg-soft px-3 py-1.5 text-xs font-semibold text-mid ring-1 ring-inset ring-line transition hover:bg-soft"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
              Envio p/ Shopify desativado
            </Link>
          )}
          {/* Os filtros ativos vão junto: baixa-se o que está na tela. */}
          <ExportarVendas total={total} qs={exportQs} />
        </div>
      </div>

      {/* Filtros + busca por e-mail */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const on = active === f.key;
            // Trocar de status preserva a busca em andamento.
            const qs = new URLSearchParams();
            if (f.key) qs.set("status", f.key);
            if (email) qs.set("email", email);
            const search = qs.toString();
            return (
              <Link
                key={f.key || "all"}
                href={search ? `/painel/vendas?${search}` : "/painel/vendas"}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  on ? "bg-brand text-white" : "bg-card text-mid ring-1 ring-line hover:bg-hover"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {/* Form GET puro: a busca fica na URL, então dá para recarregar e
            compartilhar o link. Sem `page`, para sempre cair na primeira. */}
        <form method="get" action="/painel/vendas" className="flex w-full items-center gap-2 sm:w-auto">
          {active && <input type="hidden" name="status" value={active} />}
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dim">
              <IconSearch />
            </span>
            <input
              type="search"
              name="email"
              defaultValue={email}
              placeholder="Buscar por e-mail do cliente"
              maxLength={120}
              autoComplete="off"
              className="w-full rounded-full border border-line sm:w-64 bg-card py-1.5 pl-9 pr-3 text-xs text-hi outline-none placeholder:text-dim focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </div>
          <button
            type="submit"
            className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-hover"
          >
            Buscar
          </button>
          {email && (
            <Link
              href={active ? `/painel/vendas?status=${active}` : "/painel/vendas"}
              className="rounded-full px-2.5 py-1.5 text-xs font-semibold text-low transition hover:text-hi"
            >
              Limpar
            </Link>
          )}
        </form>
      </div>

      {email && (
        <p className="mt-3 text-xs text-low">
          {total === 0 ? "Nenhuma venda" : total === 1 ? "1 venda" : `${total} vendas`} para o e-mail{" "}
          <span className="font-semibold text-mid">{email}</span>
          {active ? <> no filtro <span className="font-semibold text-mid">{FILTERS.find((f) => f.key === active)?.label}</span></> : null}.
        </p>
      )}

      {/* A lista apaga enquanto a página clicada carrega (ver Pagination). */}
      <TransicaoLista>
      <AreaPendente className="mt-4 overflow-hidden rounded-2xl bg-card">
        {orders.length === 0 ? (
          <div className="px-5 py-16 text-center text-sm text-low">
            {email ? "Nenhuma venda para este e-mail." : "Nenhuma venda neste filtro."}
          </div>
        ) : (
          <>
          {/* No celular, uma lista. As colunas de largura fixa da tabela somam
              mais que a tela, e a de Cliente encolhia a zero: o avatar e o
              nome vazavam por cima do status. A linha inteira abre o pedido
              (link esticado); o WhatsApp fica por cima dele. */}
          <ul className="divide-y divide-line md:hidden">
            {orders.map((o) => {
              const st = orderStatusBadge(o.status, o.paymentMethod, { recuperado: !!o.pixRenovadoEm });
              const name = o.userName ?? "Visitante";
              const quando: Date = o.pixRenovadoEm ?? o.createdAt;
              return (
                <li key={o.id} className="relative flex gap-3 px-4 py-3 transition active:bg-hover/60">
                  <InitialsAvatar name={name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/painel/vendas/${o.id}`} className="flex min-w-0 after:absolute after:inset-0">
                        <span className="truncate text-sm font-medium text-hi">{name}</span>
                      </Link>
                      <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-hi">{brl(o.totalCents)}</span>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs text-dim">
                      <span className="truncate">{o.userEmail || ""}</span>
                      <span className="flex-shrink-0 tabular-nums">
                        {fmtDate(quando)} {fmtHora(quando)}
                        {o.pixRenovadoEm && <> · pedido de {fmtDiaMes(o.createdAt)}</>}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${st.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                        <ContadorTentativas n={o.cardAttempts} />
                      </span>
                      {o.phone && (
                        <a
                          href={waLink(o.phone, name, storeName, recoveryUrlFor(o.id))}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Recuperar venda no WhatsApp"
                          aria-label="Recuperar venda no WhatsApp"
                          className="relative z-10 -my-1 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-300"
                        >
                          <IconWhatsApp />
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-low text-[12px] font-medium">
                  <th className="px-4 py-3">Cliente</th>
                  <th className="hidden px-4 py-3 md:table-cell">Produtos</th>
                  {/* w-44: cabe "Cartão recusado" + o contador "3×" lado a lado
                      (com w-32 o contador vazava para a coluna do valor). */}
                  <th className="w-44 px-4 py-3">Status</th>
                  <th className="w-24 px-4 py-3 text-right">Total</th>
                  <th className="w-24 px-4 py-3 text-right">Data</th>
                  <th className="w-24 px-4 py-3 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((o) => {
                  const st = orderStatusBadge(o.status, o.paymentMethod, { recuperado: !!o.pixRenovadoEm });
                  const name = o.userName ?? "Visitante";
                  const quando: Date = o.pixRenovadoEm ?? o.createdAt;
                  return (
                    <tr key={o.id} className="transition hover:bg-hover/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <InitialsAvatar name={name} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-hi">{name}</div>
                            {o.userEmail && <div className="truncate text-xs text-dim">{o.userEmail}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <div className="truncate text-mid" title={o.items || ""}>{o.items || "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${st.cls}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {st.label}
                          </span>
                          <ContadorTentativas n={o.cardAttempts} />
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-hi tabular-nums">{brl(o.totalCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className="text-low">{fmtDate(quando)}</div>
                        <div className="text-xs text-dim">{fmtTime(quando)}</div>
                        {o.pixRenovadoEm && <div className="whitespace-nowrap text-[11px] text-dim">pedido de {fmtDiaMes(o.createdAt)}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-0.5">
                          <Link
                            href={`/painel/vendas/${o.id}`}
                            title="Ver detalhes"
                            aria-label="Ver detalhes"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-dim transition hover:bg-hover hover:text-mid"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </Link>
                          {o.phone && (
                            <a
                              href={waLink(o.phone, name, storeName, recoveryUrlFor(o.id))}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Recuperar venda no WhatsApp"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-emerald-600 transition hover:bg-emerald-500/10 dark:text-emerald-300"
                            >
                              <IconWhatsApp />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </AreaPendente>

      <Pagination
        page={page}
        totalPages={totalPages}
        baseHref="/painel/vendas"
        params={{ ...(active ? { status: active } : {}), ...(email ? { email } : {}) }}
      />
      </TransicaoLista>
    </div>
  );
}

function IconSearch() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

function IconWhatsApp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.45-.15-.64.15-.19.29-.74.93-.9 1.12-.17.19-.33.22-.62.07-.29-.15-1.22-.45-2.32-1.43-.86-.77-1.44-1.72-1.6-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.64-1.55-.88-2.12-.23-.55-.47-.48-.64-.49l-.55-.01c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38 0 1.4 1.02 2.76 1.17 2.95.14.19 2.01 3.08 4.88 4.32.68.29 1.21.47 1.63.6.68.22 1.31.19 1.8.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5A9.44 9.44 0 0 1 18.7 5.3a9.38 9.38 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.42 9.43zM20.52 3.48A11.76 11.76 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.36-1.67a11.8 11.8 0 0 0 5.6 1.43h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.48-8.42z" />
    </svg>
  );
}
