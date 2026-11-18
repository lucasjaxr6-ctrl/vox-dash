// Separa o que o CLIENTE escreveu do histórico citado que o programa de e-mail
// dele cola junto.
//
// Sem isto a caixa de entrada vira um muro: a pessoa digita duas linhas e o
// Gmail/Yahoo devolve junto o e-mail inteiro da loja, com Pix, tabela de itens
// e rodapé. O que ela queria dizer some no meio.
//
// REGRA DA TELA: só existe "resposta" quando há citação — ou seja, quando a
// pessoa respondeu um e-mail nosso. Mensagem original (alguém escrevendo do
// zero para a loja) é só mensagem, e `temCitacao` volta false.
//
// Módulo PURO de propósito — dá para testar sem banco nem rede.

/**
 * Atribuição que o programa de e-mail coloca antes da citação.
 *
 * NÃO dá para ancorar no fim da linha: o Gmail pt-BR quebra em duas
 * ("Em <data>, Fulano <e@mail>" + "escreveu:") e o Yahoo cola a citação inteira
 * na MESMA linha ("... <noreply@loja.com> escreveu:   Seu Pix ainda está..."),
 * o que fazia o corte não acontecer e a resposta sair com o e-mail todo junto.
 *
 * Três exigências juntas evitam falso positivo: a linha COMEÇA com a preposição
 * de data, tem um ENDEREÇO DE E-MAIL no meio, e termina em "escreveu:". Assim
 * uma frase comum como "O atendente escreveu: o prazo era 5 dias" não casa.
 */
const ATRIBUICAO =
  /(?:^|\n)[ \t]*(?:em|on|le|am|el)\b[\s\S]{0,250}?@[\s\S]{0,160}?(?:escreveu|wrote|a écrit|schrieb|escribió)\s*:/i;

/** Separadores explícitos (Outlook, Apple Mail, listas). */
const SEPARADORES = [
  /(?:^|\n)[ \t]*-{2,}\s*(?:mensagem original|original message|forwarded message)\s*-{2,}/i,
  /(?:^|\n)_{5,}[ \t]*(?:\n|$)/,
  /(?:^|\n)-{5,}[ \t]*(?:\n|$)/,
  // Cabeçalho do Outlook. Exige um e-mail na linha, senão "De: acordo com o
  // combinado..." viraria corte e engoliria a mensagem da pessoa.
  /(?:^|\n)[ \t]*(?:de|from)[ \t]*:[ \t]*[^\n]*@[^\n]*/i,
];

/** Primeira linha citada com ">". */
const CITACAO = /(?:^|\n)[ \t]?>/;

/** Rodapé que o app carimba sozinho — vem colado na resposta, mas não é dela. */
const RODAPES = [
  /^[ \t]*yahoo\s*mail[ \t]*:.*$/gim,
  /^[ \t]*enviado (?:do|pelo) meu .*$/gim,
  /^[ \t]*sent from my .*$/gim,
  /^[ \t]*(?:obtenha o|get) outlook (?:para|for) .*$/gim,
];

/** Assinatura: "-- " sozinho na linha (RFC 3676). */
const ASSINATURA = /^--\s?$/;

export type RespostaSeparada = {
  /** O que a pessoa escreveu agora. Vazio quando ela só citou, sem escrever. */
  resposta: string;
  /** O histórico citado, já sem os ">" — vazio quando não havia citação. */
  citado: string;
  /** Há citação? Falso = mensagem original, não é resposta a nada. */
  temCitacao: boolean;
  /**
   * E-mail de quem escreveu o trecho CITADO, tirado da linha de atribuição.
   *
   * Nem toda citação é de um e-mail nosso: o cliente pode responder a uma
   * mensagem que ele mesmo mandou. Sem isto a tela rotulava tudo como "e-mail
   * que a loja enviou" e mentia nesses casos.
   */
  autorCitado: string | null;
};

/** Posição (em caracteres) onde o padrão casa, descontando o \n inicial. */
function acharIndice(texto: string, re: RegExp): number {
  const m = texto.match(re);
  if (!m || m.index === undefined) return -1;
  return m[0].startsWith("\n") ? m.index + 1 : m.index;
}

/** Primeiro endereço de e-mail dentro de um trecho. */
function primeiroEmail(trecho: string): string | null {
  const m = trecho.match(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Divide o corpo em TEXTO da resposta e histórico citado.
 *
 * Trabalha por POSIÇÃO, não por linha: o Yahoo emenda a citação inteira na
 * mesma linha da atribuição, então cortar "a partir da linha tal" deixava o
 * e-mail todo dentro da resposta.
 */
export function separarResposta(textBody: string | null | undefined): RespostaSeparada {
  const texto = (textBody ?? "").replace(/\r\n/g, "\n");
  if (!texto.trim()) return { resposta: "", citado: "", temCitacao: false, autorCitado: null };

  // A citação começa no PRIMEIRO desses marcadores. A atribuição costuma vir
  // antes do ">", então o mínimo é o corte certo.
  const mAtribuicao = texto.match(ATRIBUICAO);
  const candidatos = [
    acharIndice(texto, ATRIBUICAO),
    acharIndice(texto, CITACAO),
    ...SEPARADORES.map((re) => acharIndice(texto, re)),
  ].filter((i) => i >= 0);

  if (candidatos.length === 0) {
    // Nenhuma citação: é mensagem original, não resposta.
    return { resposta: "", citado: limparCorpo(texto), temCitacao: false, autorCitado: null };
  }

  const corte = Math.min(...candidatos);
  const resposta = limparResposta(texto.slice(0, corte));
  const citado = limparCorpo(texto.slice(corte).split("\n").map(desciteLinha).join("\n"));
  // O autor sai da própria atribuição ("Em <data>, Fulano <e@mail> escreveu:").
  // Quando o corte veio de um separador do Outlook, procura no cabeçalho "De:".
  const autorCitado =
    primeiroEmail(mAtribuicao?.[0] ?? "") ??
    primeiroEmail(texto.slice(corte, corte + 400).match(/^[ \t]*(?:de|from)[ \t]*:[^\n]*/im)?.[0] ?? "");
  return { resposta, citado, temCitacao: true, autorCitado };
}

function desciteLinha(linha: string): string {
  // Remove um nível de citação: "> texto" -> "texto"; ">> x" -> "> x".
  return linha.replace(/^\s?>\s?/, "");
}

/** Limpeza comum: espaços à direita e buracos de linhas vazias. */
function limparCorpo(s: string): string {
  return s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Na resposta, ainda tira assinatura e rodapé carimbado pelo app. */
function limparResposta(s: string): string {
  let t = s;
  for (const re of RODAPES) t = t.replace(re, "");
  const linhas = t.replace(/[ \t]+$/gm, "").split("\n");
  const fimAssinatura = linhas.findIndex((l) => ASSINATURA.test(l));
  const uteis = fimAssinatura === -1 ? linhas : linhas.slice(0, fimAssinatura);
  return uteis.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recorta do HTML só o trecho CITADO — o e-mail que a loja mandou.
 *
 * Serve para a seção "Mensagem original" mostrar o e-mail formatado do mesmo
 * jeito que na aba Enviados, sem repetir em cima o texto que a pessoa escreveu
 * (que já aparece destacado) e sem a barra/indentação da citação, que empurrava
 * o conteúdo para fora e criava rolagem horizontal.
 *
 * Corta DEPOIS da tag de abertura do bloco de citação; as tags de fechamento
 * que sobram no final são inofensivas — o navegador do iframe as ignora.
 */
export function extrairCitacaoHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const baixo = html.toLowerCase();

  // Marcadores por cliente de e-mail; o Yahoo não usa classe nenhuma e cai no
  // <blockquote> genérico, que fica por último de propósito.
  const marcas = ["gmail_quote", "yahoo_quoted", "appendonsend", "divrplyfwdmsg", "<blockquote"];
  let idx = -1;
  for (const m of marcas) {
    const i = baixo.indexOf(m);
    if (i >= 0 && (idx === -1 || i < idx)) idx = i;
  }
  if (idx === -1) return null;

  // O marcador pode cair no MEIO da tag (ex.: class="gmail_quote"): recua até o
  // "<" que abre, depois avança até o ">" que fecha essa abertura.
  const abre = html.lastIndexOf("<", idx);
  if (abre === -1) return null;
  const fecha = html.indexOf(">", abre);
  if (fecha === -1) return null;

  const interno = html.slice(fecha + 1).trim();
  return interno.length > 0 ? interno : null;
}
