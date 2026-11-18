export type Etapa = {
  titulo: string;
  /** Quando aconteceu. Null = ainda não aconteceu. */
  em: Date | null;
  icone: "check" | "caixa" | "caminhao";
};

// Régua horizontal das etapas da entrega.
//
// A etapa é dada CUMPRIDA pela data, não por um status calculado: se existe
// data, aconteceu. Assim a régua nunca discorda do histórico logo abaixo.
//
// A atual é a última cumprida. Ela ganha o anel e o texto colorido; as
// seguintes ficam cinza com a linha tracejada.

function fmtData(d: Date) {
  return new Date(d).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtHora(d: Date) {
  return new Date(d).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Icone({ tipo }: { tipo: Etapa["icone"] }) {
  const p = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (tipo === "caminhao") {
    return (
      <svg {...p}>
        <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
        <circle cx="6" cy="18" r="1.6" />
        <circle cx="17" cy="18" r="1.6" />
      </svg>
    );
  }
  if (tipo === "caixa") {
    return (
      <svg {...p}>
        <path d="M3 8l9-4 9 4v8l-9 4-9-4z" />
        <path d="M3 8l9 4 9-4M12 12v8" />
      </svg>
    );
  }
  return (
    <svg {...p}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function Etapas({
  etapas,
  cor,
  corTexto,
}: {
  etapas: Etapa[];
  cor: string;
  corTexto: string;
}) {
  const cumpridas = etapas.map((e) => Boolean(e.em));
  // Última cumprida = etapa atual. -1 quando nada aconteceu ainda.
  const atual = cumpridas.lastIndexOf(true);

  return (
    // Rola no celular em vez de espremer seis colunas num telefone.
    <div className="-mx-1 overflow-x-auto pb-1">
      <ol className="flex min-w-[560px] items-start">
        {etapas.map((e, i) => {
          const feita = cumpridas[i];
          const eAtual = i === atual;
          return (
            <li key={e.titulo} className="flex flex-1 flex-col items-center px-1 text-center">
              <div className="flex w-full items-center">
                {/* Trecho à esquerda: contínuo se a etapa anterior foi cumprida. */}
                <span
                  className="h-[3px] flex-1 rounded-full"
                  style={{
                    background: i === 0 ? "transparent" : cumpridas[i - 1] && feita ? cor : "transparent",
                    backgroundImage:
                      i === 0 || (cumpridas[i - 1] && feita)
                        ? undefined
                        : "repeating-linear-gradient(to right,#d1d5db 0 5px,transparent 5px 10px)",
                  }}
                />
                <span
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition"
                  style={{
                    background: feita ? cor : "#f3f4f6",
                    color: feita ? corTexto : "#9ca3af",
                    // Anel só na atual: dá o foco do "você está aqui".
                    boxShadow: eAtual ? `0 0 0 4px ${cor}26` : undefined,
                  }}
                >
                  <Icone tipo={e.icone} />
                </span>
                <span
                  className="h-[3px] flex-1 rounded-full"
                  style={{
                    background: i === etapas.length - 1 ? "transparent" : feita && cumpridas[i + 1] ? cor : "transparent",
                    backgroundImage:
                      i === etapas.length - 1 || (feita && cumpridas[i + 1])
                        ? undefined
                        : "repeating-linear-gradient(to right,#d1d5db 0 5px,transparent 5px 10px)",
                  }}
                />
              </div>

              <span
                className={`mt-2 text-[12px] font-semibold leading-tight ${feita ? "" : "text-gray-400"}`}
                style={eAtual ? { color: cor } : feita ? { color: "#1f2937" } : undefined}
              >
                {e.titulo}
              </span>
              {e.em && (
                <span className="mt-0.5 text-[11px] leading-tight text-gray-400">
                  {fmtData(e.em)}
                  <br />
                  {fmtHora(e.em)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
