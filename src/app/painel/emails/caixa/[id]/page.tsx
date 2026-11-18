import Link from "next/link";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { getActiveStore } from "@/lib/stores";
import { getInboundById, markInboundRead } from "@/lib/inbound";
import { separarResposta, extrairCitacaoHtml } from "@/lib/email-reply";
import EmailBody from "@/components/painel/EmailBody";
import InboxReply from "@/components/painel/InboxReply";

export const dynamic = "force-dynamic";

function fmtWhen(d: Date) {
  return new Date(d).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Página de um e-mail RECEBIDO.
//
// Duas coisas mudaram em relação ao modal antigo, pelo mesmo motivo — o lojista
// não conseguia ver o que a pessoa escreveu:
//
// 1. O corpo é renderizado em HTML (como no enviado), não mais como o texto cru
//    com ">" na frente de cada linha.
// 2. O texto NOVO da pessoa é extraído e mostrado destacado. Numa amostra real
//    da caixa, uma resposta de 1.003 caracteres virava "Qual é a data de
//    entrega do produto?" — o resto era o e-mail da própria loja, citado.
export default async function EmailRecebido({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getActiveStore();
  const email = store ? await getInboundById(store.id, id) : null;
  if (!email) notFound();

  // Marcar como lido não pode atrasar a página nem derrubá-la se o banco falhar.
  if (!email.isRead && store) {
    after(async () => {
      try {
        await markInboundRead(store.id, id);
      } catch {
        /* silencioso: o badge de não lido é cosmético */
      }
    });
  }

  const { resposta, citado, temCitacao, autorCitado } = separarResposta(email.textBody);
  const remetente = email.fromName || email.fromAddr || "—";

  // Quem escreveu o trecho citado? Nem sempre é a loja: o cliente pode
  // responder a uma mensagem que ele mesmo mandou, e rotular aquilo como
  // "e-mail que a loja enviou" seria mentira na tela.
  //
  // A loja é reconhecida pelo DOMÍNIO, não pelo endereço: recebemos em
  // contato@loja.com e enviamos de noreply@loja.com.
  const dominio = (addr: string | null) => (addr || "").toLowerCase().split("@")[1] || "";
  const citadoEhDoCliente = Boolean(autorCitado) && autorCitado === (email.fromAddr || "").toLowerCase();
  const citadoEhDaLoja = Boolean(autorCitado) && dominio(autorCitado) === dominio(email.toAddr);
  const tituloCitacao = !temCitacao
    ? "Mensagem"
    : citadoEhDaLoja
      ? "E-mail que a loja enviou"
      : citadoEhDoCliente
        ? `Mensagem anterior de ${remetente}`
        : autorCitado
          ? `Trecho citado — de ${autorCitado}`
          : "Histórico da conversa";

  // Numa resposta, o corpo a exibir é só a CITAÇÃO. Se não der para recortá-la
  // do HTML (cliente de e-mail sem marcador conhecido), cai no HTML inteiro —
  // feio é melhor que vazio. Sem citação, o corpo é o e-mail todo mesmo.
  const citacaoHtml = temCitacao ? extrairCitacaoHtml(email.htmlBody) : null;
  const corpoHtml = temCitacao ? (citacaoHtml ?? email.htmlBody) : email.htmlBody;
  const corpoTexto = temCitacao ? citado || email.textBody : email.textBody;

  return (
    <div className="mx-auto max-w-3xl pb-10">
      <Link href="/painel/emails/caixa" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Caixa de entrada
      </Link>

      <header className="mt-4 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-hi">{email.subject || "(sem assunto)"}</h1>
        <p className="mt-1 text-sm text-low">
          De <b className="text-mid">{remetente}</b>
          {email.fromName && email.fromAddr ? ` <${email.fromAddr}>` : ""}
        </p>
        <p className="mt-0.5 text-xs text-dim">
          Para {email.toAddr} · {fmtWhen(email.receivedAt)}
        </p>
      </header>

      {/* "Resposta" SÓ existe quando a pessoa respondeu um e-mail nosso, ou
          seja, quando há citação. Mensagem original é só mensagem. */}
      {temCitacao && (
        <section className="mt-5 rounded-xl bg-brand/[0.07] p-4">
          <h2 className="text-[13px] font-semibold text-brand dark:text-brand-bright">Resposta do cliente</h2>
          {resposta ? (
            <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-hi">{resposta}</pre>
          ) : (
            <p className="mt-2 text-sm italic text-dim">A pessoa respondeu sem escrever nada — só citou o e-mail.</p>
          )}
        </section>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-low text-[12px] font-medium">{tituloCitacao}</h2>
        {/* Numa resposta, mostra só o trecho CITADO — assim o e-mail aparece
            formatado como na aba Enviados, sem repetir em cima o texto que a
            pessoa escreveu (já destacado acima). */}
        <EmailBody html={corpoHtml} text={corpoHtml ? null : corpoTexto} />
      </section>

      {email.fromAddr && <InboxReply id={email.id} para={remetente} />}
    </div>
  );
}
