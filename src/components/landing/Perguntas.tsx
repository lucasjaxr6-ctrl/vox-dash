import { PERGUNTAS } from "./conteudo";
import Icone from "./Icone";

/**
 * Perguntas frequentes em <details> nativo: abre e fecha sem JS, com teclado,
 * e o `name` em comum faz uma pergunta fechar a outra onde o navegador suporta.
 */
export default function Perguntas() {
  return (
    <div className="accordion reveal delay-1">
      {PERGUNTAS.map((q, i) => (
        <details key={q.p} name="perguntas" open={i === 0}>
          <summary>
            {q.p}
            <span>
              <Icone nome="mais" tamanho={18} />
            </span>
          </summary>
          <p>{q.r}</p>
        </details>
      ))}
    </div>
  );
}
