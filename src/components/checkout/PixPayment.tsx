"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cadeado, LinhaDoTopo } from "@/components/checkout/ui";
import { COR_PADRAO_SELO_SEGURO } from "@/lib/checkout-theme";

type Props = {
  orderId: string;
  code: string;
  qrCodeUrl: string | null;
  amountCents: number;
  /** ISO da criação do pedido — a contagem é sempre de 30 min a partir dela. */
  createdAt: string;
  paid: boolean;
  storeName: string;
  logoUrl?: string | null;
  /** Altura da logo configurada pela loja (Personalizar). */
  logoHeight?: number;
  /** Logo à esquerda ou no meio da tela (Personalizar). */
  logoPosition?: "left" | "center";
  primary: string;
  /** Cor do "Pagamento seguro" (Personalizar → Cores). Null = os cinzas. */
  seloSeguro?: string | null;
};

/** Janela exibida ao cliente para pagar o Pix. */
const PIX_WINDOW_MIN = 30;

function brl(cents: number) {
  return (Number(cents) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtTime(total: number) {
  const m = Math.floor(Math.max(0, total) / 60);
  const s = Math.max(0, total) % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function PixPayment(p: Props) {
  const router = useRouter();
  const [paid, setPaid] = useState(p.paid);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);

  // QR gerado no PRÓPRIO navegador a partir do copia-e-cola: o payload não vai
  // para nenhum terceiro (mesma abordagem do checkout).
  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((QR) => QR.toDataURL(p.code, { margin: 1, width: 260 }))
      .then((url) => !cancelled && setQrDataUrl(url))
      .catch(() => !cancelled && setQrDataUrl(null));
    return () => {
      cancelled = true;
    };
  }, [p.code]);

  // Contagem regressiva: SEMPRE 30 min a partir da criação do pedido. Não usa a
  // expiração do gateway porque cada adquirente devolve um prazo diferente (uma
  // delas manda horas), e o cliente via "82:00" na tela.
  useEffect(() => {
    const start = new Date(p.createdAt).getTime();
    if (Number.isNaN(start)) return;
    const end = start + PIX_WINDOW_MIN * 60_000;
    const tick = () => setSeconds(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [p.createdAt]);

  // Confirmação automática do pagamento (mesma rota que o checkout usava).
  useEffect(() => {
    if (paid) return;
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch(`/api/checkout/pix/status?orderId=${encodeURIComponent(p.orderId)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && (data.status === "PAID" || data.status === "SHIPPED" || data.paid)) setPaid(true);
      } catch {
        /* silencioso — segue tentando */
      }
    };
    check();
    const id = setInterval(check, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paid, p.orderId]);

  // Confirmou: leva para a página de obrigado, que é quem dispara a conversão.
  // Fazer o disparo aqui correria contra a navegação e podia perder o evento.
  useEffect(() => {
    if (paid) router.replace(`/obrigado/${encodeURIComponent(p.orderId)}`);
  }, [paid, router, p.orderId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(p.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* navegador sem clipboard: o campo fica selecionável */
    }
  }

  const expired = seconds !== null && seconds <= 0;

  return (
    <main className="flex-1 bg-white">
      <div className="mx-auto w-full max-w-[560px] px-5 pb-14 pt-4">
        {/* Topo: logo (à esquerda ou no meio) e selo à direita, na mesma linha */}
        <LinhaDoTopo
          posicao={p.logoPosition ?? "left"}
          className="gap-4 py-1"
          marca={
            p.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={p.logoUrl}
                alt={p.storeName}
                style={{ height: p.logoHeight ?? 40 }}
                className="w-auto max-w-[55%] object-contain"
              />
            ) : (
              <span className="text-xl font-bold tracking-tight text-gray-800">{p.storeName}</span>
            )
          }
          direita={
            // Cadeado e as duas linhas na mesma cor, como o LockBadge.
            <div className="flex shrink-0 items-center gap-2" style={{ color: p.seloSeguro || COR_PADRAO_SELO_SEGURO }}>
              <Cadeado size={17} />
              <div className="selo-texto text-[11px] font-bold uppercase leading-tight tracking-wide">
                <div>Pagamento</div>
                <div>100% seguro</div>
              </div>
            </div>
          }
        />

        {paid ? (
          /* Pago: quem mostra a confirmação é /obrigado. Aqui só um estado de
             transição enquanto o redirect acontece — sem isso o cliente via
             duas telas de "pagamento confirmado" seguidas. */
          <div className="py-24 text-center">
            <div
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200"
              style={{ borderTopColor: p.primary }}
            />
            <p className="mt-4 text-[14px] text-gray-500">Pagamento confirmado. Abrindo seu pedido...</p>
          </div>
        ) : (
          <>
            {/* ── Aguardando ── */}
            <div className="mt-10 text-center">
              <h1 className="text-[30px] font-bold tracking-tight text-gray-700">Quase lá...</h1>
              <p className="mt-2 text-[15px] text-gray-500">
                {expired ? (
                  <>Este Pix expirou. Volte e gere um novo para concluir seu pedido.</>
                ) : (
                  <>
                    Pague via pix{" "}
                    {seconds !== null && (
                      <>
                        em até <b className="text-gray-700">{fmtTime(seconds)}</b>{" "}
                      </>
                    )}
                    para confirmar seu pedido.
                  </>
                )}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-5 py-2 text-[14px] font-semibold text-amber-700">
                {expired ? "Pix expirado" : "Aguardando pagamento"}
                {!expired && <Dots />}
              </div>
            </div>

            {/* QR */}
            <p className="mt-8 text-center text-[14px] text-gray-500">Aponte a câmera do seu celular</p>
            {(qrDataUrl || p.qrCodeUrl) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl || p.qrCodeUrl || ""}
                alt="QR Code Pix"
                className={`mx-auto mt-3 h-60 w-60 object-contain transition ${expired ? "opacity-30 grayscale" : ""}`}
              />
            )}

            <p className="mt-3 text-center text-[14px] text-gray-500">
              Total via Pix: <span className="font-bold" style={{ color: p.primary }}>{brl(p.amountCents)}</span>
            </p>

            {/* Copia e cola */}
            <input
              readOnly
              value={p.code}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-5 w-full truncate rounded-full border border-gray-200 bg-gray-50 px-5 py-3 text-center text-[13px] text-gray-400"
            />
            <button
              onClick={copy}
              disabled={expired}
              style={{ background: p.primary }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-4 text-[15px] font-bold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copied ? "Código copiado!" : "Copiar código"}
            </button>

            {/* Passo a passo */}
            <h2 className="mt-10 text-[19px] font-bold text-gray-700">Como pagar o pix</h2>
            <ol className="mt-4 space-y-4">
              <Step n={1} primary={p.primary}>
                Clique em <b>copiar o código</b>, logo acima
              </Step>
              <Step n={2} primary={p.primary}>
                Abra o <b>aplicativo do seu banco</b>
              </Step>
              <Step n={3} primary={p.primary}>
                Selecione a opção <b>PIX</b>
              </Step>
              <Step n={4} primary={p.primary}>
                Toque em <b>&ldquo;Pix Copia e Cola&rdquo;</b>
              </Step>
              <Step n={5} primary={p.primary}>
                Insira o código copiado e finalize seu pagamento
              </Step>
            </ol>

            <p className="mt-8 text-center text-[12px] leading-relaxed text-gray-400">
              O pagamento é confirmado automaticamente após a compensação — esta página atualiza sozinha.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Step({ n, primary, children }: { n: number; primary: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
        style={{ background: primary }}
      >
        {n}
      </span>
      <span className="text-[14px] leading-6 text-gray-600">{children}</span>
    </li>
  );
}

/* Três pontinhos pulsando ao lado de "Aguardando pagamento". */
function Dots() {
  return (
    <span className="flex gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-pulse rounded-full bg-amber-500"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

