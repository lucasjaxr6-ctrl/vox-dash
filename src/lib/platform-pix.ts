import "server-only";
import { caktoConfigurada, criarPixCakto, consultarPixCakto, minimoCobrancaCakto, PREFIXO_TXN_CAKTO } from "./cakto-plataforma";

// ─────────────────────────────────────────────────────────────────────────────
// Pix DA PLATAFORMA (taxas e planos), na conta Cakto da VOX.
//
// Não confundir com os gateways das lojas (lib/hylexpay.ts e afins): aqueles
// cobram o COMPRADOR com a credencial de cada loja; este cobra o LOJISTA com
// a credencial da VOX.
//
// Histórico: PushinPay → HylexPay (out/2026) → Cakto (23/10/2026). A HylexPay
// saiu da cobrança da plataforma no mesmo dia, sem nenhum Pix dela em aberto;
// os ids antigos (número ou UUID) ficam no histórico e não são mais
// consultados. O cliente da API e as regras estão em lib/cakto-plataforma.ts.
//
// O pagador é SEMPRE o lojista, com o documento do cadastro dele, nunca um
// documento da VOX como reserva. Conta sem documento não chega aqui: o painel
// trava até o cadastro ser completado (lib/merchant-profile.ts).
// ─────────────────────────────────────────────────────────────────────────────

/** Existe credencial configurada? Usado só para a tela explicar o que falta. */
export function temPixPlataforma(): boolean {
  return caktoConfigurada();
}

/**
 * Menor Pix possível: a oferta mínima da Cakto (R$ 5,00) mais a taxa que ela
 * soma ao pagador e que a VOX absorve (R$ 0,99 hoje), ou seja, R$ 5,99. Abaixo
 * disso a taxa acumula para a próxima cobrança, e a conta não é suspensa por
 * um saldo que não teria como pagar (statusCobrancaLoja).
 */
export function minimoPixPlataforma(): number {
  return minimoCobrancaCakto();
}

export type Pagador = { nome: string; email: string; documento?: string | null; telefone?: string | null };

function documentoDoPagador(p: Pagador): string | null {
  const doc = (p.documento || "").replace(/\D/g, "");
  return doc.length === 11 || doc.length === 14 ? doc : null;
}

/**
 * Cria um Pix na conta da VOX.
 *
 * Erro técnico vai para o log e não para a tela: quem lê é o lojista, e
 * "customer.document: inválido" não diz nada para ele.
 *
 * `externalRef` é o id da NOSSA cobrança e vira a chave de idempotência na
 * Cakto: repetir a chamada devolve o mesmo Pix em vez de criar outro.
 */
export async function criarPixPlataforma(input: {
  valorCents: number;
  titulo: string;
  externalRef: string;
  pagador: Pagador;
  validadeMinutos: number;
}): Promise<{ ok: true; txnId: string; qrCode: string } | { ok: false; erro: string }> {
  const doc = documentoDoPagador(input.pagador);
  if (!doc) return { ok: false, erro: "Complete seu cadastro (CPF ou CNPJ) para gerar o Pix." };
  return criarPixCakto({
    valorCents: input.valorCents,
    titulo: input.titulo,
    chaveIdempotencia: input.externalRef,
    validadeMinutos: input.validadeMinutos,
    pagador: { nome: input.pagador.nome, email: input.pagador.email, documento: doc, telefone: input.pagador.telefone },
  });
}

/** Id de cobrança que dá para consultar: só os da Cakto ("ck_<uuid>"). */
export const ehTxnConsultavel = (txnId: string | null | undefined) => !!txnId && txnId.startsWith(PREFIXO_TXN_CAKTO);

/**
 * Status de um Pix nosso, consultado com a nossa credencial: "paid" quando
 * pago. É o que dá confiança ao webhook: um POST forjado não quita nada.
 */
export async function consultarPixPlataforma(txnId: string): Promise<string | null> {
  return ehTxnConsultavel(txnId) ? consultarPixCakto(txnId) : null;
}
