import "server-only";
import { query } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Cadastro (KYC) do lojista: documento e endereço em `merchant_profiles`,
// celular em `users.phone`.
//
// O cadastro em duas etapas grava tudo isso desde o início, mas as contas
// criadas ANTES dele entraram só com nome, e-mail e senha. O Pix das taxas e
// dos planos sai em nome do lojista (a Cakto exige documento e celular),
// então o painel não abre enquanto faltar algum desses dados.
// ─────────────────────────────────────────────────────────────────────────────

type Linha = {
  name: string | null;
  email: string;
  phone: string | null;
  document: string | null;
  cep: string | null;
};

async function linha(userId: string): Promise<Linha | null> {
  const [r] = await query<Linha>(
    `SELECT u.name, u.email, u.phone, mp.document, mp.cep
       FROM users u LEFT JOIN merchant_profiles mp ON mp.userId = u.id
      WHERE u.id = ? LIMIT 1`,
    [userId],
  );
  return r ?? null;
}

const temDocumento = (d: string | null) => {
  const n = (d || "").replace(/\D/g, "");
  return n.length === 11 || n.length === 14;
};
const temCelular = (t: string | null) => (t || "").replace(/\D/g, "").length >= 10;

export type SituacaoCadastro = {
  completo: boolean;
  /** Para pré-preencher a tela com o que a conta já tem. */
  nome: string;
  telefone: string;
};

export async function situacaoCadastro(userId: string): Promise<SituacaoCadastro> {
  const r = await linha(userId);
  if (!r) return { completo: false, nome: "", telefone: "" };
  return {
    completo: temDocumento(r.document) && !!r.cep && temCelular(r.phone),
    nome: r.name ?? "",
    telefone: r.phone ?? "",
  };
}

/**
 * Resposta das rotas de Pix (taxa e plano) quando o DONO da loja ainda não
 * completou o cadastro — ou null quando pode seguir.
 *
 * A trava do layout não basta sozinha: ela só roda em carga completa da
 * página. Quem estava com o painel aberto antes dela existir continua
 * navegando sem vê-la, e chegava ao botão de pagar com um erro sem saída.
 * `ehDono` diz à tela o que fazer: o dono recarrega e cai no formulário; o
 * admin, em suporte, só é avisado (o formulário grava os dados de quem está
 * logado, então não serve para preencher pela outra pessoa).
 */
export async function cadastroPendenteParaPix(donoId: string, logadoId: string) {
  if ((await situacaoCadastro(donoId)).completo) return null;
  const ehDono = donoId === logadoId;
  return {
    cadastroPendente: true as const,
    ehDono,
    error: ehDono
      ? "Complete seu cadastro para gerar o Pix."
      : "O dono desta loja ainda não completou o cadastro (CPF ou CNPJ). Ele verá o formulário ao entrar no painel.",
  };
}

/**
 * Documento ou celular já usado por OUTRA conta de lojista — devolve o campo e
 * a mensagem, ou null se estão livres.
 *
 * Uma conta já comporta várias lojas, então não há motivo legítimo para dois
 * cadastros com o mesmo CPF/CNPJ ou celular. Sem isto, um documento inventado
 * que passou uma vez servia para abrir quantas contas alguém quisesse.
 * `userId` é a conta que está gravando (null no cadastro novo): ela mesma não
 * conta como "outra".
 */
export async function documentoOuCelularEmUso(
  userId: string | null,
  documento: string,
  celular: string,
): Promise<{ campo: "document" | "phone"; mensagem: string } | null> {
  const outro = userId ?? "";
  const [doc] = await query<{ userId: string }>(
    `SELECT userId FROM merchant_profiles WHERE document = ? AND userId <> ? LIMIT 1`,
    [documento, outro],
  );
  if (doc) {
    return {
      campo: "document",
      mensagem: `Este ${documento.length === 14 ? "CNPJ" : "CPF"} já está cadastrado em outra conta. Se for seu, entre nela ou fale com o suporte.`,
    };
  }
  const [tel] = await query<{ id: string }>(
    `SELECT id FROM users WHERE phone = ? AND id <> ? AND role IN ('MERCHANT', 'ADMIN') LIMIT 1`,
    [celular, outro],
  );
  if (tel) {
    return { campo: "phone", mensagem: "Este celular já está cadastrado em outra conta. Use o seu número." };
  }
  return null;
}

/** Quem paga o Pix da VOX (taxa ou plano): o próprio lojista, com o documento dele. */
export async function pagadorDaConta(userId: string) {
  const r = await linha(userId);
  if (!r) return null;
  return { nome: r.name || "Lojista", email: r.email, documento: r.document, telefone: r.phone };
}
