import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";
import { resolveStoreByHost } from "@/lib/stores";
import { getStoreName, getCheckoutTheme } from "@/lib/settings";
import { mergeTheme, corDoSeloSeguro } from "@/lib/checkout-theme";
import { renovarPixSeExpirado } from "@/lib/pix-renew";
import PixPayment from "@/components/checkout/PixPayment";
import CheckoutFooter from "@/components/checkout/CheckoutFooter";
import { CornerStyle, CORNERS_CLASS } from "@/components/checkout/ui";

export const dynamic = "force-dynamic";

// Aba do navegador com o nome da LOJA, não o da plataforma.
export { storeMetadata as generateMetadata } from "@/lib/store-metadata";

// Página de pagamento do Pix. O checkout redireciona para cá logo após gerar o
// Pix, e ela também é o destino do botão do e-mail. Tudo vem do pedido: nada de
// estado carregado do checkout, então recarregar (ou abrir depois pelo e-mail)
// continua funcionando. Escopada por loja (host).
export default async function PixPayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const store = await resolveStoreByHost((await headers()).get("host"));
  if (!store) notFound();
  const { orderId } = await params;

  const rows = await query<{
    status: string;
    totalCents: number;
    pixQrCode: string | null;
    pixQrCodeUrl: string | null;
    createdAt: Date;
  }>(
    `SELECT status, totalCents, pixQrCode, pixQrCodeUrl, createdAt
     FROM orders WHERE id = ? AND storeId = ? AND paymentMethod = 'PIX' LIMIT 1`,
    [orderId, store.id],
  );
  const order = rows[0];
  if (!order || !order.pixQrCode) notFound();

  // PIX VENCIDO: gera outro na hora.
  //
  // O e-mail de recuperação chega 15 min depois de o cliente sair, e ele pode
  // abrir o link horas depois — quando o código já morreu. Sem isto, a
  // recuperação traz a pessoa de volta e entrega uma tela que não paga.
  //
  // A renovação nunca lança: se falhar, seguimos com o código antigo, que é
  // exatamente o que a página mostrava antes.
  const renovado = await renovarPixSeExpirado(store.id, orderId, (await headers()).get("host") ?? "");
  if (renovado) {
    order.pixQrCode = renovado.qrCode;
    order.pixQrCodeUrl = renovado.qrCodeUrl;
    // A contagem na tela parte do `createdAt`; com o código novo, ela precisa
    // partir de AGORA, senão o cliente vê um cronômetro já zerado.
    order.createdAt = new Date();
  }

  const [storeName, rawTheme] = await Promise.all([getStoreName(store.id), getCheckoutTheme(store.id)]);
  const theme = mergeTheme(rawTheme);
  const paid = order.status === "PAID" || order.status === "SHIPPED";

  // A conversão NÃO dispara aqui: ao confirmar, o cliente vai para /obrigado,
  // que é o ponto único de Purchase (evita disparo duplicado e corrida com a
  // navegação). Por isso esta página não carrega os scripts de pixel.
  return (
    // Mesma escala de bordas do checkout: esta tela vem logo na sequência e um
    // canto arredondado aqui, depois de um checkout quadrado, salta aos olhos.
    <div className={`${CORNERS_CLASS} flex min-h-screen flex-col bg-white`} style={{ fontFamily: theme.typography.fontFamily }}>
      <CornerStyle roundness={theme.corners.roundness} />
      <PixPayment
        orderId={orderId}
        code={order.pixQrCode}
        qrCodeUrl={order.pixQrCodeUrl}
        amountCents={Number(order.totalCents)}
        createdAt={new Date(order.createdAt).toISOString()}
        paid={paid}
        storeName={storeName}
        logoUrl={theme.header.logoUrl || null}
        logoHeight={theme.header.logoHeight}
        logoPosition={theme.header.logoPosition}
        primary={theme.colors.primary}
        seloSeguro={corDoSeloSeguro(theme)}
      />
      <CheckoutFooter theme={theme} storeName={storeName} />
    </div>
  );
}
