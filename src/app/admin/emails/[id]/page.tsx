import Link from "next/link";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PLATFORM_STORE_ID, getInboundById, markInboundRead } from "@/lib/inbound";
import { getPlatformEmailStatus } from "@/lib/platform-email";
import { separarResposta, extrairCitacaoHtml } from "@/lib/email-reply";
import EmailBody from "@/components/painel/EmailBody";
import PlatformInboxReply from "@/components/admin/PlatformInboxReply";
import { fmtDateTime } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// Leitura de um e-mail recebido pela Vox. Mesma lógica da caixa do lojista: o
// texto NOVO é separado do histórico citado, porque uma resposta de mil
// caracteres costuma ter uma pergunta de uma linha e o resto é o nosso próprio
// e-mail de volta.
export default async function AdminEmailRecebido({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const [email, cfg] = await Promise.all([
    getInboundById(PLATFORM_STORE_ID, id),
    getPlatformEmailStatus(),
  ]);
  if (!email) notFound();

  // Marcar como lido não pode atrasar a página nem derrubá-la se o banco falhar.
  if (!email.isRead) {
    after(async () => {
      try {
        await markInboundRead(PLATFORM_STORE_ID, id);
      } catch {
        /* silencioso: o ponto de "não lido" é cosmético */
      }
    });
  }

  const { resposta, citado, temCitacao, autorCitado } = separarResposta(email.textBody);
  const remetente = email.fromName || email.fromAddr || "—";

  // Quem escreveu o trecho citado? Pode ser a Vox (resposta a um e-mail nosso)
  // ou a própria pessoa (respondendo a si mesma) — rotular errado seria mentira
  // na tela. A Vox é reconhecida pelo DOMÍNIO, não pelo endereço exato.
  const dominio = (addr: string | null) => (addr || "").toLowerCase().split("@")[1] || "";
  const citadoEhDoRemetente = Boolean(autorCitado) && autorCitado === (email.fromAddr || "").toLowerCase();
  const citadoEhNosso = Boolean(autorCitado) && dominio(autorCitado) === dominio(email.toAddr);
  const tituloCitacao = !temCitacao
    ? "Mensagem"
    : citadoEhNosso
      ? "E-mail que a Vox enviou"
      : citadoEhDoRemetente
        ? `Mensagem anterior de ${remetente}`
        : autorCitado
          ? `Trecho citado — de ${autorCitado}`
          : "Histórico da conversa";

  const citacaoHtml = temCitacao ? extrairCitacaoHtml(email.htmlBody) : null;
  const corpoHtml = temCitacao ? (citacaoHtml ?? email.htmlBody) : email.htmlBody;
  const corpoTexto = temCitacao ? citado || email.textBody : email.textBody;

  return (
    <div className="mx-auto max-w-3xl animate-fade-up pb-6">
      <Link href="/admin/emails" className="inline-flex items-center gap-1.5 text-sm font-semibold text-mid hover:text-hi">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        E-mails
      </Link>

      <header className="mt-4 border-b border-line pb-4">
        <h1 className="text-xl font-bold tracking-tight text-hi">{email.subject || "(sem assunto)"}</h1>
        <p className="mt-1 text-sm text-mid">
          De <b className="text-hi">{remetente}</b>
          {email.fromName && email.fromAddr ? ` <${email.fromAddr}>` : ""}
        </p>
        <p className="mt-0.5 text-xs text-low">
          Para {email.toAddr} · {fmtDateTime(email.receivedAt)}
        </p>
      </header>

      {/* "Resposta" só existe quando houve citação — mensagem original é só
          mensagem, sem bloco de resposta em cima. */}
      {temCitacao && (
        <section className="mt-5 rounded-xl bg-emerald-500/10 p-4">
          <h2 className="text-xs font-bold tracking-normal text-emerald-700 dark:text-emerald-400">Resposta de {remetente}</h2>
          {resposta ? (
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-hi">{resposta}</pre>
          ) : (
            <p className="mt-2 text-sm italic text-low">Respondeu sem escrever nada — só citou o e-mail.</p>
          )}
        </section>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-xs font-bold tracking-normal text-low">{tituloCitacao}</h2>
        <EmailBody html={corpoHtml} text={corpoHtml ? null : corpoTexto} />
      </section>

      {email.fromAddr && (
        <PlatformInboxReply id={email.id} para={remetente} podeResponder={cfg.configurado} />
      )}
    </div>
  );
}
