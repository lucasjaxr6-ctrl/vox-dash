import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireMerchant, HttpError } from "@/lib/auth";
import { getStoresForOwner, createStore, getActiveStore } from "@/lib/stores";
import { statusCobrancaLoja, cobrancasAbertas, vencimentoDoPix, getFeeConfig } from "@/lib/platform-fees";
import { planoDaConta } from "@/lib/plans";
import { cobrancaPlanoAberta } from "@/lib/plan-billing";
import Sidebar from "@/components/painel/Sidebar";
import Topbar from "@/components/painel/Topbar";
import ContaSuspensa from "@/components/painel/ContaSuspensa";
import AvisoCobranca from "@/components/painel/AvisoCobranca";
import EscolherPlano from "@/components/painel/EscolherPlano";
import GuiaConfiguracao from "@/components/painel/GuiaConfiguracao";
import CompletarCadastro from "@/components/painel/CompletarCadastro";
import { situacaoCadastro } from "@/lib/merchant-profile";
import { premiacaoDaConta, type Premiacao } from "@/lib/premiacao";
import { headers } from "next/headers";
import { onboardingConcluido, statusOnboarding } from "@/lib/onboarding";
import { rotaPermitida, type EtapaRota } from "@/lib/onboarding-rotas";

// Título ESTÁTICO no layout, não só na raiz.
//
// As páginas do painel são dinâmicas e ficam atrás de um limite de streaming
// (o loading.tsx). Ao trocar de página, o título ia junto com o conteúdo, que
// chega depois — e no intervalo o navegador mostrava a URL na aba
// ("vox.black/painel") até o conteúdo terminar de carregar.
//
// Metadado estático de layout viaja no PRIMEIRO pedaço da resposta, antes do
// conteúdo, então a aba já nasce com o nome certo.
export const metadata: Metadata = { title: "VOX" };

// Trava do painel enquanto a configuração inicial não termina. Ver o bloco
// "Configuração inicial da loja" mais abaixo.
const TRAVAR_CONFIGURACAO = false;

// Layout do painel do lojista. Protege TODAS as páginas /painel/* exigindo
// papel MERCHANT (ou ADMIN). Quem não tiver acesso vai para /login.
export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userId: string;
  let userName: string | null = null;
  let userEmail: string | null = null;
  let suspensoPeloAdmin = false;
  let ehAdmin = false;
  try {
    const user = await requireMerchant();
    userId = user.id;
    userName = user.name ?? null;
    userEmail = user.email ?? null;
    suspensoPeloAdmin = Number(user.suspended ?? 0) === 1;
    ehAdmin = user.role === "ADMIN";
  } catch (e) {
    const rota = (await headers()).get("x-pathname");
    // Só FALTA DE SESSÃO manda para o login, e com o caminho para voltar.
    // Antes qualquer erro mandava: um tropeço de conexão com o banco jogava
    // quem estava logado no login, que via a sessão e o levava ao Início.
    if (e instanceof HttpError) {
      redirect(rota && rota !== "/painel" ? `/login?next=${encodeURIComponent(rota)}` : "/login");
    }
    // Falha de verdade (banco fora do ar mesmo depois da nova tentativa em
    // lib/db.ts): diz o que houve em vez de pedir login.
    return (
      <>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('vox-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}`,
          }}
        />
        <div className="panel-root flex min-h-screen items-center justify-center bg-app px-4 text-mid antialiased">
          <div className="max-w-sm text-center">
            <h1 className="text-lg font-bold text-hi">Não foi possível carregar o painel</h1>
            <p className="mt-1.5 text-sm text-low">Foi uma falha momentânea de conexão. Tente de novo em alguns segundos.</p>
            {/* <a> e não <Link>: precisa recarregar a página inteira, layout incluso. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href={rota || "/painel/inicio"}
              className="mt-5 inline-flex rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-hover"
            >
              Tentar de novo
            </a>
          </div>
        </div>
      </>
    );
  }

  // Garante ao menos uma loja: a conta sempre entra no painel com uma loja ativa
  // (evita o estado confuso de "configurar sem loja"). O lojista pode renomear
  // ou criar outras no seletor.
  const stores = await getStoresForOwner(userId);
  if (stores.length === 0) {
    await createStore(userId, "Minha loja");
  }

  // Cadastro incompleto (conta criada antes do KYC): nada do painel abre até
  // preencher celular, documento e endereço. Vem ANTES da suspensão porque o
  // Pix da taxa sai em nome do lojista e não existe sem o documento dele.
  // O ADMIN não passa por aqui — não paga taxa nem plano. Como as outras
  // travas, mora só no layout: checkout, webhooks e e-mails seguem normais.
  if (!ehAdmin) {
    const cadastro = await situacaoCadastro(userId);
    if (!cadastro.completo) {
      return (
        <>
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var t=localStorage.getItem('vox-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}`,
            }}
          />
          <div className="panel-root min-h-screen bg-app px-4 text-mid antialiased sm:px-6">
            <CompletarCadastro nome={cadastro.nome} telefone={cadastro.telefone} />
          </div>
        </>
      );
    }
  }

  // Cobrança da plataforma. O bloqueio mora AQUI, no layout do painel, e em
  // lugar nenhum além dele: assim é impossível que uma suspensão encoste no
  // checkout, nos webhooks ou nos e-mails — eles vivem fora desta árvore de
  // rotas. Lojista devendo continua vendendo; o que ele perde é a dashboard.
  const loja = await getActiveStore();
  const cobranca = loja ? await statusCobrancaLoja(loja.id) : null;
  // Dois caminhos para o mesmo bloqueio: taxa em aberto há 3 dias (automático,
  // some ao pagar) e suspensão decidida pelo admin (manual). A tela muda o
  // texto conforme o motivo — "pague para liberar" numa suspensão manual seria
  // uma instrução que não resolve.
  const suspensa = suspensoPeloAdmin || cobranca?.suspensa === true;
  const pixAberto = suspensa && !suspensoPeloAdmin && loja ? (await cobrancasAbertas(loja.id))[0] : null;

  // Escolha de plano: conta sem plano não entra em nenhuma seção do painel até
  // escolher. Mesmo padrão da suspensão — o bloqueio mora no layout, então o
  // checkout, os webhooks e os e-mails nunca dependem disto.
  //
  // O plano é do DONO da loja ativa. O ADMIN só passa direto na loja de OUTRA
  // pessoa (suporte: não pode ficar preso escolhendo plano por ela); na loja
  // dele mesmo, segue as regras de qualquer lojista. Contas que já existiam
  // foram colocadas no Basic pela migração, então nunca veem esta tela.
  const dono = loja?.ownerUserId ?? userId;
  const suporte = ehAdmin && dono !== userId;
  const semPlano = !suspensa && !suporte && !(await planoDaConta(dono)).escolhido;
  if (semPlano) {
    const [{ pct }, aberta] = await Promise.all([getFeeConfig(), cobrancaPlanoAberta(dono)]);
    return (
      <>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('vox-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}`,
          }}
        />
        <div className="panel-root min-h-screen bg-app px-4 text-mid antialiased sm:px-6">
          <EscolherPlano inicial padraoPct={pct} cobrancaAberta={aberta} />
        </div>
      </>
    );
  }

  // Configuração inicial da loja. Pendente = só abrem o Início, o Plano e as
  // telas das etapas que faltam. Aqui cobre a carga completa da página (URL
  // digitada, retorno da Shopify); a navegação pelo menu é coberta pelo
  // GuiaConfiguracao, porque o layout não é refeito nela.
  //
  // Seção travada não é renderizada aqui: em vez da página, o guia mostra o
  // aviso "conclua a configuração primeiro" (a página nem chega a consultar o
  // banco). O ADMIN só passa direto na loja de outra pessoa.
  //
  // DESLIGADO por enquanto (TRAVAR_CONFIGURACAO = false): a trava ainda tem
  // falhas e estava prendendo lojista. Para religar, volte para true.
  let travado = false;
  let bloquearPagina = false;
  let etapasGuia: EtapaRota[] = [];
  if (TRAVAR_CONFIGURACAO && !suspensa && !suporte && loja && !(await onboardingConcluido(loja.id))) {
    const st = await statusOnboarding(loja.id);
    travado = !st.concluido;
    etapasGuia = st.etapas.map(({ id, feito, rotas, titulo }) => ({ id, feito, rotas, titulo }));
    const rota = (await headers()).get("x-pathname");
    bloquearPagina = travado && !!rota && !rotaPermitida(rota, etapasGuia);
  }

  // Barra de premiação do topo. Falha aqui não pode derrubar o painel.
  let premiacao: Premiacao | null = null;
  try {
    premiacao = await premiacaoDaConta(userId!);
  } catch {
    premiacao = null;
  }

  return (
    <>
      {/* Aplica o tema salvo ANTES da pintura (evita o flash do tema errado). */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{var t=localStorage.getItem('vox-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark')}catch(e){}`,
        }}
      />
      <div className="panel-root flex min-h-screen bg-app text-mid antialiased">
        {/* Suspensa: some a navegação. Deixar o menu visível mas inerte faria
            o lojista clicar em tudo tentando entender o que quebrou. */}
        {!suspensa && <Sidebar travado={travado} etapas={etapasGuia} />}
        <div className="flex min-w-0 flex-1 flex-col pt-[45px] lg:pt-0">
          <div className="hidden lg:block">
            <Topbar userName={userName} userEmail={userEmail} premiacao={premiacao} />
          </div>
          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[1600px] px-4 pb-14 pt-6 sm:px-6 lg:px-8 lg:pt-7">
              {suspensa ? (
                <ContaSuspensa
                  porAdmin={suspensoPeloAdmin}
                  pendentesCents={cobranca?.pendentesCents ?? 0}
                  diasEmAberto={cobranca?.diasEmAberto ?? 0}
                  cobranca={
                    pixAberto
                      ? {
                          amountCents: pixAberto.amountCents,
                          qrCode: pixAberto.qrCode,
                          expiraEm: vencimentoDoPix(pixAberto.createdAt),
                        }
                      : null
                  }
                />
              ) : (
                <>
                  {cobranca && <AvisoCobranca {...cobranca} />}
                  <GuiaConfiguracao travado={travado} etapas={etapasGuia}>
                    {bloquearPagina ? null : children}
                  </GuiaConfiguracao>
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
