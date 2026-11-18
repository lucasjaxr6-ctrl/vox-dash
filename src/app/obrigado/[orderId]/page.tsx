import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";
import { getStoreName, getCheckoutTheme, getActivePixels } from "@/lib/settings";
import { mergeTheme } from "@/lib/checkout-theme";
import { CARD_GENERIC } from "@/lib/customer-errors";
import PixelScripts from "@/components/checkout/PixelScripts";
import PurchasePixel from "@/components/checkout/PurchasePixel";
import ReviewDataButton from "@/components/checkout/ReviewDataButton";
import OrderStatusWatcher from "@/components/checkout/OrderStatusWatcher";
import CheckoutFooter from "@/components/checkout/CheckoutFooter";
import { CornerStyle, CORNERS_CLASS, LinhaDoTopo } from "@/components/checkout/ui";

export const dynamic = "force-dynamic";

// Aba do navegador com o nome da LOJA, não o da plataforma.
export { storeMetadata as generateMetadata } from "@/lib/store-metadata";

function brl(cents: number) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Addr = {
  cep?: string; street?: string; number?: string; neighborhood?: string;
  complement?: string; city?: string; uf?: string;
};

// Página de OBRIGADO. Tudo vem do pedido, então funciona ao recarregar, no
// celular, ou dias depois. Escopada por loja (host).
export default async function ObrigadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  // `erro` carrega o motivo da recusa vindo do checkout (ex.: "CVV inválido"),
  // que só existe na resposta da cobrança — o pedido guarda apenas CANCELLED.
  searchParams: Promise<{ erro?: string }>;
}) {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) notFound();
  const { orderId } = await params;
  const { erro: erroParam } = await searchParams;
  // `erro` vem da URL, então é conteúdo que qualquer um consegue forjar num
  // link. Limitamos tamanho e tiramos quebras de linha para ninguém montar um
  // texto falso na página de um pedido real. O checkout já só manda mensagens
  // aprovadas para o comprador (ver lib/customer-errors).
  const erro = (erroParam || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 160);

  const rows = await query<{
    id: string; status: string; totalCents: number; paymentMethod: string | null;
    customerName: string | null; customerEmail: string | null; customerDocument: string | null;
    customerPhone: string | null; customerAddress: string | null;
    shippingCents: number; discountCents: number;
  }>(
    `SELECT id, status, totalCents, paymentMethod, customerName, customerEmail,
            customerDocument, customerPhone, customerAddress, shippingCents, discountCents
     FROM orders WHERE id = ? AND storeId = ? LIMIT 1`,
    [orderId, store.id],
  );
  const order = rows[0];
  if (!order) notFound();

  const items = await query<{ id: string; name: string; imageUrl: string | null; quantity: number; unitPriceCents: number }>(
    `SELECT p.id AS id, p.name AS name, p.imageUrl AS imageUrl, oi.quantity AS quantity, oi.unitPriceCents AS unitPriceCents
     FROM order_items oi JOIN products p ON p.id = oi.productId
     WHERE oi.orderId = ?`,
    [orderId],
  );

  const [storeName, rawTheme, pixels] = await Promise.all([
    getStoreName(store.id),
    getCheckoutTheme(store.id),
    getActivePixels(store.id),
  ]);
  const theme = mergeTheme(rawTheme);

  // Três estados, direto do status do pedido — nada é inferido do navegador.
  const paid = order.status === "PAID" || order.status === "SHIPPED";
  const refused = order.status === "CANCELLED";
  const analyzing = !paid && !refused; // PENDING
  const subtotal = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const total = Number(order.totalCents);
  const shipping = Number(order.shippingCents ?? 0);
  const discount = Number(order.discountCents ?? 0);
  // O que sobra depois de subtotal − desconto + frete são os juros de
  // parcelamento (só existe no cartão).
  const interest = total - (subtotal - discount + shipping);
  // Pedidos ANTERIORES à gravação da composição não têm frete/desconto: neles só
  // dá para mostrar a diferença, sem afirmar que é frete (seria mentira).
  const legacy = shipping === 0 && discount === 0 && total !== subtotal;

  // Linhas de total montadas UMA vez e reaproveitadas nos dois layouts (lista no
  // mobile, tabela no desktop), para as duas versões não divergirem.
  const totals: { label: string; value: React.ReactNode }[] = legacy
    ? [
        {
          label: total > subtotal ? "Frete e acréscimos" : "Descontos",
          value: total > subtotal ? brl(total - subtotal) : `− ${brl(subtotal - total)}`,
        },
      ]
    : [
        { label: "Subtotal", value: brl(subtotal) },
        {
          label: "Frete",
          value: shipping > 0 ? brl(shipping) : <span className="text-emerald-600">Frete grátis</span>,
        },
        ...(discount > 0 ? [{ label: "Descontos", value: `− ${brl(discount)}` }] : []),
        ...(interest > 0 ? [{ label: "Juros do parcelamento", value: brl(interest) }] : []),
      ];

  let addr: Addr = {};
  try {
    addr = order.customerAddress ? (JSON.parse(order.customerAddress) as Addr) : {};
  } catch {
    addr = {};
  }
  const isCard = order.paymentMethod === "CREDIT_CARD";

  return (
    // Mesma escala de bordas do checkout (Personalizar → Bordas): esta é a
    // última tela do fluxo e destoar aqui entrega que são páginas diferentes.
    <div className={`${CORNERS_CLASS} flex min-h-screen flex-col bg-[#f7f8fa]`} style={{ fontFamily: theme.typography.fontFamily }}>
      <CornerStyle roundness={theme.corners.roundness} />
      <PixelScripts pixels={pixels} pageEvents={false} />
      {paid && (
        <PurchasePixel
          pixels={pixels}
          orderId={order.id}
          amountCents={Number(order.totalCents)}
          items={items.map((i) => ({ id: i.id, name: i.name, priceCents: i.unitPriceCents, quantity: i.quantity }))}
          shippingCents={shipping}
        />
      )}
      {/* Em análise: consulta o gateway até aprovar/recusar e redesenha a tela.
          Não depende do webhook chegar. */}
      {analyzing && (
        <OrderStatusWatcher orderId={order.id} method={isCard ? "CREDIT_CARD" : "PIX"} />
      )}

      {/* Topo */}
      <header className="bg-white">
        <LinhaDoTopo
          posicao={theme.header.logoPosition}
          className="mx-auto w-full max-w-[860px] px-5 py-5"
          marca={
            theme.header.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={theme.header.logoUrl}
                alt={storeName}
                style={{ height: theme.header.logoHeight }}
                className="w-auto max-w-[50%] object-contain"
              />
            ) : (
              <span className="text-2xl font-bold tracking-tight text-gray-800">{storeName}</span>
            )
          }
          direita={
            <div className="flex items-center gap-2 text-gray-700">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <div className="selo-texto leading-tight">
                <div className="text-[11px] font-bold uppercase tracking-wide">Pagamento</div>
                <div className="text-[11px] text-gray-500">100% seguro</div>
              </div>
            </div>
          }
        />
      </header>

      {/* flex-1 empurra o rodapé para o fim da tela mesmo com pouco conteúdo */}
      <main className="mx-auto w-full max-w-[860px] flex-1 space-y-5 px-5 py-6">
        {/* Confirmação — três estados, conforme o status do pedido */}
        <section className="rounded-xl border border-gray-200 bg-white px-5 py-8 text-center sm:px-6">
          <div
            className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px]"
            style={{
              borderColor: paid ? "#0e9f6e" : refused ? "#b91c1c" : "#a16207",
              color: paid ? "#0e9f6e" : refused ? "#b91c1c" : "#a16207",
            }}
          >
            {paid ? (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            ) : refused ? (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            ) : (
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 7v6" /><path d="M12 17h.01" /></svg>
            )}
          </div>

          <h1 className="mt-5 text-[26px] font-bold text-gray-800">
            {paid ? "Pedido confirmado" : refused ? "Pagamento não aprovado" : "Pagamento em análise"}
          </h1>

          {paid && (
            <p className="mx-auto mt-2 max-w-[430px] text-[15px] leading-6 text-gray-600">
              Você receberá em instantes um e-mail
              {order.customerEmail ? <> em <b className="font-semibold">{order.customerEmail}</b></> : null} com os
              detalhes do seu pedido.
            </p>
          )}

          {analyzing && (
            <div className="mx-auto mt-2 max-w-[470px] text-[15px] leading-6 text-gray-600">
              <p className="font-bold text-gray-700">Estamos verificando seus dados.</p>
              <p className="mt-1">
                Fique tranquilo! Assim que recebermos a aprovação do cartão, atualizaremos o status do seu pedido aqui.
                Você também receberá um e-mail com a confirmação.
              </p>
            </div>
          )}

          {refused && (
            <div className="mx-auto mt-2 max-w-[470px] text-[15px] leading-6 text-gray-600">
              <p className="font-bold text-gray-700">Não tem problemas, todos erram..</p>
              <p className="mt-1">{erro || (order.paymentMethod === "CREDIT_CARD" ? CARD_GENERIC : "Analise todos os dados informados para o pagamento.")}</p>
              <ReviewDataButton primary={theme.colors.primary} />
            </div>
          )}
        </section>

        <p className="px-1 text-[14px] text-gray-700">
          Número do pedido: <span className="font-medium">{order.id}</span>
        </p>

        {/* Dados */}
        <section className="grid gap-7 rounded-xl border border-gray-200 bg-white px-5 py-6 sm:grid-cols-3 sm:gap-10 sm:px-6 sm:py-7">
          <div>
            <h2 className="text-[17px] font-bold leading-6 text-gray-800">Dados Pessoais</h2>
            <div className="mt-3 space-y-1 text-[14px] leading-6 text-gray-600">
              {order.customerName && <div>{order.customerName}</div>}
              {order.customerDocument && <div>{order.customerDocument}</div>}
              {order.customerEmail && <div className="break-all">{order.customerEmail}</div>}
              {order.customerPhone && <div>{order.customerPhone}</div>}
            </div>
          </div>

          <div>
            <h2 className="text-[17px] font-bold leading-6 text-gray-800">Endereço do pedido</h2>
            <div className="mt-3 space-y-1 text-[14px] leading-6 text-gray-600">
              {addr.street && (
                <div>
                  {addr.street}
                  {addr.number ? `, ${addr.number}` : ""}
                </div>
              )}
              {addr.complement && <div>{addr.complement}</div>}
              {addr.neighborhood && <div>{addr.neighborhood}</div>}
              {(addr.city || addr.uf) && <div>{[addr.city, addr.uf].filter(Boolean).join("/")}</div>}
              {addr.cep && <div>{addr.cep}</div>}
            </div>
          </div>

          <div>
            <h2 className="text-[17px] font-bold leading-6 text-gray-800">Forma de Pagamento</h2>
            <div className="mt-3 space-y-1 text-[14px] leading-6 text-gray-600">
              <div>{isCard ? "Cartão de crédito" : "Pix"}</div>
              <div className="text-gray-500">
                {paid ? "Pagamento aprovado" : refused ? "Pagamento não aprovado" : "Em análise"}
              </div>
            </div>
          </div>
        </section>

        {/* Resumo */}
        <section className="rounded-xl border border-gray-200 bg-white px-5 py-6 sm:px-6">
          <h2 className="text-[17px] font-bold text-gray-800">Resumo do Pedido</h2>

          {/* MOBILE: lista empilhada. A tabela precisa de ~520px e no celular
              virava scroll horizontal cortando os preços. */}
          <ul className="mt-4 divide-y divide-gray-100 sm:hidden">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-3 py-4">
                {it.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.imageUrl} alt={it.name} className="h-14 w-14 shrink-0 rounded-lg border border-gray-200 object-cover" />
                ) : (
                  <span className="h-14 w-14 shrink-0 rounded-lg bg-gray-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-5 text-gray-700">{it.name}</p>
                  <p className="mt-1 text-[13px] tabular-nums text-gray-500">
                    {it.quantity} × {brl(it.unitPriceCents)}
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap text-[14px] font-medium tabular-nums text-gray-700">
                  {brl(it.unitPriceCents * it.quantity)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="space-y-2.5 border-t border-gray-200 pt-4 text-[14px] sm:hidden">
            {totals.map((t) => (
              <div key={t.label} className="flex items-baseline justify-between gap-4">
                <dt className="text-gray-500">{t.label}</dt>
                <dd className="whitespace-nowrap tabular-nums text-gray-700">{t.value}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-gray-100 pt-2.5 text-[16px] font-bold text-gray-800">
              <dt>Total</dt>
              <dd className="whitespace-nowrap tabular-nums">{brl(total)}</dd>
            </div>
          </dl>

          {/* DESKTOP: tabela com as colunas alinhadas */}
          <div className="mt-5 hidden sm:block">
            <table className="w-full text-[14px]">
              {/* Larguras fixas nas colunas numéricas: sem isso os preços se
                  encostavam ("R$ 179,90R$ 179,90"). */}
              <colgroup>
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 120 }} />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200 text-gray-500">
                  <th className="pb-3 text-left font-normal" />
                  <th className="px-3 pb-3 text-center font-normal">Quantidade</th>
                  <th className="px-3 pb-3 text-right font-normal">Preço Unitário</th>
                  <th className="pb-3 pl-3 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0">
                    <td className="py-5 pr-4">
                      <div className="flex items-center gap-4">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt={it.name} className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
                        ) : (
                          <span className="h-16 w-16 shrink-0 rounded-lg bg-gray-100" />
                        )}
                        <span className="font-medium leading-5 text-gray-700">{it.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-5 text-center tabular-nums text-gray-600">{it.quantity}</td>
                    <td className="whitespace-nowrap px-3 py-5 text-right tabular-nums text-gray-600">
                      {brl(it.unitPriceCents)}
                    </td>
                    <td className="whitespace-nowrap py-5 pl-3 text-right tabular-nums text-gray-700">
                      {brl(it.unitPriceCents * it.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>

              {/* Totais no rodapé DA TABELA: assim os valores caem exatamente
                  sob a coluna "Total" e os rótulos sob "Preço Unitário", em vez
                  de flutuarem num bloco à parte (era o que ficava torto). */}
              <tfoot className="text-[14px]">
                {totals.map((t, i) => (
                  <TotalRow key={t.label} label={t.label} first={i === 0}>
                    {t.value}
                  </TotalRow>
                ))}
                <tr className="text-[16px] font-bold text-gray-800">
                  <td colSpan={2} />
                  <td className="border-t border-gray-200 px-3 pb-1 pt-3 text-right">Total</td>
                  <td className="border-t border-gray-200 pb-1 pl-3 pt-3 text-right tabular-nums">{brl(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </main>

      {/* Mesmo rodapé do checkout */}
      <CheckoutFooter theme={theme} storeName={storeName} />
    </div>
  );
}

/** Linha de total alinhada às colunas da tabela (rótulo sob "Preço Unitário"). */
function TotalRow({
  label,
  first,
  children,
}: {
  label: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  const pad = first ? "pt-4" : "pt-2";
  return (
    <tr className="text-gray-600">
      <td colSpan={2} />
      <td className={`whitespace-nowrap px-3 text-right text-gray-500 ${pad}`}>{label}</td>
      <td className={`whitespace-nowrap pl-3 text-right tabular-nums ${pad}`}>{children}</td>
    </tr>
  );
}
