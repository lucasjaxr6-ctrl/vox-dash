import Link from "next/link";
import { notFound } from "next/navigation";
import { getTransactionDetail } from "@/lib/admin";
import { brl, fmtDateTime, StatusBadge, METHOD_LABEL } from "@/components/admin/ui";
import TxTabs from "@/components/admin/TxTabs";
import CopyField from "@/components/admin/CopyField";

export const dynamic = "force-dynamic";

/** Número curto do pedido, o mesmo mostrado ao cliente. */
function shortId(id: string) {
  return id.slice(0, 8).toUpperCase();
}
function fmtDoc(d: string | null) {
  const v = (d || "").replace(/\D/g, "");
  if (v.length === 11) return `${v.slice(0, 3)}.${v.slice(3, 6)}.${v.slice(6, 9)}-${v.slice(9)}`;
  if (v.length === 14) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}/${v.slice(8, 12)}-${v.slice(12)}`;
  return d || "—";
}
function fmtPhone(p: string | null) {
  const d = (p || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p || "—";
}
function waHref(p: string | null) {
  const d = (p || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return `https://wa.me/${d.startsWith("55") ? d : "55" + d}`;
}

export default async function TransacaoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getTransactionDetail(id);
  if (!data) notFound();

  const { order: o, items, history } = data;
  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  // Juros do parcelamento não são gravados em coluna própria, mas são o que
  // sobra entre o total cobrado e a composição do pedido. Recuperar o resíduo
  // faz o resumo FECHAR — sem isso, um cartão em 6x mostra produtos R$ 162 e
  // total R$ 189 sem explicar a diferença.
  const juros = o.totalCents - (subtotal + o.shippingCents - o.discountCents);
  const addr = o.address;
  const shopifyUrl =
    o.shopifyOrderId && o.shopifyStoreDomain
      ? `https://${o.shopifyStoreDomain}/admin/orders/${o.shopifyOrderId}`
      : null;
  const paid = o.status === "PAID" || o.status === "SHIPPED";

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
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
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
                        <img src={it.imageUrl} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-line" />
                      ) : (
                        <div className="h-12 w-12 rounded-lg bg-soft" />
                      )}
                    </td>
                    <td className="py-3 pr-3 font-semibold text-hi">{it.name || "Produto removido"}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-mid">{it.quantity}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-mid">{brl(it.unitPriceCents)}</td>
                    <td className="px-3 py-3 text-low">{paid ? "Pago" : o.status === "CANCELLED" ? "Não aprovado" : "Aguardando pagamento"}</td>
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
        <div className="px-5 py-5">
          {o.trackingCode ? (
            <>
              <p className="text-[11px] font-bold tracking-normal text-low">Código de rastreio</p>
              <div className="mt-2 max-w-md">
                <CopyField value={o.trackingCode} />
              </div>
              <a
                href={`https://rastreamento.correios.com.br/app/index.php?objeto=${encodeURIComponent(o.trackingCode)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-[13px] font-semibold text-brand dark:text-brand-bright hover:underline"
              >
                Rastrear nos Correios →
              </a>
              {o.separationEmailSentAt && (
                <p className="mt-4 text-xs text-low">
                  E-mail de separação enviado em {fmtDateTime(o.separationEmailSentAt)}.
                </p>
              )}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-low">Nenhum código de rastreio informado ainda.</p>
          )}
        </div>
      ),
    },
    {
      key: "historico",
      label: "Histórico do cliente",
      content:
        history.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-low">
            Este é o único pedido deste e-mail na plataforma.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                  <th className="px-5 py-3">Pedido</th>
                  <th className="px-3 py-3">Loja</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Valor</th>
                  <th className="px-5 py-3 text-right">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.id} className="transition hover:bg-hover">
                    <td className="px-5 py-3">
                      <Link href={`/admin/transacoes/${h.id}`} className="font-mono text-[12px] font-semibold text-brand dark:text-brand-bright hover:underline">
                        {shortId(h.id)}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-mid">{h.storeName || "—"}</td>
                    <td className="px-3 py-3"><StatusBadge status={h.status} /></td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(h.totalCents)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">{fmtDateTime(h.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
    },
    {
      key: "atribuicao",
      label: "Atribuição",
      content: (
        <div className="space-y-4 px-5 py-5">
          <div>
            <p className="text-[11px] font-bold tracking-normal text-low">Google Ads (gclid)</p>
            {o.gclid ? (
              <div className="mt-2 max-w-xl">
                <CopyField value={o.gclid} />
              </div>
            ) : (
              <p className="mt-1 text-sm text-low">Sem gclid — a visita não veio de um anúncio do Google.</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-bold tracking-normal text-low">IP da compra</p>
            <p className="mt-1 font-mono text-sm text-mid">{o.ip || "—"}</p>
          </div>
          <p className="border-t border-line pt-3 text-xs leading-relaxed text-low">
            O checkout não recebe parâmetros UTM hoje: em 1.126 pedidos nenhum chegou com
            <code className="mx-1 rounded bg-soft px-1">utm_source</code> e afins. O que existe de
            atribuição é o gclid e o IP.
          </p>
        </div>
      ),
    },
    {
      key: "transacoes",
      label: "Transações",
      content: (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="text-left text-[11px] font-semibold tracking-normal text-low">
                <th className="px-5 py-3">Gateway</th>
                <th className="px-3 py-3">ID no gateway</th>
                <th className="px-3 py-3">Método</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3 text-right">Valor</th>
                <th className="px-5 py-3 text-right">Pago em</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-5 py-3 font-semibold text-hi">{o.paymentGateway || "—"}</td>
                <td className="max-w-[220px] truncate px-3 py-3 font-mono text-[12px] text-mid">{o.providerTxnId || "—"}</td>
                <td className="px-3 py-3 text-mid">{o.paymentMethod ? METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod : "—"}</td>
                <td className="px-3 py-3"><StatusBadge status={o.status} /></td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums text-hi">{brl(o.totalCents)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums text-low">
                  {o.paidAt ? fmtDateTime(o.paidAt) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="border-t border-line px-5 py-3 text-xs text-low">
            Uma linha por pedido: cada tentativa de pagamento cria um pedido próprio. Tentativas
            anteriores do mesmo cliente aparecem em <b>Histórico do cliente</b>.
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="animate-fade-up space-y-4">
      {/* Trilha */}
      <nav className="flex items-center gap-2 text-[13px] text-low">
        <Link href="/admin" className="hover:text-mid">Início</Link>
        <span>›</span>
        <Link href="/admin/transacoes" className="hover:text-mid">Transações</Link>
        <span>›</span>
        <span className="font-semibold text-mid">Detalhes</span>
      </nav>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight text-hi">
            Pedido: <span className="font-mono">{shortId(o.id)}</span>
          </h1>
          <span className="text-[13px] text-low">em {fmtDateTime(o.createdAt)}</span>
        </div>
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
      </div>

      {/* Cartão principal */}
      <div className="overflow-hidden rounded-2xl bg-card">
        <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
          <div className="p-5">
            <StatusBadge status={o.status} />

            <div className="mt-5 grid gap-6 sm:grid-cols-3">
              {/* Cliente */}
              <Block title="Cliente">
                <p className="font-bold text-hi">{o.customerName || "Visitante"}</p>
                {waHref(o.customerPhone) ? (
                  <a
                    href={waHref(o.customerPhone)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    <IconWhats />
                    {fmtPhone(o.customerPhone)}
                  </a>
                ) : (
                  <p className="mt-1.5 text-[13px] text-low">Sem telefone</p>
                )}
                <p className="mt-1.5 break-all text-[13px] text-low">{o.customerEmail || "—"}</p>
                <Field label="CPF" value={fmtDoc(o.customerDocument)} />
                <Field label="IP da compra" value={o.ip || "—"} />
                <Field label="Gateway" value={o.paymentGateway || "—"} />
              </Block>

              {/* Pagamento */}
              <Block title="Pagamento">
                <p className="font-bold text-hi">
                  {o.paymentMethod ? METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod : "—"}
                </p>
                {o.pixQrCode && (
                  <div className="mt-2">
                    <CopyField value={o.pixQrCode} />
                  </div>
                )}
                <p className="mt-3 text-[13px] font-semibold text-low">
                  {paid ? "Pago" : o.status === "CANCELLED" ? "Não aprovado" : "Aguardando"}
                </p>
                <p className="text-[15px] font-bold text-hi">{brl(o.totalCents)}</p>
                {o.paidAt && <p className="mt-1 text-xs text-low">em {fmtDateTime(o.paidAt)}</p>}
                {o.pixQrCode && o.pixExpiresAt && !paid && (
                  <p className="mt-1 text-xs text-low">Pix expira em {fmtDateTime(o.pixExpiresAt)}</p>
                )}
              </Block>

              {/* Entrega */}
              <Block title="Entrega">
                {addr ? (
                  <>
                    <p className="font-bold text-hi">{o.customerName || "—"}</p>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-low">
                      {[addr.street, addr.number].filter(Boolean).join(", ")}
                      {addr.complement ? ` — ${addr.complement}` : ""}
                      {addr.neighborhood ? `, ${addr.neighborhood}` : ""}
                    </p>
                    <p className="mt-1 text-[13px] text-low">
                      {[addr.city, addr.uf].filter(Boolean).join(" / ")}
                    </p>
                    {addr.cep && <p className="text-[13px] text-low">CEP: {addr.cep}</p>}
                  </>
                ) : (
                  <p className="text-[13px] text-low">Sem endereço informado.</p>
                )}
                <Field label="Loja" value={o.storeName || "—"} />
              </Block>
            </div>
          </div>

          {/* Resumo de valores */}
          <aside className="border-t border-line bg-soft p-5 lg:border-l lg:border-t-0">
            <h2 className="text-[15px] font-bold text-hi">Resumo</h2>
            <dl className="mt-4 space-y-2.5 text-sm">
              <Total label="Produtos" value={brl(subtotal)} />
              {juros > 0 && <Total label="Juros do parcelamento" value={brl(juros)} />}
              <Total label="Frete" value={brl(o.shippingCents)} />
              <Total label="Desconto" value={o.discountCents > 0 ? `- ${brl(o.discountCents)}` : brl(0)} />
              {juros < 0 && <Total label="Ajuste" value={brl(juros)} />}
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[15px] font-bold text-hi">Valor total</span>
              <span className="text-[20px] font-bold tabular-nums text-hi">{brl(o.totalCents)}</span>
            </div>
          </aside>
        </div>
      </div>

      <TxTabs tabs={tabs} />
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="border-b border-line pb-2 text-[15px] font-bold text-hi">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-1.5 text-[13px] text-low">
      <span className="font-semibold text-mid">{label}:</span> {value}
    </p>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-low">{label}</dt>
      <dd className="tabular-nums text-hi">{value}</dd>
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
