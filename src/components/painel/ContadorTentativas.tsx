// "3×" ao lado do status: quantas recusas seguidas do MESMO cartão esta linha
// representa (as anteriores foram empilhadas — ver lib/card-tentativas.ts).
// Uma tentativa só não mostra nada.
export default function ContadorTentativas({ n }: { n: number | string | null | undefined }) {
  const total = Number(n ?? 1);
  if (!Number.isFinite(total) || total < 2) return null;
  return (
    <span
      title={`${total} tentativas seguidas com o mesmo cartão`}
      className="inline-flex items-center rounded-md bg-soft px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-low ring-1 ring-inset ring-line"
    >
      {total}×
    </span>
  );
}
