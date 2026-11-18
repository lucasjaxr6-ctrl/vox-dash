// Frase de erro que uma API de gateway devolveu, onde quer que ela esteja no corpo.
//
// A Wappi respondeu 400 com o motivo aninhado ("Valor da transação (R$ 565,25)
// excede o limite máximo de R$ 0,01 para esta empresa.") e a leitura antiga, que
// olhava só `message` no primeiro nível, gravou "HTTP 400" no pedido: o lojista
// ficou sem saber que era a conta dele travada.

const PREFERIDAS = ["message", "mensagem", "msg", "detail", "error_description", "reason", "motivo", "title", "error", "erro"];
const DESCER = /^(error|erro|errors|erros|data|details|detalhes|result|response)$/i;

function campo(obj: Record<string, unknown>, nome: string): unknown {
  const k = Object.keys(obj).find((x) => x.toLowerCase() === nome);
  return k === undefined ? undefined : obj[k];
}

/**
 * Primeira frase legível do corpo de erro: procura as chaves de mensagem em cada
 * nível, depois desce em error/errors/data. Lista de strings vira uma frase só.
 * `texto` é o corpo cru, usado quando não é JSON (e não é uma página HTML).
 */
export function mensagemDaApi(data: unknown, texto = ""): string {
  const fila: unknown[] = [data];
  for (let guard = 0; fila.length && guard < 200; guard++) {
    const cur = fila.shift();
    if (typeof cur === "string") {
      if (cur.trim()) return cur.trim().slice(0, 300);
      continue;
    }
    if (Array.isArray(cur)) {
      const frases = cur.filter((x): x is string => typeof x === "string" && !!x.trim());
      if (frases.length) return frases.slice(0, 3).join("; ").slice(0, 300);
      fila.push(...cur.slice(0, 20));
      continue;
    }
    if (!cur || typeof cur !== "object") continue;
    const obj = cur as Record<string, unknown>;
    for (const nome of PREFERIDAS) {
      const v = campo(obj, nome);
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
    }
    for (const [k, v] of Object.entries(obj)) if (DESCER.test(k) && v && typeof v === "object") fila.push(v);
  }
  const cru = texto.trim();
  return cru && !cru.startsWith("<") && cru.length <= 300 ? cru : "";
}

/** Lê o corpo uma vez: JSON quando dá, e o texto cru para a mensagem de erro. */
export async function lerCorpo(res: Response): Promise<{ data: any; texto: string }> {
  const texto = await res.text().catch(() => "");
  try {
    return { data: texto ? JSON.parse(texto) : {}, texto };
  } catch {
    return { data: {}, texto };
  }
}
