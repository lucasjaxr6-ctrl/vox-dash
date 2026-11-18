import Link from "next/link";
import { notFound } from "next/navigation";
import { getActiveStore } from "@/lib/stores";
import { getOutboundById } from "@/lib/outbound";
import EmailBody from "@/components/painel/EmailBody";
import { rotuloKind } from "@/lib/email-kinds";

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

// Página de um e-mail ENVIADO. Era um modal com o corpo preso em meia tela —
// os e-mails transacionais são compridos e não cabiam.
export default async function EmailEnviado({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getActiveStore();
  const email = store ? await getOutboundById(store.id, id) : null;
  if (!email) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/painel/emails/caixa" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        Caixa de entrada
      </Link>

      <header className="mt-4 pb-4">
        <h1 className="text-xl font-bold tracking-tight text-hi">{email.subject || "(sem assunto)"}</h1>
        <p className="mt-1 text-sm text-low">
          Para <b className="text-mid">{email.toAddr || "—"}</b>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-dim">
          <span>Enviado · {fmtWhen(email.createdAt)}</span>
          {email.kind && (
            <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-low">
              {rotuloKind(email.kind)}
            </span>
          )}
        </p>
      </header>

      <div className="mt-5 pb-10">
        <EmailBody html={email.htmlBody} text={email.textBody} />
      </div>
    </div>
  );
}
