import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { PLATFORM_STORE_ID, listInbound, searchInbound } from "@/lib/inbound";
import { listOutbound, searchOutbound } from "@/lib/outbound";
import { getPlatformEmailStatus } from "@/lib/platform-email";
import { separarResposta } from "@/lib/email-reply";
import { rotuloKind } from "@/lib/email-kinds";
import { WEBHOOK_INBOUND } from "@/lib/plataforma";
import { sincronizarCaixaPlataforma } from "@/lib/platform-inbox";
import SyncInbox from "@/components/admin/SyncInbox";
import { PageHeader, Panel, EmptyState, fmtDateTime } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

// Caixa de entrada da PLATAFORMA (Vox).
//
// Mesmas tabelas das lojas, com o storeId reservado — a nota está em
// lib/inbound.ts. Aqui a tela é servidor puro: o volume é de uma conta só,
// então paginar ou filtrar no cliente não se justifica.

export default async function AdminEmails({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; q?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const enviados = sp.aba === "enviados";
  const termo = (sp.q ?? "").trim();

  // Puxa da Resend antes de listar. O webhook pode não ter entregue (evento
  // errado no endpoint, segredo trocado, deploy fora do ar) e nesse caso o
  // e-mail existe lá e não aqui — ver a nota em lib/platform-inbox.ts.
  const sync = await sincronizarCaixaPlataforma();

  const [cfg, recebidos, saidas] = await Promise.all([
    getPlatformEmailStatus(),
    termo ? searchInbound(PLATFORM_STORE_ID, termo, 100) : listInbound(PLATFORM_STORE_ID, 100),
    termo ? searchOutbound(PLATFORM_STORE_ID, termo, 100) : listOutbound(PLATFORM_STORE_ID, 100),
  ]);
  const naoLidos = recebidos.filter((e) => !e.isRead).length;

  const aba = (destino: boolean) => {
    const p = new URLSearchParams();
    if (destino) p.set("aba", "enviados");
    if (termo) p.set("q", termo);
    const qs = p.toString();
    return qs ? `/admin/emails?${qs}` : "/admin/emails";
  };

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="E-mails"
        subtitle={
          cfg.inboundEmail
            ? `Recebendo em ${cfg.inboundEmail} — e em qualquer endereço do mesmo domínio.`
            : "Defina o endereço de recebimento em Configurações para começar a receber."
        }
        right={<SyncInbox />}
      />

      {sync.erro && cfg.configurado && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          Não consegui buscar na Resend: {sync.erro}
        </div>
      )}

      {!cfg.inboundEmail && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          Nenhum endereço de recebimento configurado — nada chega aqui ainda. Preencha em{" "}
          <Link href="/admin/configuracoes" className="font-semibold underline">
            Configurações › E-mail da Vox
          </Link>{" "}
          e aponte o webhook Inbound do Resend para{" "}
          <code className="rounded bg-amber-500/10 px-1 py-0.5">{WEBHOOK_INBOUND}</code>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-xl border border-line bg-card p-1">
          <Link
            href={aba(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              !enviados ? "bg-brand text-white" : "text-mid hover:bg-hover"
            }`}
          >
            Recebidos{naoLidos > 0 ? ` · ${naoLidos}` : ""}
          </Link>
          <Link
            href={aba(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
              enviados ? "bg-brand text-white" : "text-mid hover:bg-hover"
            }`}
          >
            Enviados
          </Link>
        </div>

        {/* Busca por contato. Vai ao banco (e não à lista da tela) pelo mesmo
            motivo da caixa do lojista: aqui só carregamos os 100 mais recentes. */}
        <form method="GET" action="/admin/emails" className="flex items-center gap-2">
          {enviados && <input type="hidden" name="aba" value="enviados" />}
          <input
            name="q"
            defaultValue={termo}
            placeholder="Buscar por e-mail ou nome…"
            className="w-full sm:w-64 rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button className="rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-white">Buscar</button>
          {termo && (
            <Link
              href={enviados ? "/admin/emails?aba=enviados" : "/admin/emails"}
              className="text-sm text-low hover:underline"
            >
              limpar
            </Link>
          )}
        </form>
      </div>

      {enviados ? (
        <Panel title={termo ? `Enviados para “${termo}”` : "Enviados"}>
          {saidas.length === 0 ? (
            <EmptyState>{termo ? "Nenhum e-mail enviado para esse contato." : "Nenhum e-mail enviado ainda."}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {saidas.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/admin/emails/enviado/${e.id}`}
                    className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-hi">
                          Para {e.toAddr || "—"}
                        </span>
                        <span className="flex-shrink-0 text-xs text-low">{fmtDateTime(e.createdAt)}</span>
                      </div>
                      <div className="truncate text-sm text-mid">{e.subject || "(sem assunto)"}</div>
                    </div>
                    {e.kind && (
                      <span className="mt-0.5 flex-shrink-0 rounded-full bg-soft px-2 py-0.5 text-[11px] font-semibold text-mid">
                        {rotuloKind(e.kind)}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel title={termo ? `Recebidos de “${termo}”` : "Recebidos"}>
          {recebidos.length === 0 ? (
            <EmptyState>{termo ? "Nenhum e-mail recebido desse contato." : "Nenhum e-mail recebido ainda."}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {recebidos.map((e) => {
                // Prévia = o que a pessoa escreveu. Numa resposta é o texto
                // novo; numa mensagem original, o corpo inteiro (que vem em
                // `citado` quando não há citação a separar).
                const { resposta, citado, temCitacao } = separarResposta(e.textBody);
                const previa = (temCitacao ? resposta : citado).replace(/\s+/g, " ").trim();
                return (
                  <li key={e.id}>
                    <Link
                      href={`/admin/emails/${e.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-hover"
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${e.isRead ? "bg-transparent" : "bg-emerald-500"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className={`truncate text-sm ${e.isRead ? "text-mid" : "font-bold text-hi"}`}>
                            {e.fromName || e.fromAddr || "—"}
                          </span>
                          <span className="flex-shrink-0 text-xs text-low">{fmtDateTime(e.receivedAt)}</span>
                        </div>
                        <div className={`truncate text-sm ${e.isRead ? "text-low" : "font-semibold text-hi"}`}>
                          {e.subject || "(sem assunto)"}
                        </div>
                        {previa && <div className="truncate text-xs text-low">{previa.slice(0, 140)}</div>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}
