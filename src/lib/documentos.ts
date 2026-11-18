// ─────────────────────────────────────────────────────────────────────────────
// CPF, CNPJ e celular do CADASTRO do lojista.
//
// Sem dependências de propósito: o servidor (lib/validation.ts) e as telas
// (login, CompletarCadastro) usam as MESMAS funções. O navegador avisa na hora
// e o servidor recusa com a mesma regra, sem uma cópia que saia do lugar.
//
// O limite do que dá para garantir aqui: um CPF inventado num gerador passa
// no dígito verificador, e um celular bem formado pode não ser de quem digitou.
// Isto barra o falso ÓBVIO (exemplo de tutorial, sequência, número repetido,
// DDD que não existe); o reaproveitamento entre contas é barrado nas rotas de
// cadastro, que consultam o banco.
// ─────────────────────────────────────────────────────────────────────────────

const soDigitos = (v: string) => String(v ?? "").replace(/\D/g, "");

/** Valida CPF de verdade (dígitos verificadores), não só o formato. */
export function isValidCPF(raw: string): boolean {
  const cpf = soDigitos(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // rejeita 111.111.111-11 etc.

  const calcDigit = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += parseInt(slice[i], 10) * (factorStart - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  const d1 = calcDigit(cpf.slice(0, 9), 10);
  if (d1 !== parseInt(cpf[9], 10)) return false;
  const d2 = calcDigit(cpf.slice(0, 10), 11);
  if (d2 !== parseInt(cpf[10], 10)) return false;
  return true;
}

/** Valida CNPJ de verdade (dígitos verificadores). */
export function isValidCNPJ(raw: string): boolean {
  const c = soDigitos(raw);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const digito = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digito(c.slice(0, 12)) === parseInt(c[12], 10) && digito(c.slice(0, 13)) === parseInt(c[13], 10);
}

/** Dígitos consecutivos, subindo ou descendo ("12345678", "87654321"). */
function emSequencia(s: string): boolean {
  if (s.length < 2) return false;
  const passo = Number(s[1]) - Number(s[0]);
  if (passo !== 1 && passo !== -1) return false;
  for (let i = 1; i < s.length; i++) if (Number(s[i]) - Number(s[i - 1]) !== passo) return false;
  return true;
}

// Documentos que circulam em documentação, tutoriais e geradores de teste.
// Passam no dígito verificador e são os primeiros que alguém digita para
// atravessar um cadastro.
const CPFS_DE_EXEMPLO = new Set([
  "12345678909", // o "CPF de exemplo" clássico
  "11144477735", // exemplo da explicação do cálculo, repetido em todo tutorial
  "52998224725", // exemplo de bibliotecas de validação
  "01234567890",
  "98765432100",
  "12312312387",
  "11122233396",
]);
const CNPJS_DE_EXEMPLO = new Set([
  "11222333000181", // exemplo da explicação do cálculo
  "12345678000195",
  "11444777000161",
]);

/**
 * Motivo para recusar o CPF/CNPJ do cadastro, ou null se passa.
 * Aceita com ou sem máscara.
 */
export function motivoDocumentoInvalido(raw: string): string | null {
  const d = soDigitos(raw);
  if (d.length === 11) {
    if (!isValidCPF(d)) return "CPF inválido. Confira os números.";
    // A base (9 primeiros) em sequência é inventada: 123.456.789-09.
    if (CPFS_DE_EXEMPLO.has(d) || emSequencia(d.slice(0, 9))) return "Informe o seu CPF verdadeiro.";
    return null;
  }
  if (d.length === 14) {
    if (!isValidCNPJ(d)) return "CNPJ inválido. Confira os números.";
    // Só a lista de exemplos: a raiz do CNPJ é numerada em sequência pela
    // Receita, então raiz repetida ou em sequência pode ser empresa real (o
    // Banco do Brasil é 00.000.000/0001-91).
    if (CNPJS_DE_EXEMPLO.has(d)) return "Informe o CNPJ verdadeiro da empresa.";
    return null;
  }
  return "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).";
}

/**
 * DDDs que existem no plano de numeração da Anatel. Um "20" ou "30" passava
 * no formato antigo (dois dígitos de 1 a 9) e não liga para lugar nenhum.
 */
export const DDDS = new Set([
  "11", "12", "13", "14", "15", "16", "17", "18", "19", // SP
  "21", "22", "24", // RJ
  "27", "28", // ES
  "31", "32", "33", "34", "35", "37", "38", // MG
  "41", "42", "43", "44", "45", "46", // PR
  "47", "48", "49", // SC
  "51", "53", "54", "55", // RS
  "61", // DF
  "62", "64", // GO
  "63", // TO
  "65", "66", // MT
  "67", // MS
  "68", // AC
  "69", // RO
  "71", "73", "74", "75", "77", // BA
  "79", // SE
  "81", "87", // PE
  "82", // AL
  "83", // PB
  "84", // RN
  "85", "88", // CE
  "86", "89", // PI
  "91", "93", "94", // PA
  "92", "97", // AM
  "95", // RR
  "96", // AP
  "98", "99", // MA
]);

/** Celular só com dígitos, sem o 55 do país. */
export function normalizarCelular(raw: string): string {
  return soDigitos(raw).replace(/^55(?=\d{11}$)/, "");
}

/**
 * Motivo para recusar o celular do cadastro, ou null se passa.
 * Aceita com ou sem máscara e com ou sem o 55.
 */
export function motivoCelularInvalido(raw: string): string | null {
  const d = normalizarCelular(raw);
  if (d.length !== 11) return "Informe o celular com DDD (11 dígitos).";
  if (!DDDS.has(d.slice(0, 2))) return "Esse DDD não existe. Confira o celular.";
  if (d[2] !== "9") return "Informe um celular (o número começa com 9 depois do DDD).";
  // Os 8 dígitos depois do 9: repetidos (9 9999-9999) ou em sequência
  // (9 1234-5678, 9 8765-4321) são os números que se digita para não dar o seu.
  const assinante = d.slice(3);
  if (/^(\d)\1{7}$/.test(assinante) || emSequencia(assinante)) return "Informe o seu número de celular verdadeiro.";
  return null;
}
