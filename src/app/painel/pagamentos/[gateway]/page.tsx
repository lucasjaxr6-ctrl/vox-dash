import Link from "next/link";
import { notFound } from "next/navigation";
import GatewayForm from "@/components/painel/GatewayForm";
import GatewayLogo from "@/components/painel/GatewayLogo";
import GatewayInstallmentFees from "@/components/painel/GatewayInstallmentFees";
import { getGateway, GATEWAYS_COM_CARTAO } from "@/lib/gateways";

export default async function GatewayPage({ params }: { params: Promise<{ gateway: string }> }) {
  const { gateway } = await params;
  const meta = getGateway(gateway);
  if (!meta) notFound();

  return (
    <div>
      <Link href="/painel/pagamentos" className="inline-flex items-center gap-1.5 text-sm font-semibold text-low transition hover:text-hi">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Formas de Pagamento
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <GatewayLogo gateway={meta} size={48} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-hi">{meta.name}</h1>
          <p className="mt-0.5 text-sm text-low">{meta.subtitle}</p>
        </div>
      </div>

      <div className="mt-6">
        <GatewayForm gateway={meta.key} />
      </div>
      {/* Juros por gateway: cada adquirente cobra uma taxa, então a tabela
          repassada ao cliente é deste gateway (só nos que fazem cartão). */}
      {GATEWAYS_COM_CARTAO.includes(meta.key) && <GatewayInstallmentFees gateway={meta.key} nome={meta.name} />}
    </div>
  );
}
