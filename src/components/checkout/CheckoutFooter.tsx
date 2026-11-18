import { LockBadge, DadosDaEmpresa, PaymentBrands } from "@/components/checkout/ui";
import { corDoSeloSeguro, type Theme } from "@/lib/checkout-theme";

/**
 * Rodapé do checkout, reaproveitado nas páginas de pagamento e de pedido para
 * elas não parecerem "soltas" do site. Usa o texto e o selo que a loja
 * configurou em Personalizar.
 */
export default function CheckoutFooter({ theme, storeName }: { theme: Theme; storeName: string }) {
  return (
    <footer className="border-t border-gray-100 bg-gray-50 py-10">
      <div className="mx-auto max-w-3xl px-4 text-center text-sm text-gray-400">
        <p className="font-semibold text-gray-500">
          {theme.footer.text && theme.footer.text !== "Checkout — Todos os direitos reservados"
            ? theme.footer.text
            : `${storeName} — Todos os direitos reservados`}
        </p>
        <p className="mt-2">
          © {new Date().getFullYear()} {storeName}
        </p>
        <DadosDaEmpresa footer={theme.footer} className="mt-3" />
        <p className="mt-6 font-medium text-gray-400">Formas de pagamento:</p>
        <div className="mt-3">
          <PaymentBrands />
        </div>
        {theme.footer.showSecureBadge && (
          <div className="mt-6 flex justify-center">
            <LockBadge color={corDoSeloSeguro(theme)} />
          </div>
        )}
      </div>
    </footer>
  );
}
