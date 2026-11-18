export default function Placeholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-hi">{title}</h1>
      {description && <p className="mt-2 text-sm text-low">{description}</p>}
      <div className="mt-6 rounded-xl bg-card p-12 text-center text-dim">
        Em construção — próximo passo do desenvolvimento.
      </div>
    </div>
  );
}
