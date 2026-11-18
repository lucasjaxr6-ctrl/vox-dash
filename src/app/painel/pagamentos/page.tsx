import PaymentsForm from "@/components/painel/PaymentsForm";
import SmartRouting from "@/components/painel/SmartRouting";

// Os juros de parcelamento saíram daqui: agora são por gateway, na página de
// cada um (GatewayInstallmentFees).
export default function PagamentosPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">Formas de Pagamento</h1>
      <p className="mt-1 text-sm text-low">Conecte os gateways que processam o Pix e o cartão da sua loja.</p>
      <div className="mt-6">
        <PaymentsForm />
      </div>
      {/* Roteamento condicional e Distribuição automática, um modo por vez. */}
      <SmartRouting />
    </div>
  );
}
