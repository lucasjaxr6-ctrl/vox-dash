import { getActiveStore } from "@/lib/stores";
import { listInbound } from "@/lib/inbound";
import { listOutbound } from "@/lib/outbound";
import { separarResposta } from "@/lib/email-reply";
import InboxManager, { type InboxItem, type SentItem } from "@/components/painel/InboxManager";

// Caixa de entrada (Resend Inbound): e-mails recebidos + enviados pela loja.
// A configuração do recebimento vive em /painel/emails, junto com o envio.
export default async function CaixaEntrada() {
  const store = await getActiveStore();
  const [rows, outRows] = store
    ? await Promise.all([listInbound(store.id, 100), listOutbound(store.id, 100)])
    : [[], []];

  const emails: InboxItem[] = rows.map((e) => {
    // Prévia = o que a pessoa escreveu. Numa RESPOSTA isso é o texto novo (o
    // assunto é quase sempre "Re: <nosso próprio título>", que não diz nada);
    // numa mensagem original é o corpo dela, que fica em `citado`.
    const { resposta, citado, temCitacao } = separarResposta(e.textBody);
    const preview = (temCitacao ? resposta : citado).replace(/\s+/g, " ").trim();
    return {
      id: e.id,
      fromAddr: e.fromAddr,
      fromName: e.fromName,
      subject: e.subject,
      preview: preview ? preview.slice(0, 140) : null,
      isRead: e.isRead,
      receivedAt: new Date(e.receivedAt).toISOString(),
    };
  });

  const sent: SentItem[] = outRows.map((e) => ({
    id: e.id,
    toAddr: e.toAddr,
    subject: e.subject,
    kind: e.kind,
    createdAt: new Date(e.createdAt).toISOString(),
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-hi">Caixa de entrada</h1>
      <p className="mt-1 text-sm text-low">
        E-mails recebidos no endereço da sua loja (via Resend Inbound) e os que a loja enviou.
      </p>
      <InboxManager emails={emails} sent={sent} />
    </div>
  );
}
