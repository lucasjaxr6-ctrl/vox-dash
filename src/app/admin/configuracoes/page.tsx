import Link from "next/link";
import { getDbHealth, getPlatformStats } from "@/lib/admin";
import { PageHeader, Panel } from "@/components/admin/ui";
import Track17Form from "@/components/admin/Track17Form";
import PlatformEmailForm from "@/components/admin/PlatformEmailForm";
import { getTrack17Token } from "@/lib/track17";
import { getPlatformEmailStatus } from "@/lib/platform-email";

export const dynamic = "force-dynamic";

function uptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default async function Configuracoes() {
  const [db, stats, track17, email] = await Promise.all([
    getDbHealth().catch(() => null),
    getPlatformStats("all"),
    getTrack17Token().catch(() => null),
    getPlatformEmailStatus().catch(() => ({
      configurado: false,
      fromEmail: "",
      fromName: "",
      inboundEmail: "",
      temSegredoInbound: false,
    })),
  ]);
  const track17Configurado = Boolean(track17);

  const connPct = db && db.maxConnections ? Math.round((db.connected / db.maxConnections) * 100) : 0;

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Configurações" subtitle="Ajustes que valem para toda a plataforma." />

      <Panel title="E-mail da Vox" padded>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-low">
          Remetente da <b>plataforma</b>, para falar com os lojistas. É separado do e-mail das lojas de
          propósito: cada loja envia pelo domínio dela, para o comprador receber a mensagem da marca onde
          comprou — um aviso da Vox assinado pela loja do cliente confundiria os dois lados.
        </p>
        <PlatformEmailForm
          configurado={email.configurado}
          fromEmail={email.fromEmail}
          fromName={email.fromName}
          inboundEmail={email.inboundEmail}
          temSegredoInbound={email.temSegredoInbound}
        />
      </Panel>

      <Panel title="Rastreamento de encomendas" padded>
        <p className="mb-4 max-w-3xl text-sm leading-relaxed text-low">
          Token da API do <b>17TRACK</b>, usado para buscar os eventos das entregas. É ele que alimenta a
          página <code className="rounded bg-soft px-1">/rastreio</code> no domínio de cada loja — assim o
          cliente acompanha o pedido em português, sem sair da loja. Um token atende todas as lojas.
        </p>
        <Track17Form configurado={track17Configurado} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Banco de dados" padded>
          {db ? (
            <dl className="space-y-3 text-sm">
              <Row label="Conexões abertas" value={`${db.connected} de ${db.maxConnections}`} />
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-soft">
                  <div
                    className={`h-full rounded-full ${connPct > 80 ? "bg-red-500" : connPct > 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.max(0, Math.min(100, connPct))}%` }}
                  />
                </div>
                <div className="mt-1 text-[11px] text-low">{connPct}% do limite</div>
              </div>
              <Row label="No ar há" value={uptime(db.uptimeSeconds)} />
            </dl>
          ) : (
            <p className="text-sm text-low">Não foi possível ler o estado do banco agora.</p>
          )}
        </Panel>

        <Panel title="Plataforma" padded>
          <dl className="space-y-3 text-sm">
            <Row label="Lojas cadastradas" value={String(stats.stores)} />
            <Row label="Lojistas" value={String(stats.merchants)} />
            <Row label="Pedidos aguardando pagamento" value={String(stats.pendingOrders)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Link href="/admin/lojas" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
              Gerenciar lojas
            </Link>
            <Link href="/admin/usuarios" className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
              Gerenciar usuários
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-low">{label}</dt>
      <dd className="font-semibold tabular-nums text-hi">{value}</dd>
    </div>
  );
}
