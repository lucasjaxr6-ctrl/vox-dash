import { redirect } from "next/navigation";
import { getCurrentUser, listMySessions } from "@/lib/session";
import { getActiveStore } from "@/lib/stores";
import { describeDevice, describeLocation } from "@/lib/user-agent";
import RevokeSessionButton from "@/components/painel/RevokeSessionButton";

// Dispositivos conectados: onde a conta está logada agora, e de onde.
// Serve para o lojista perceber um acesso que não reconhece e derrubá-lo na
// hora, sem precisar trocar a senha.
//
// Fica em /painel/seguranca porque /painel/dispositivos é OUTRA tela: a
// comparação de vendas entre celular e computador.

export const dynamic = "force-dynamic";

function fmt(d: Date) {
  return new Date(d)
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(", ", " às ");
}

export default async function SegurancaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sessions = await listMySessions(user.id);

  // Esta tela é da CONTA, não da loja: mostra as sessões de quem está logado.
  // Quando o admin abre o painel de uma loja de outra pessoa, ele continua sendo
  // ele mesmo — então o que aparece aqui são os aparelhos DELE, não os do
  // lojista. Sem esse aviso, o admin lê a lista como se fosse do lojista e pode
  // até encerrar a própria sessão achando que está derrubando a de outro.
  const store = await getActiveStore();
  const vendoOutraLoja = !!store && store.ownerUserId !== user.id;

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-hi">Dispositivos conectados</h1>
        <p className="mt-1 text-[13px] text-low">Controle de acessos na sua conta.</p>
      </div>

      {vendoOutraLoja && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-[13px] font-bold text-amber-700 dark:text-amber-400">
            Você está vendo o painel de {store!.name} como admin.
          </p>
          <p className="mt-1 text-[12.5px] text-amber-700/90 dark:text-amber-400/90">
            Os aparelhos abaixo são os da <b>sua conta</b> ({user.email}), não os do lojista. O lojista
            enxerga apenas os aparelhos dele nesta mesma tela — o seu acesso de admin não aparece para ele.
          </p>
        </div>
      )}

      <div className="rounded-2xl bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="2" width="12" height="20" rx="2.5" />
              <path d="M11 18h2" />
            </svg>
          </span>
          <div>
            <h2 className="text-[15px] font-bold text-hi">Sessões ativas</h2>
            <p className="text-[12.5px] text-low">
              Não reconhece um acesso? Encerre a sessão — o dispositivo cai na hora e precisa entrar de novo.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {sessions.map((s) => (
            <div key={s.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-[15px] font-bold text-hi">{describeDevice(s.userAgent)}</span>
                {s.current && (
                  <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-400">
                    Ativo
                  </span>
                )}
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Campo rotulo="Endereço de IP" valor={s.ip} />
                <Campo rotulo="Aparelho" valor={describeDevice(s.userAgent)} />
                <Campo rotulo="Localização" valor={describeLocation(s.city, s.region, s.country)} />
                <Campo rotulo="Entrou em" valor={fmt(s.createdAt)} />
              </dl>

              <div className="mt-4">
                <RevokeSessionButton id={s.id} current={s.current} />
              </div>
            </div>
          ))}

          {sessions.length === 0 && (
            <p className="py-6 text-center text-[13px] text-low">Nenhuma sessão ativa encontrada.</p>
          )}
        </div>
      </div>

      <p className="text-xs text-dim">
        A localização vem do provedor de internet e pode apontar a cidade vizinha. Acessos feitos antes
        desta tela existir aparecem sem localização — ela passa a ser registrada a partir do próximo login.
      </p>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] text-dim">{rotulo}</dt>
      <dd className="mt-0.5 truncate text-[13.5px] text-mid">{valor || "—"}</dd>
    </div>
  );
}
