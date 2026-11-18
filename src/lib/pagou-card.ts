// Cartão da Pagou.ai no NAVEGADOR — Payment Element (SDK v3).
//
// Diferente de todos os outros gateways do checkout: aqui os campos do cartão
// ficam num IFRAME da Pagou, não nos nossos inputs. O número do cartão nunca
// entra no nosso DOM nem trafega pelo nosso servidor — só o token `pgct_`.
//
// Fluxo, conforme a doc deles:
//   1. carrega https://js.pagou.ai/payments/v3.js
//   2. Pagou.setEnvironment("sandbox" | "production")
//   3. Pagou.elements({ publicKey, locale, origin })
//   4. elements.create("card").mount("#seletor")
//   5. elements.submit({ createTransaction }) — o SDK tokeniza, chama o nosso
//      backend pelo callback e RESOLVE O 3D SECURE sozinho lendo o `next_action`
//      da resposta que devolvemos sem alterar.

const SDK_URL = "https://js.pagou.ai/payments/v3.js";

type PagouSdk = {
  setEnvironment: (env: string) => void;
  elements: (opts: { publicKey: string; locale?: string; origin?: string }) => PagouElements;
};
type PagouCard = { mount: (sel: string) => void; unmount?: () => void };
/**
 * O que o SDK entrega no callback. Só o `token` é credencial de pagamento; a
 * doc deles é explícita que bandeira e 4 últimos são "display or bookkeeping
 * metadata" — não são dados sensíveis do cartão.
 */
type PagouTokenData = { token: string; brand?: string; last4?: string };
type PagouSubmitResult = {
  status?: string;
  error?: string;
  message?: string;
  transaction?: { id?: string; status?: string };
};
type PagouElements = {
  create: (type: string, opts?: Record<string, unknown>) => PagouCard;
  submit: (opts: { createTransaction: (tokenData: PagouTokenData) => Promise<unknown> }) => Promise<PagouSubmitResult>;
  destroy?: () => void;
};

/**
 * Desfecho do `submit()` DEPOIS da autenticação — é isto que o nosso backend não
 * tem como saber, porque quando ele respondeu o desafio do banco ainda nem tinha
 * começado (a transação nasce `three_ds_required`).
 *
 * A lista mistura status do SDK e da transação de propósito: a doc diz que
 * "quando nada mais é necessário, o SDK devolve o status da transação do seu
 * backend".
 */
const APROVADO = new Set(["succeeded", "paid", "captured", "authorized"]);
const NAO_PASSOU: Record<string, string> = {
  refused: "Pagamento não autorizado pelo banco emissor. Tente outro cartão ou pague com Pix.",
  failed: "Não foi possível concluir a verificação do seu banco. Tente de novo ou pague com Pix.",
  canceled: "Verificação do banco cancelada. Tente de novo para concluir o pagamento.",
  timed_out: "A verificação do banco expirou. Tente de novo para concluir o pagamento.",
  requires_action: "A verificação do seu banco não foi concluída. Tente de novo.",
  error: "Não foi possível processar o cartão. Tente de novo ou pague com Pix.",
};

declare global {
  interface Window {
    Pagou?: PagouSdk;
  }
}

let loading: Promise<PagouSdk | null> | null = null;

/** Carrega o SDK uma única vez por página. */
export function loadPagouSdk(): Promise<PagouSdk | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.Pagou) return Promise.resolve(window.Pagou);
  if (loading) return loading;

  loading = new Promise<PagouSdk | null>((resolve) => {
    // Falha NÃO fica em cache: uma queda de rede (ou um CSP mal configurado)
    // deixaria o cartão morto até recarregar a página inteira. Zerando o cache,
    // a próxima tentativa carrega de novo.
    const fail = () => {
      loading = null;
      resolve(null);
    };
    const done = () => {
      const sdk = window.Pagou ?? null;
      if (!sdk) loading = null;
      resolve(sdk);
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", fail, { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = done;
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return loading;
}

/** Só pré-carrega o script (chamado quando o cliente escolhe cartão). */
export function preloadPagou(): void {
  void loadPagouSdk();
}

export type PagouMount = {
  /** Dispara o pagamento: tokeniza, chama o backend e resolve o 3DS. */
  submit: (body: Record<string, unknown>) => Promise<PagouCardOutcome>;
  /** Solta o iframe ao sair do checkout (regra de produção da doc do SDK). */
  destroy: () => void;
};

export type PagouCardOutcome = {
  ok: boolean;
  status?: string;
  orderId?: string;
  amountCents?: number;
  error?: string;
};

/**
 * Monta o campo de cartão da Pagou dentro de `selector`.
 * Devolve null se o SDK não carregar (o checkout então mostra o erro em vez de
 * um campo vazio e mudo).
 */
export async function mountPagouCard(opts: {
  publicKey: string;
  sandbox: boolean;
  selector: string;
}): Promise<PagouMount | null> {
  const sdk = await loadPagouSdk();
  if (!sdk) return null;

  try {
    sdk.setEnvironment(opts.sandbox ? "sandbox" : "production");
    const elements = sdk.elements({
      publicKey: opts.publicKey,
      locale: "pt-BR",
      origin: window.location.origin,
    });
    const card = elements.create("card", { theme: "default" });
    card.mount(opts.selector);

    return {
      destroy() {
        try {
          card.unmount?.();
          elements.destroy?.();
        } catch {
          /* sair da tela não pode quebrar por causa da limpeza */
        }
      },

      async submit(body: Record<string, unknown>): Promise<PagouCardOutcome> {
        // Guardamos o que o NOSSO backend respondeu: quem tem o orderId somos
        // nós, e o SDK não devolve isso.
        let ours: PagouCardOutcome = { ok: false, error: "Pagamento não concluído." };
        try {
          const result = await elements.submit({
            createTransaction: async (tokenData) => {
              const res = await fetch("/api/checkout/card", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...body,
                  card: {
                    ...(body.card as object),
                    token: tokenData.token,
                    // Só para registro no pedido: é o que deixa ver se a recusa
                    // se concentra numa bandeira (ex.: adquirente que não aceita
                    // Elo/Hipercard). Nunca vai para a Pagou.
                    ...(tokenData.brand ? { brand: tokenData.brand } : {}),
                    ...(tokenData.last4 ? { last4: tokenData.last4 } : {}),
                  },
                }),
              });
              const payload = await res.json().catch(() => ({}));
              ours = {
                ok: res.ok,
                status: payload?.status,
                orderId: payload?.orderId,
                amountCents: payload?.amountCents,
                error: payload?.error,
              };
              // Cobrança recusada: ABORTA aqui, como faz o exemplo oficial
              // ("if (!response.ok) throw"). Devolver o corpo de erro entregaria
              // ao SDK um objeto que não é transação — sem id, sem status dele,
              // sem next_action — e ele seguiria tentando autenticar o nada. O
              // desfecho para o cliente não se perde: já está em `ours`, com o
              // orderId e a mensagem segura.
              if (!res.ok) throw new Error(payload?.error ?? "Pagamento não autorizado.");
              // Devolve o objeto da Pagou SEM ALTERAR — é dele que o SDK tira o
              // next_action para concluir a autenticação do banco.
              return payload?.data ?? payload;
            },
          });

          // O `submit()` só resolve DEPOIS da autenticação, então é o resultado
          // dele que vale — não o que o backend respondeu lá atrás. A transação
          // nasce `three_ds_required`, que o backend traduz para "pendente"; se
          // ficássemos com isso, um cartão RECUSADO no desafio do banco levaria
          // o cliente para a página do pedido como se estivesse tudo certo.
          const status = String(result?.status ?? "").toLowerCase();
          const recusa = NAO_PASSOU[status];
          if (recusa) return { ...ours, ok: false, status, error: ours.error ?? recusa };
          if (APROVADO.has(status)) return { ...ours, ok: true, status: "approved" };

          // `processing`/`pending`/`completed` e qualquer status novo seguem para
          // a página do pedido: quem dá a palavra final é o webhook, nunca o
          // navegador ("Do not fulfill an order from the browser status alone").
          return ours;
        } catch (e) {
          return { ...ours, ok: false, error: ours.error ?? (e instanceof Error ? e.message : "Falha ao processar o cartão.") };
        }
      },
    };
  } catch {
    return null;
  }
}
