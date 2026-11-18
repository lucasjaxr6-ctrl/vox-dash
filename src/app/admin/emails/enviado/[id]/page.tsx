import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { PLATFORM_STORE_ID } from "@/lib/inbound";
import { getOutboundById } from "@/lib/outbound";
import { rotuloKind } from "@/lib/email-kinds";
import EmailBody from "@/components/painel/EmailBody";
import { fmtDateTime } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// E-mail ENVIADO pela Vox — em página inteira, não em modal: o corpo de um
// e-mail transacional não cabe em meia tela.
export default async function AdminEmailEnviado({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const email = await getOutboundById(PLATFORM_STORE_ID, id);
  if (!email) notFound();

  return (
    <div className="mx-auto max-w-3xl animate-fade-up pb-6">
      <Link href="/admin/emails?aba=enviados" className="inline-flex items-center gap-1.5 text-sm font-semibold text-mid hover:text-hi">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
        E-mails
      </Link>

      <header className="mt-4 border-b border-line pb-4">
        <h1 className="text-xl font-bold tracking-tight text-hi">{email.subject || "(sem assunto)"}</h1>
        <p className="mt-1 text-sm text-mid">
          Para <b className="text-hi">{email.toAddr || "—"}</b>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-low">
          <span>Enviado · {fmtDateTime(email.createdAt)}</span>
          {email.kind && (
            <span className="rounded bg-soft px-1.5 py-0.5 text-[10px] font-bold text-mid">
              {rotuloKind(email.kind)}
            </span>
          )}
        </p>
      </header>

      <div className="mt-5">
        <EmailBody html={email.htmlBody} text={email.textBody} />
      </div>
    </div>
  );
}
