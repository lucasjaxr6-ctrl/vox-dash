import Link from "next/link";

const brl = (c: number) => (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Aviso de taxa em aberto, antes da suspensão.
 *
 * Existe para que ninguém seja suspenso de surpresa: a suspensão corta o
 * painel, e cortar sem avisar transforma um lembrete de pagamento em
 * sensação de bloqueio arbitrário.
 *
 * Fica quieto quando não há nada em aberto ou quando ainda falta bastante —
 * um aviso permanente vira paisagem e deixa de ser lido justamente quando
 * passa a importar.
 */
export default function AvisoCobranca({
  pendentesCents,
  diasRestantes,
}: {
  pendentesCents: number;
  diasRestantes: number;
}) {
  if (pendentesCents <= 0 || diasRestantes > 2) return null;

  const hoje = diasRestantes <= 0;
  return (
    <div
      className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
        hoje ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <p className="text-sm text-mid">
        <b className={hoje ? "text-red-500" : "text-amber-600"}>
          {hoje ? "Pague hoje para não perder o acesso." : `Faltam ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"}.`}
        </b>{" "}
        Você tem {brl(pendentesCents)} de taxa em aberto. Sem o pagamento, sua conta é suspensa e você perde o acesso
        a este painel.
      </p>
      <Link
        href="/painel/taxas"
        className="flex-shrink-0 rounded-lg bg-brand px-3.5 py-2 text-xs font-bold text-white transition hover:bg-brand-hover"
      >
        Pagar agora
      </Link>
    </div>
  );
}
