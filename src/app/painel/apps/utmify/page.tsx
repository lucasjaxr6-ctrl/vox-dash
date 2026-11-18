import Link from "next/link";
import UtmifyForm from "@/components/painel/UtmifyForm";

export default function UtmifyPage() {
  return (
    <div>
      <Link href="/painel/apps" className="inline-flex items-center gap-1.5 text-sm font-semibold text-low transition hover:text-hi">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Apps
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-800 to-black text-base font-black text-white">
          U
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-hi">Utmify</h1>
          <p className="mt-0.5 text-sm text-low">Rastreamento de UTMs e atribuição de vendas.</p>
        </div>
      </div>

      <div className="mt-6">
        <UtmifyForm />
      </div>
    </div>
  );
}
