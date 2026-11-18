"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ContaDetalhe = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "MERCHANT" | "ADMIN";
  banned: number;
  suspended: number;
};

export type LojaDetalhe = {
  id: string;
  name: string;
  orders: number;
  gmvCents: number;
  pctIndividual: number | null;
  recoveryPctIndividual: number | null;
  taxasPendentesCents: number;
  taxasPagasCents: number;
  criadaEm: string;
  dominio: string | null;
  dominioVerificado: boolean;
  shopify: string | null;
  produtos: number;
  /** Concluiu o passo a passo do Início (painel liberado). */
  configurada: boolean;
  gatewayPix: string | null;
  gatewayCartao: string | null;
};

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/**
 * Ficha da conta: visualização primeiro, edição só quando destravada.
 *
 * O motivo de não haver nada editável nem acionável na LISTAGEM é errar de
 * clique. Banir, suspender e excluir são decisões que afetam o negócio de
 * outra pessoa; elas não podem estar a um clique distraído de distância, no
 * meio de uma tabela que se rola.
 *
 * Aqui dentro, cada ação sensível ainda exige uma confirmação que diz o que
 * vai acontecer — e a exclusão exige digitar o e-mail, porque é a única
 * irreversível.
 */
export default function UserDetail({
  conta,
  lojas,
  ehVoce,
  padrao,
  children,
}: {
  conta: ContaDetalhe;
  lojas: LojaDetalhe[];
  ehVoce: boolean;
  padrao: { pct: number; recoveryPct: number };
  /** Blocos de leitura (cadastro, plano, acesso), logo após os dados da conta. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function acao(payload: Record<string, unknown>, chave: string, sucesso: string) {
    setBusy(chave);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/platform/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, texto: data?.error ?? "Falha na ação." });
        return false;
      }
      setMsg({ ok: true, texto: sucesso });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, texto: "Erro de rede." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {msg && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            msg.ok ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
          }`}
        >
          {msg.texto}
        </div>
      )}

      <DadosDaConta conta={conta} onSalvar={(p) => acao({ action: "update", userId: conta.id, ...p }, "dados", "Dados salvos.")} busy={busy === "dados"} />

      {children}

      <TaxasDasLojas lojas={lojas} padrao={padrao} onMsg={setMsg} />

      {/* Ações sensíveis por último e visualmente separadas: quem rola até
          aqui já passou por tudo que é informativo. */}
      {ehVoce ? (
        <section className="rounded-2xl bg-card p-5">
          <h2 className="text-[15px] font-bold text-hi">Ações da conta</h2>
          <p className="mt-1 text-sm text-low">
            Esta é a sua própria conta. Banir, suspender e excluir ficam indisponíveis aqui — é a trava que impede
            você de se trancar para fora da plataforma.
          </p>
        </section>
      ) : (
        <section className="rounded-2xl border border-red-500/20 bg-card">
          <div className="border-b border-red-100 px-5 py-3.5">
            <h2 className="text-[15px] font-bold text-red-700 dark:text-red-400">Ações sensíveis</h2>
            <p className="mt-0.5 text-xs text-low">Cada uma pede confirmação antes de valer.</p>
          </div>
          <div className="divide-y divide-line">
            <AcaoPerigosa
              titulo={conta.suspended ? "Reativar acesso ao painel" : "Suspender acesso ao painel"}
              descricao={
                conta.suspended
                  ? "Devolve o acesso ao painel imediatamente."
                  : "A pessoa continua conseguindo entrar, mas vê uma tela de conta suspensa no lugar do painel. O checkout dela continua vendendo normalmente — nenhuma venda é perdida."
              }
              botao={conta.suspended ? "Reativar" : "Suspender"}
              tom={conta.suspended ? "neutro" : "aviso"}
              busy={busy === "susp"}
              onConfirmar={() =>
                acao(
                  { action: conta.suspended ? "unsuspend" : "suspend", userId: conta.id },
                  "susp",
                  conta.suspended ? "Acesso reativado." : "Painel suspenso.",
                )
              }
            />
            <AcaoPerigosa
              titulo={conta.banned ? "Remover banimento" : "Banir conta"}
              descricao={
                conta.banned
                  ? "A pessoa volta a conseguir fazer login."
                  : "Bloqueia o LOGIN e derruba as sessões abertas na hora. Diferente de suspender: aqui a pessoa nem entra. O checkout das lojas continua funcionando."
              }
              botao={conta.banned ? "Remover banimento" : "Banir"}
              tom={conta.banned ? "neutro" : "aviso"}
              busy={busy === "ban"}
              onConfirmar={() =>
                acao(
                  { action: conta.banned ? "unban" : "ban", userId: conta.id },
                  "ban",
                  conta.banned ? "Banimento removido." : "Conta banida e sessões encerradas.",
                )
              }
            />
            <AcaoPerigosa
              titulo="Excluir conta"
              descricao="Apaga a conta e as lojas dela. Só funciona se nenhuma loja tiver pedidos — histórico de venda não se apaga. É a única ação irreversível desta tela."
              botao="Excluir definitivamente"
              tom="perigo"
              confirmarDigitando={conta.email}
              busy={busy === "del"}
              onConfirmar={async () => {
                const ok = await acao({ action: "delete", userId: conta.id }, "del", "Conta excluída.");
                if (ok) router.push("/admin/usuarios");
                return ok;
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/** Dados da conta: só leitura até clicar em Editar. */
function DadosDaConta({
  conta,
  onSalvar,
  busy,
}: {
  conta: ContaDetalhe;
  onSalvar: (p: { name: string; email: string; role: string }) => Promise<boolean>;
  busy: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [name, setName] = useState(conta.name || "");
  const [email, setEmail] = useState(conta.email);
  const [role, setRole] = useState(conta.role);

  function cancelar() {
    setName(conta.name || "");
    setEmail(conta.email);
    setRole(conta.role);
    setEditando(false);
  }

  const campo = "w-full rounded-lg border border-line-strong px-3 py-2 text-sm outline-none focus:border-brand";

  return (
    <section className="rounded-2xl bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-hi">Dados da conta</h2>
        {editando ? (
          <div className="flex gap-2">
            <button onClick={cancelar} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
              Cancelar
            </button>
            <button
              onClick={async () => {
                const ok = await onSalvar({ name, email, role });
                if (ok) setEditando(false);
              }}
              disabled={busy}
              className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Salvando..." : "Salvar"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditando(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Editar
          </button>
        )}
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Campo rotulo="Nome">
          {editando ? <input className={campo} value={name} onChange={(e) => setName(e.target.value)} /> : conta.name || "—"}
        </Campo>
        <Campo rotulo="E-mail">
          {editando ? <input className={campo} value={email} onChange={(e) => setEmail(e.target.value)} /> : conta.email}
        </Campo>
        <Campo rotulo="Papel">
          {editando ? (
            <select className={campo} value={role} onChange={(e) => setRole(e.target.value as ContaDetalhe["role"])}>
              <option value="USER">USER</option>
              <option value="MERCHANT">MERCHANT</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          ) : (
            conta.role
          )}
        </Campo>
      </div>
    </section>
  );
}

/** Taxa de cada loja da conta. Também travada até destravar. */
function TaxasDasLojas({
  lojas,
  padrao,
  onMsg,
}: {
  lojas: LojaDetalhe[];
  padrao: { pct: number; recoveryPct: number };
  onMsg: (m: { ok: boolean; texto: string }) => void;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<string | null>(null);
  const [pct, setPct] = useState("");
  const [rec, setRec] = useState("");
  const [busy, setBusy] = useState(false);

  function abrir(l: LojaDetalhe) {
    setPct(l.pctIndividual === null ? "" : String(l.pctIndividual));
    setRec(l.recoveryPctIndividual === null ? "" : String(l.recoveryPctIndividual));
    setEditando(l.id);
  }

  async function salvar(storeId: string) {
    const ler = (s: string) => {
      const t = s.trim().replace(",", ".");
      if (t === "") return null; // vazio = volta ao padrão
      const v = Number(t);
      return Number.isFinite(v) && v >= 0 && v <= 100 ? v : undefined; // undefined = inválido
    };
    const p = ler(pct);
    const r = ler(rec);
    if (p === undefined || r === undefined) return onMsg({ ok: false, texto: "Percentual inválido." });

    setBusy(true);
    try {
      const res = await fetch("/api/admin/platform/fees", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, pctLoja: p, recoveryPctLoja: r }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return onMsg({ ok: false, texto: data?.error ?? "Falha ao salvar a taxa." });
      onMsg({ ok: true, texto: "Taxa da loja salva. Vale para as próximas vendas." });
      setEditando(null);
      router.refresh();
    } catch {
      onMsg({ ok: false, texto: "Erro de rede." });
    } finally {
      setBusy(false);
    }
  }

  const campo = "w-24 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <section className="rounded-2xl bg-card">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-bold text-hi">Lojas e taxas</h2>
        <p className="mt-0.5 text-xs text-low">
          Campo vazio usa a taxa do plano da conta ({num(padrao.pct)}% e {num(padrao.recoveryPct)}% em recuperadas).
          Mudar a taxa não altera o que já foi cobrado.
        </p>
      </div>

      {lojas.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-low">Esta conta não tem lojas.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lojas.map((l) => (
            <li key={l.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-hi">{l.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1 ring-inset ${
                        l.configurada
                          ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-400"
                      }`}
                    >
                      {l.configurada ? "Configurada" : "Passo a passo pendente"}
                    </span>
                  </div>
                  <div className="text-xs text-low">
                    {l.orders} venda(s) · {brl(l.gmvCents)} · taxa em aberto {brl(l.taxasPendentesCents)} · criada em {l.criadaEm}
                  </div>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <Info rotulo="Domínio">
                      {l.dominio ? (
                        <>
                          {l.dominio}{" "}
                          <span className={l.dominioVerificado ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                            ({l.dominioVerificado ? "verificado" : "não verificado"})
                          </span>
                        </>
                      ) : (
                        "—"
                      )}
                    </Info>
                    <Info rotulo="Shopify">{l.shopify ? `${l.shopify} · ${l.produtos} produto(s)` : "não conectada"}</Info>
                    <Info rotulo="Pix">{l.gatewayPix ?? <span className="text-amber-700 dark:text-amber-400">nenhum gateway ativo</span>}</Info>
                    <Info rotulo="Cartão">{l.gatewayCartao ?? "—"}</Info>
                  </dl>
                </div>

                {editando === l.id ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-low">Taxa</span>
                      <input className={campo} value={pct} onChange={(e) => setPct(e.target.value)} placeholder={num(padrao.pct)} inputMode="decimal" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-low">Recuperada</span>
                      <input className={campo} value={rec} onChange={(e) => setRec(e.target.value)} placeholder={num(padrao.recoveryPct)} inputMode="decimal" />
                    </label>
                    <button onClick={() => setEditando(null)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
                      Cancelar
                    </button>
                    <button onClick={() => salvar(l.id)} disabled={busy} className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                      {busy ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-semibold tabular-nums text-hi">
                        {num(l.pctIndividual ?? padrao.pct)}%
                        <span className="text-low"> / {num(l.recoveryPctIndividual ?? padrao.recoveryPct)}%</span>
                      </div>
                      <div className="text-[10px] text-low">
                        {l.pctIndividual === null && l.recoveryPctIndividual === null ? "padrão" : "taxa própria"}
                      </div>
                    </div>
                    <button onClick={() => abrir(l)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
                      Editar taxa
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Ação sensível com confirmação em duas etapas.
 *
 * `confirmarDigitando` exige que o admin escreva um texto exato (o e-mail da
 * conta) — reservado para o que não tem volta. Clicar duas vezes é fácil;
 * digitar o e-mail de outra pessoa por engano, não.
 */
function AcaoPerigosa({
  titulo,
  descricao,
  botao,
  tom,
  busy,
  confirmarDigitando,
  onConfirmar,
}: {
  titulo: string;
  descricao: string;
  botao: string;
  tom: "neutro" | "aviso" | "perigo";
  busy: boolean;
  confirmarDigitando?: string;
  onConfirmar: () => Promise<boolean | void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");

  const cores: Record<string, string> = {
    neutro: "border-line text-mid hover:bg-hover",
    aviso: "border-amber-500/20 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20",
    perigo: "border-red-500/20 text-red-700 dark:text-red-400 hover:bg-red-500/20",
  };
  const confirmavel = !confirmarDigitando || texto.trim().toLowerCase() === confirmarDigitando.toLowerCase();

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-hi">{titulo}</div>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-low">{descricao}</p>
        </div>
        {!aberto && (
          <button
            onClick={() => {
              setTexto("");
              setAberto(true);
            }}
            className={`flex-shrink-0 rounded-lg border px-3.5 py-2 text-xs font-semibold ${cores[tom]}`}
          >
            {botao}
          </button>
        )}
      </div>

      {aberto && (
        <div className={`mt-3 rounded-xl border p-3 ${tom === "perigo" ? "border-red-500/20 bg-red-500/10" : "border-amber-500/20 bg-amber-500/10"}`}>
          <p className="text-xs font-semibold text-hi">Confirmar: {titulo.toLowerCase()}?</p>
          {confirmarDigitando && (
            <label className="mt-2 block">
              <span className="block text-[11px] text-mid">
                Digite <b className="font-mono">{confirmarDigitando}</b> para liberar o botão.
              </span>
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full max-w-sm rounded-lg border border-line-strong px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => setAberto(false)} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-mid hover:bg-hover">
              Cancelar
            </button>
            <button
              onClick={async () => {
                const ok = await onConfirmar();
                if (ok !== false) setAberto(false);
              }}
              disabled={busy || !confirmavel}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-40 ${
                tom === "perigo" ? "bg-red-600" : "bg-amber-600"
              }`}
            >
              {busy ? "Aplicando..." : `Sim, ${botao.toLowerCase()}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="flex-shrink-0 text-low">{rotulo}:</dt>
      <dd className="min-w-0 truncate text-mid">{children}</dd>
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-normal text-low">{rotulo}</div>
      <div className="text-sm text-hi">{children}</div>
    </div>
  );
}
