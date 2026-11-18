import ResendForm from "@/components/painel/ResendForm";
import { getActiveStore } from "@/lib/stores";
import { getInboundAddress, getInboundSecret } from "@/lib/inbound";

export default async function EmailsPage() {
  const store = await getActiveStore();
  // Envio e recebimento são a mesma conta do Resend — o formulário trata os dois.
  const [address, secret] = store
    ? await Promise.all([getInboundAddress(store.id), getInboundSecret(store.id)])
    : [null, null];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">E-mails</h1>
      <p className="mt-1 text-sm text-low">
        E-mails que a loja envia aos clientes e o endereço por onde ela recebe as respostas (via Resend).
      </p>
      <div className="mt-6">
        <ResendForm inboundAddress={address ?? ""} inboundSecretConfigured={Boolean(secret)} />
      </div>
    </div>
  );
}
