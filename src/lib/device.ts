// Dispositivo de origem do pedido, a partir do User-Agent.
//
// Serve para o painel comparar vendas de celular x computador. É classificação
// grosseira DE PROPÓSITO: não queremos identificar o aparelho, só separar em
// dois baldes. Nada aqui é usado para cobrança ou antifraude — se errar, o
// máximo que acontece é uma venda cair no balde errado no relatório.

export type Device = "MOBILE" | "TABLET" | "DESKTOP";

/**
 * Classifica o User-Agent. Devolve `null` quando o cabeçalho não veio (bot,
 * cliente esquisito): melhor gravar NULL e contar como "não identificado" do
 * que chutar "computador" e sujar o relatório.
 *
 * A ordem importa: tablet ANTES de celular. O Android de tablet manda "Android"
 * sem "Mobile" — testar celular primeiro classificaria todo tablet Android como
 * celular.
 */
export function detectDevice(userAgent: string | null | undefined): Device | null {
  const ua = (userAgent || "").trim();
  if (!ua) return null;
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobile))/i.test(ua)) return "TABLET";
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone|webos/i.test(ua)) return "MOBILE";
  return "DESKTOP";
}
