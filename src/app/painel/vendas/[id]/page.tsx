import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveStore } from "@/lib/stores";
import { getStoreOrderDetail } from "@/lib/order-detail";
import { orderStatusBadge } from "@/lib/order-status";
import OrderTabs from "@/components/painel/OrderTabs";
import TrackingPanel from "@/components/painel/TrackingPanel";
import PixCodeField from "@/components/painel/PixCodeField";
import EditarCliente from "@/components/painel/EditarCliente";
import { thumb } from "@/lib/image";
import { tentativasDoPedido } from "@/lib/card-tentativas";
import ContadorTentativas from "@/components/painel/ContadorTentativas";
import EmailsDoPedido from "@/components/painel/EmailsDoPedido";
import { emailsDoPedido } from "@/lib/emails-do-pedido";
import { GATEWAYS } from "@/lib/gateways";

export const dynamic = "force-dynamic";

function brl(c: number) {
  return (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dt(d: Date | string | null) {
  return d ? new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
}
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
function methodLabel(m: string | null) {
  return m === "CREDIT_CARD" ? "Cartão de crédito" : m === "PIX" ? "Pix" : m === "BOLETO" ? "Boleto" : "—";
}
function fmtDoc(d: string | null) {
  const n = (d || "").replace(/\D/g, "");
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d || "—";
}
function fmtCep(c?: string) {
  const n = (c || "").replace(/\D/g, "");
  return n.length === 8 ? n.replace(/(\d{5})(\d{3})/, "$1-$2") : c || "";
}
function phoneDigits(p: string | null) {
  let d = (p || "").replace(/\D/g, "");
  if (d.length > 11 && d.startsWith("55")) d = d.slice(2);
  return d;
}
function fmtPhone(p: string | null) {
  const d = phoneDigits(p);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return d || "—";
}

export default async function VendaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getActiveStore();
  if (!store) notFound();

  const data = await getStoreOrderDetail(store.id, id);
  if (!data) notFound();

  const { order: o, items, history } = data;
  // Recusas seguidas do mesmo cartão agrupadas neste pedido (ele incluído).
  const [tentativas, mails] = await Promise.all([
    o.cardAttempts > 1 ? tentativasDoPedido(store.id, o.id) : Promise.resolve([]),
    emailsDoPedido(store.id, o.id),
  ]);
  const st = orderStatusBadge(o.status, o.paymentMethod, { recuperado: !!o.pixRenovadoEm });
  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  // Juros do parcelamento não têm coluna: são o que sobra entre o total cobrado
  // e a composição do pedido. Sem essa linha o resumo não fecha em cartão.
  const juros = o.totalCents - (subtotal + o.shippingCents - o.discountCents);
  const paid = o.status === "PAID" || o.status === "SHIPPED";
  const addr = o.address;
  const wa = phoneDigits(o.customerPhone);
  const shopifyUrl =
    o.shopifyOrderId && o.shopifyStoreDomain
      ? `https://${o.shopifyStoreDomain}/admin/orders/${o.shopifyOrderId}`
      : null;

  const tabs = [
    {
      key: "resumo",
      label: "Resumo",
      content:
        items.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-low">Sem itens registrados neste pedido.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="text-left text-low text-[12px] font-medium">
                  <th className="px-5 py-3" colSpan={2}>Produto</th>
                  <th className="px-3 py-3 text-center">Quantidade</th>
                  <th className="px-3 py-3 text-right">Valor unit.</th>
                  <th className="px-3 py-3">Pagamento</th>
                  <th className="px-5 py-3 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="w-16 py-3 pl-5">
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb(it.imageUrl, 48)} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-line" />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-soft" />
                      )}
                    </td>
                    <td className="py-3 pr-3 font-semibold text-hi">{it.name || "Produto removido"}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-mid">{it.quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{brl(it.unitPriceCents)}</td>
                    <td className="px-3 py-3 text-dim">
                      {paid ? "Pago" : o.status === "CANCELLED" ? "Não aprovado" : "Aguardando pagamento"}
                    </td>
                    <td className="px-5 py-3 text-right font-bold tabular-nums text-hi">
                      {brl(it.unitPriceCents * it.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
    },
    {
      key: "rastreamento",
      label: "Rastreamento",
      content: (
        <TrackingPanel
          orderId={o.id}
          initialCode={o.trackingCode}
          canTrack={paid}
          sentAt={o.separationEmailSentAt ? dt(o.separationEmailSentAt) : null}
        />
      ),
    },
    {
      key: "emails",
      label: "E-mails",
      content: (
        <EmailsDoPedido
          orderId={o.id}
          email={mails.email}
          opcoes={mails.opcoes.map((m) => ({ ...m, ultimoEnvio: m.ultimoEnvio ? dt(m.ultimoEnvio) : null, agendadoPara: m.agendadoPara ? dt(m.agendadoPara) : null }))}
          enviados={mails.enviados.map((e) => ({ ...e, quando: dt(e.quando) }))}
        />
      ),
    },
    {
      key: "historico",
      label: "Histórico do cliente",
      content:
        history.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-low">
            Primeiro pedido deste e-mail na sua loja.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-low text-[12px] font-medium">
                  <th className="px-5 py-3">Pedido</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Valor</th>
                  <th className="px-5 py-3 text-right">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => {
                  const hs = orderStatusBadge(h.status, null);
                  return (
                    <tr key={h.id} className="transition hover:bg-hover">
                      <td className="px-5 py-3">
                        <Link href={`/painel/vendas/${h.id}`} className="font-mono text-[12px] font-semibold text-brand hover:underline">
                          {shortId(h.id)}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${hs.cls}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${hs.dot}`} />
                          {hs.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(h.totalCents)}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">{dt(h.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ),
    },
    ...(tentativas.length > 1
      ? [
          {
            key: "tentativas",
            label: `Tentativas (${tentativas.length})`,
            content: (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-low text-[12px] font-medium">
                      <th className="px-5 py-3">Pedido</th>
                      <th className="px-3 py-3">Motivo</th>
                      <th className="px-3 py-3 text-right">Valor</th>
                      <th className="px-5 py-3 text-right">Data</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {tentativas.map((t) => (
                      <tr key={t.id} className="transition hover:bg-hover">
                        <td className="px-5 py-3">
                          <Link href={`/painel/vendas/${t.id}`} className="font-mono text-[12px] font-semibold text-brand hover:underline">
                            {shortId(t.id)}
                          </Link>
                          {t.id === o.id && <span className="ml-2 text-[11px] text-dim">(esta)</span>}
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-3 text-[12.5px] text-mid" title={t.motivo ?? ""}>
                          {t.motivo || "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(t.totalCents)}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">{dt(t.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-5 py-3 text-xs text-dim">
                  Tentativas seguidas com o mesmo cartão. Na lista de vendas elas aparecem como uma linha só.
                </p>
              </div>
            ),
          },
        ]
      : []),
    {
      key: "atribuicao",
      label: "Atribuição",
      content: (
        <div className="space-y-4 px-5 py-5">
          <div>
            <p className="text-low text-[12px] font-medium">Google Ads (gclid)</p>
            <p className="mt-1 break-all font-mono text-[12px] text-mid">
              {o.gclid || "Sem gclid — a visita não veio de um anúncio do Google."}
            </p>
          </div>
          <div>
            <p className="text-low text-[12px] font-medium">IP da compra</p>
            <p className="mt-1 font-mono text-sm text-mid">{o.ip || "—"}</p>
          </div>
          <p className="pt-3 text-xs leading-relaxed text-dim">
            O checkout ainda não recebe parâmetros UTM — o que existe de atribuição é o gclid e o IP.
          </p>
        </div>
      ),
    },
    {
      key: "transacao",
      label: "Transação",
      content: (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left text-low text-[12px] font-medium">
                <th className="px-5 py-3">Gateway</th>
                <th className="px-3 py-3">ID no gateway</th>
                <th className="px-3 py-3">Método</th>
                <th className="px-3 py-3 text-right">Valor</th>
                <th className="px-5 py-3 text-right">Pago em</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-5 py-3 font-semibold text-hi">{o.paymentGateway || "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-3 font-mono text-[12px] text-mid">{o.providerTxnId || "—"}</td>
                <td className="px-3 py-3 text-mid">{methodLabel(o.paymentMethod)}</td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(o.totalCents)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">{dt(o.paidAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Trilha */}
      <nav className="flex items-center gap-2 text-[13px] text-dim">
        <Link href="/painel" className="hover:text-mid">Início</Link>
        <span>›</span>
        <Link href="/painel/vendas" className="hover:text-mid">Vendas</Link>
        <span>›</span>
        <span className="font-semibold text-mid">Detalhes</span>
      </nav>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-hi">
            Pedido: <span className="font-mono">{shortId(o.id)}</span>
          </h1>
          <span className="text-[13px] text-low">em {dt(o.createdAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {shopifyUrl && (
            <a
              href={shopifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[15px] font-bold text-hi transition hover:text-brand"
            >
              Acessar pedido Shopify
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
            </a>
          )}
          <EditarCliente
            orderId={o.id}
            inicial={{
              name: o.customerName || "",
              email: o.customerEmail || "",
              document: o.customerDocument || "",
              phone: phoneDigits(o.customerPhone),
              address: addr,
            }}
          />
        </div>
      </div>

      {/* Cartão principal */}
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
          <div className="p-5">
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${st.cls}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
              <ContadorTentativas n={o.cardAttempts} />
            </span>
            {o.cardHiddenBy && (
              <p className="mt-2 text-xs text-low">
                Tentativa agrupada: o cliente tentou de novo com o mesmo cartão. Ver a mais recente em{" "}
                <Link href={`/painel/vendas/${o.cardHiddenBy}`} className="font-mono font-semibold text-brand hover:underline">
                  {shortId(o.cardHiddenBy)}
                </Link>
                .
              </p>
            )}

            <div className="mt-5 grid gap-6 sm:grid-cols-3">
              <Block title="Cliente">
                <p className="font-bold text-hi">{o.customerName || "Visitante"}</p>
                {wa.length >= 10 ? (
                  <a
                    href={`https://wa.me/55${wa}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-emerald-600 hover:underline"
                  >
                    <IconWhats />
                    {fmtPhone(o.customerPhone)}
                  </a>
                ) : (
                  <p className="mt-1.5 text-[13px] text-dim">Sem telefone</p>
                )}
                <p className="mt-1.5 break-all text-[13px] text-low">{o.customerEmail || "—"}</p>
                <Field label="CPF" value={fmtDoc(o.customerDocument)} />
                <Field label="IP da compra" value={o.ip || "—"} />
                <Field label="Gateway" value={o.paymentGateway || "—"} />
              </Block>

              <Block title="Pagamento">
                <p className="font-bold text-hi">{methodLabel(o.paymentMethod)}</p>
                {/* Cartão MASCARADO — o número inteiro e o CVV nunca são gravados. */}
                {o.card && (
                  <div className="mt-2 space-y-0.5">
                    {o.card.brand && <Field label="Bandeira" value={o.card.brand} />}
                    {o.card.bin && <Field label="Primeiros dígitos" value={o.card.bin} />}
                    {o.card.last4 && <Field label="Últimos dígitos" value={o.card.last4} />}
                    {o.card.exp && <Field label="Validade" value={o.card.exp} />}
                    {o.card.holder && <Field label="Titular" value={o.card.holder} />}
                  </div>
                )}
                {o.pixQrCode && (
                  <div className="mt-2">
                    <PixCodeField code={o.pixQrCode} />
                  </div>
                )}
                <p className="mt-3 text-[13px] font-semibold text-low">
                  {paid ? "Pago" : o.status === "CANCELLED" ? "Não aprovado" : "Aguardando"}
                </p>
                <p className="text-[15px] font-bold text-hi">{brl(o.totalCents)}</p>
                {o.paidAt && <p className="mt-1 text-xs text-dim">em {dt(o.paidAt)}</p>}
                {o.pixRenovadoEm && <p className="mt-1 text-xs text-dim">Pix recuperado em {dt(o.pixRenovadoEm)}</p>}
                {o.pixQrCode && o.pixExpiresAt && !paid && (
                  <p className="mt-1 text-xs text-dim">Pix expira em {dt(o.pixExpiresAt)}</p>
                )}

                {/* Sem isto, o gateway principal poderia ficar semanas falhando sem o
                    lojista perceber, porque a venda sai pela reserva. */}
                {o.retentativas.length > 0 && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-2.5 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/25">
                    <p className="text-[12px] font-medium text-amber-800 dark:text-amber-400">Retentativa de Pix</p>
                    <ul className="mt-1 space-y-1">
                      {o.retentativas.map((t, i) => (
                        <li key={i} className="break-words text-[11.5px] leading-snug text-amber-900 dark:text-amber-200">
                          <b className="font-semibold">{GATEWAYS.find((g) => g.key === t.gateway)?.name ?? t.gateway}</b> falhou: {t.motivo || "sem detalhe"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* MOTIVO DA RECUSA — só para o lojista.
                    O comprador recebe a mensagem tratada por `safeCardMessage`,
                    que nunca cita gateway, antifraude ou estado da conta. */}
                {o.declineReason && (
                  <div className="mt-3 rounded-lg bg-rose-50 p-2.5 ring-1 ring-inset ring-rose-200 dark:bg-rose-500/10 dark:ring-rose-500/25">
                    <p className="text-rose-700 dark:text-rose-400 text-[12px] font-medium">
                      Motivo da recusa
                    </p>
                    <p className="mt-1 text-[12.5px] font-medium text-rose-900 dark:text-rose-200">
                      {o.declineReason.resumo}
                    </p>
                    {o.declineReason.detalhe && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                          Detalhe técnico
                        </summary>
                        <p className="mt-1 break-all font-mono text-[10.5px] leading-relaxed text-rose-800 dark:text-rose-300">
                          {o.declineReason.detalhe}
                        </p>
                      </details>
                    )}
                    <p className="mt-1.5 text-[10.5px] text-rose-700/80 dark:text-rose-400/80">
                      Visível só para você.
                    </p>
                  </div>
                )}
              </Block>

              <Block title="Entrega">
                {addr ? (
                  <>
                    <p className="font-bold text-hi">{o.customerName || "—"}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-low">
                      {[addr.street, addr.number].filter(Boolean).join(", ")}
                      {addr.complement ? ` — ${addr.complement}` : ""}
                      {addr.neighborhood ? `, ${addr.neighborhood}` : ""}
                    </p>
                    <p className="mt-1 text-[13px] text-low">{[addr.city, addr.uf].filter(Boolean).join(" / ")}</p>
                    {addr.cep && <p className="text-[13px] text-low">CEP: {fmtCep(addr.cep)}</p>}
                  </>
                ) : (
                  <p className="text-[13px] text-dim">Sem endereço informado.</p>
                )}
                {o.trackingCode && <Field label="Rastreio" value={o.trackingCode} />}
              </Block>
            </div>
          </div>

          <aside className="p-5 lg:pl-3">
            <h2 className="text-[15px] font-bold text-hi">Resumo</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Total label="Produtos" value={brl(subtotal)} />
              {juros > 0 && <Total label="Juros do parcelamento" value={brl(juros)} />}
              <Total label="Frete" value={brl(o.shippingCents)} />
              <Total label="Desconto" value={o.discountCents > 0 ? `- ${brl(o.discountCents)}` : brl(0)} />
              {juros < 0 && <Total label="Ajuste" value={brl(juros)} />}
            </dl>
            <div className="mt-5 flex items-baseline justify-between">
              <span className="text-[15px] font-bold text-hi">Valor total</span>
              <span className="text-[20px] font-bold tabular-nums text-hi">{brl(o.totalCents)}</span>
            </div>
          </aside>
        </div>
      </div>

      <OrderTabs tabs={tabs} />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="pb-2 text-[15px] font-bold text-hi">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1.5 break-all text-[13px] text-low">
      <span className="font-semibold text-mid">{label}:</span> {value}
    </p>
  );
}
function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-low">{label}</dt>
      <dd className="tabular-nums text-mid">{value}</dd>
    </div>
  );
}
function IconWhats() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.45-.15-.64.15-.19.29-.74.93-.9 1.12-.17.19-.33.22-.62.07-.29-.15-1.22-.45-2.32-1.43-.86-.77-1.44-1.72-1.6-2-.17-.29-.02-.45.13-.6.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.15-.64-1.55-.88-2.12-.23-.55-.47-.48-.64-.49l-.55-.01c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38 0 1.4 1.02 2.76 1.17 2.95.14.19 2.01 3.08 4.88 4.32.68.29 1.21.47 1.63.6.68.22 1.31.19 1.8.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.79-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.38 9.38 0 0 1-1.44-5A9.44 9.44 0 0 1 18.7 5.3a9.38 9.38 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.42 9.43zM20.52 3.48A11.76 11.76 0 0 0 12.04 0C5.5 0 .18 5.32.18 11.86c0 2.09.55 4.13 1.59 5.93L.08 24l6.36-1.67a11.8 11.8 0 0 0 5.6 1.43h.01c6.54 0 11.86-5.32 11.86-11.86 0-3.17-1.24-6.15-3.48-8.42z" />
    </svg>
  );
}
