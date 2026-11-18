// Resumo MASCARADO do cartão — o que pode ser guardado no pedido.
//
// PCI-DSS: o número completo (PAN) e o CVV NUNCA são gravados. O que a norma
// permite guardar é o número truncado — 6 primeiros + 4 últimos —, além de
// bandeira, validade e nome do titular. É com isso que o painel reconhece o
// MESMO cartão em tentativas seguidas e empilha as recusas ("Recusado 3×").
//
// Puro: roda no navegador (monta o resumo antes de o cartão ser tokenizado ou
// enviado) e no servidor (deriva do número cru, quando o gateway é direto).

export type ResumoCartao = {
  bin?: string; // 6 primeiros dígitos
  last4?: string;
  brand?: string;
  expMonth?: string; // "01".."12"
  expYear?: string; // "2028"
  holder?: string;
};

/** Bandeira pelo início do número (faixas públicas das bandeiras). */
export function bandeiraDoCartao(numero: string): string | undefined {
  const d = (numero || "").replace(/\D/g, "");
  if (d.length < 6) return undefined;
  const n6 = Number(d.slice(0, 6));
  const n4 = Number(d.slice(0, 4));
  const n2 = Number(d.slice(0, 2));
  // Elo e Hipercard antes de Visa/Master: algumas faixas deles começam com 4 e 5.
  const ELO = [
    [401178, 401179], [431274, 431274], [438935, 438935], [451416, 451416], [457393, 457393],
    [457631, 457632], [504175, 504175], [506699, 506778], [509000, 509999], [627780, 627780],
    [636297, 636297], [636368, 636368], [650031, 650033], [650035, 650051], [650405, 650439],
    [650485, 650538], [650541, 650598], [650700, 650718], [650720, 650727], [650901, 650978],
    [651652, 651679], [655000, 655019], [655021, 655058],
  ];
  if (ELO.some(([a, b]) => n6 >= a && n6 <= b)) return "Elo";
  if (d.startsWith("606282") || d.startsWith("3841")) return "Hipercard";
  if (n2 === 34 || n2 === 37) return "Amex";
  if (n2 === 36 || n2 === 38 || (n4 >= 3000 && n4 <= 3059)) return "Diners";
  if (d.startsWith("6011") || d.startsWith("65") || (n6 >= 622126 && n6 <= 622925)) return "Discover";
  if (n4 >= 3528 && n4 <= 3589) return "JCB";
  if ((n2 >= 51 && n2 <= 55) || (n6 >= 222100 && n6 <= 272099)) return "Mastercard";
  if (d.startsWith("4")) return "Visa";
  return undefined;
}

/** Resumo a partir do que o cliente digitou (número, "MM/AA" e nome). */
export function resumoCartao(card: { number?: string; expiry?: string; holder?: string }): ResumoCartao {
  const d = (card.number || "").replace(/\D/g, "");
  const [mm, aa] = (card.expiry || "").split("/").map((s) => s.trim());
  const mes = (mm || "").replace(/\D/g, "");
  const ano = (aa || "").replace(/\D/g, "");
  return {
    ...(d.length >= 12 ? { bin: d.slice(0, 6), last4: d.slice(-4), brand: bandeiraDoCartao(d) } : {}),
    ...(mes ? { expMonth: mes.padStart(2, "0").slice(-2) } : {}),
    ...(ano ? { expYear: ano.length === 2 ? `20${ano}` : ano.slice(0, 4) } : {}),
    ...(card.holder?.trim() ? { holder: card.holder.trim().slice(0, 120) } : {}),
  };
}
