// Tipos compartilhados pelos gateways de Pix.
//
// Moravam em lib/transfyre.ts (o primeiro gateway do sistema) e todos os
// outros importavam de lá. Com a remoção da Transfyre (02/10/2026), viraram um
// módulo neutro.

/** Comprador, no formato que todos os gateways recebem. */
export type PixCustomer = {
  name: string;
  email: string;
  /** CPF (ou CNPJ), só dígitos. */
  document: string;
  phone: string;
};

/** Cobrança Pix criada, normalizada entre os gateways. */
export type PixCharge = {
  /** Id da transação no gateway (vira `orders.providerTxnId`). */
  id: string;
  /** Status no vocabulário interno (APPROVED / DECLINED / REFUNDED / CHARGEBACK / PENDING). */
  status: string;
  /** Copia e cola. */
  qrCode: string;
  /** Imagem do QR, quando o gateway devolve uma. */
  qrCodeUrl: string | null;
  /** Vencimento em ISO, quando o gateway informa. */
  expiresAt: string | null;
};
