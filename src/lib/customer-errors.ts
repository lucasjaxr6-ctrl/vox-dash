import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Fronteira entre o erro TÉCNICO e o que o COMPRADOR pode ver.
//
// As mensagens que os gateways lançam são escritas para o LOJISTA e para quem
// integra: citam o nome do gateway, dizem que a adquirente da conta não está
// ativa, mandam falar com o suporte, expõem campo de API. Nada disso pode
// chegar ao cliente final — além de não ajudá-lo em nada, expõe a operação da
// loja e destrói a confiança na hora de pagar.
//
// Regra: o cliente recebe uma mensagem curta e acionável; o motivo real vai
// para o log e para o pedido (providerPayload), onde o lojista consegue ver.
//
// É uma LISTA BRANCA: só o que casar aqui chega ao comprador, e sempre com o
// nosso texto, nunca com a frase do gateway. Motivo novo que ninguém listou cai
// no texto padrão, que é o lado seguro do erro.
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_GENERIC = "Não foi possível concluir o pagamento com este cartão. Tente outro cartão ou pague com Pix.";
export const PIX_GENERIC = "Não foi possível gerar o Pix agora. Tente novamente em instantes.";

const SALDO = "Cartão sem saldo ou limite disponível.";
const CVV = "Código de segurança (CVV) inválido.";
const VALIDADE = "Data de validade do cartão inválida.";
const NUMERO = "Número do cartão inválido.";
const DADOS = "Dados inválidos. Confira o número do cartão, a validade e o CVV.";
const CPF = "CPF inválido. Confira os números.";
const BANDEIRA = "Bandeira do cartão não aceita. Tente um cartão de outra bandeira ou pague com Pix.";
const NAO_ACEITO = "Este cartão não é aceito. Tente outro cartão ou pague com Pix.";
const NAO_PERMITIDA = "Transação não permitida para este cartão. Tente outro cartão ou pague com Pix.";
const NAO_AUTORIZADA = "Transação não autorizada. Tente outro cartão ou pague com Pix.";
const NAO_AUTORIZADA_REVISE = "Transação não autorizada. Confira os dados do cartão ou tente outro cartão.";
const ACIMA_DO_MAXIMO = "O valor do pedido está acima do máximo por transação.";

// O Mercado Pago manda um código, não uma frase. "Risco alto" vira "não
// autorizada" de propósito: o comprador não precisa saber que foi o antifraude.
const CODIGOS_MERCADO_PAGO: Record<string, string> = {
  cc_rejected_insufficient_amount: SALDO,
  cc_rejected_bad_filled_security_code: CVV,
  cc_rejected_bad_filled_date: VALIDADE,
  cc_rejected_bad_filled_card_number: NUMERO,
  cc_rejected_bad_filled_other: DADOS,
  cc_rejected_call_for_authorize: "Você precisa autorizar o pagamento com o banco emissor.",
  cc_rejected_high_risk: NAO_AUTORIZADA,
};

/**
 * Só a frase do gateway. O que vem depois é o corpo técnico que guardamos para
 * depurar (nomes de campo e dados do pedido): um "expirationMonth" ou um endereço
 * com "Validade" ali dentro casaria com a regra errada.
 */
export function fraseDoGateway(bruto: string): string {
  return bruto.split(/\s(?:enviado|corpo|resposta)=/)[0];
}

/** "2.000,00" → 2000; "0,01" → 0.01; "490.00" → 490; "490" → 490. */
function reaisDe(txt: string): number {
  if (txt.includes(",")) return Number(txt.replace(/\./g, "").replace(",", "."));
  if (/^\d+\.\d{2}$/.test(txt)) return Number(txt);
  return Number(txt.replace(/\./g, ""));
}

/**
 * Teto de valor por transação, no cartão e no Pix. O número muda de gateway para
 * gateway, então sai sempre da frase dele, nunca daqui. Sem número confiável, avisa
 * sem citar valor: o "padrão R$ 300,00" da MushPag não é necessariamente o da conta.
 */
function motivoDeLimite(raw: string): string | null {
  const valor = /(?:valor|limite) m[áa]ximo\b.{0,60}?R\$\s*(\d(?:[\d.,]*\d)?)/i.exec(raw);
  // Teto irrisório não é teto, é conta do lojista sem limite liberado (a Wappi
  // mandou "limite máximo de R$ 0,01 para esta empresa"). Mostrar "o valor
  // máximo é R$ 0,01" ao cliente seria absurdo e exporia a conta: texto padrão.
  if (valor && reaisDe(valor[1]) < 5) return null;
  // Espaço que não quebra: no celular, a linha separava o "R$" do número.
  if (valor) return `O valor máximo por transação é de R$ ${valor[1]}.`;
  return /valor[^.]{0,30}acima do (limite por|m[áa]ximo)|limit_exceeded/i.test(raw) ? ACIMA_DO_MAXIMO : null;
}

/**
 * Causas que o COMPRADOR consegue resolver sozinho. Devolve o texto para ele, ou
 * null quando o motivo não é da conta dele (conta bloqueada no gateway, falha
 * técnica, recusa sem motivo).
 */
export function motivoDoCartao(bruto: string): string | null {
  const raw = fraseDoGateway(bruto);
  const t = raw.toLowerCase();

  const codigo = CODIGOS_MERCADO_PAGO[t.trim()];
  if (codigo) return codigo;

  const limite = motivoDeLimite(raw);
  if (limite) return limite;

  // LISTA DE VALIDAÇÃO ≠ problema de um campo. Quando o gateway recusa o corpo
  // inteiro, ele devolve todos os campos de uma vez ("card.number is required,
  // card.holderName is required, card.cvv is required…"). A primeira regra que
  // casasse — CVV — mandava o cliente conferir um campo que estava certo.
  // Aconteceu de verdade na integração da Beehive: o problema era o formato do
  // token, e o comprador foi orientado a olhar o código de segurança.
  const camposCitados = ["number", "holdername", "expiration", "cvv", "validade"].filter((c) => t.includes(c)).length;
  if (camposCitados >= 3) return null;

  // A Beehive diz só "recusada por regra de negócio": a bandeira está no código
  // `reason`. Vem antes da trava de conta porque "bandeira não habilitada" é
  // justamente o que o comprador resolve trocando de cartão.
  if (/card_brand_disabled|bandeira[^.]*n[ãa]o (aceita|permitida|habilitada|suportada)|bandeira inv[áa]lida|brand[^.]*(not (accepted|supported|allowed)|unsupported)/.test(t)) return BANDEIRA;

  // Problema da CONTA da loja, nunca do comprador. Credencial errada também
  // (HTTP 401/403): "Não autorizado" ali não é a transação sendo negada.
  if (/bloquead|n[ãa]o habilitad|not enabled|not supported by the company|suporte|antifraude|sua conta|\[http 40[13]\b/.test(t)) return null;

  if (/saldo|limite insuficiente|insufficient/.test(t)) return SALDO;
  if (/cvv|c[óo]digo de seguran[çc]a|security code/.test(t)) return CVV;
  if (/validade|expirat|expired card|card (has )?expired|cart[ãa]o (vencido|expirado)/.test(t)) return VALIDADE;
  if (/n[úu]mero do cart[ãa]o|card number/.test(t)) return NUMERO;
  // Depois das regras de campo: "Dados inválidos: card.number..." é mais útil
  // apontando o número do que pedindo para conferir tudo.
  if (/dados( do cart[ãa]o)? inv[áa]lidos|invalid card details|invalid_card|cart[ãa]o inv[áa]lido/.test(t)) return DADOS;
  if (/document number invalid|documento inv[áa]lido|cpf[^.]*inv[áa]lido/.test(t)) return CPF;
  if (/card is not accepted|cart[ãa]o n[ãa]o aceito/.test(t)) return NAO_ACEITO;
  if (/n[ãa]o permitida para (o|este) cart[ãa]o|transaction not (allowed|permitted)/.test(t)) return NAO_PERMITIDA;
  // "Não autorizada" NÃO vira "fale com o seu banco". A recusa pode vir do
  // emissor, do adquirente ou do antifraude da conta da loja, e a API não
  // distingue. Mandar o cliente ligar para o banco por um problema da loja o faz
  // perder tempo, então o texto só aponta o que ele pode fazer aqui. O detalhe do
  // emissor ("suspeita de fraude", "conta encerrada") fica só para o lojista.
  if (/transa[çc][ãa]o n[ãa]o autorizada|pagamento n[ãa]o autorizado|recusad[ao] pelo (banco )?emissor|recusa do (banco )?emissor|do not honou?r/.test(t)) {
    return /revise|confira/.test(t) ? NAO_AUTORIZADA_REVISE : NAO_AUTORIZADA;
  }
  // Endereço incompleto barra a autenticação do cartão (3DS) antes mesmo de
  // chamar o gateway. É a única causa aqui que o comprador resolve preenchendo o
  // formulário, então vale dizer EXATAMENTE o que falta.
  const incompleto = /endere[çc]o incompleto para a autentica[çc][ãa]o.*falta: ([^)]+)/i.exec(raw);
  if (incompleto) return `Complete o endereço de entrega para pagar com cartão. Falta: ${incompleto[1]}.`;
  return null;
}

/** Mensagem de cartão segura para exibir ao comprador. */
export function safeCardMessage(raw: string): string {
  return motivoDoCartao(raw) ?? CARD_GENERIC;
}

/** Mensagem de Pix segura para exibir ao comprador. */
export function safePixMessage(raw: string): string {
  // Em Pix não há dado que o comprador corrija: se a cobrança não foi gerada, o
  // problema é da loja ou do gateway. A exceção é o teto de valor, que ele resolve
  // diminuindo o pedido ou trocando a forma de pagamento.
  return motivoDeLimite(fraseDoGateway(raw)) ?? PIX_GENERIC;
}
