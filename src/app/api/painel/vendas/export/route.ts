import { requireStore } from "@/lib/stores";
import { query } from "@/lib/db";
import { handleError } from "@/lib/http";
import { montarCsv, dinheiro, dataHoraBr, respostaCsv } from "@/lib/csv";

// GET /api/painel/vendas/export?status=PAID&email=fulano&cripto=1
//
// Exporta as vendas DA LOJA ATIVA em CSV, com os MESMOS filtros da tela de
// Vendas: quem filtrou "Pagos" e baixou, espera baixar os pagos — um arquivo
// com tudo misturado obrigaria a refazer o filtro no Excel.
//
// `cripto=1`: a coluna Produtos sai com o nome MASCARADO (aba Criptografia),
// o mesmo que o gateway recebeu na cobrança. É o arquivo para mandar ao
// gateway (comprovação de envio, por exemplo): com o nome real, a lista não
// bate com as transações dele. Produto sem máscara sai com o nome real, como
// na cobrança.
//
// A loja vem da SESSÃO, nunca da URL. Com o storeId no parâmetro, trocar um
// caractere no endereço baixaria a lista de clientes de outra loja.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teto de linhas: protege memória e tempo de resposta da função. */
const LIMITE = 20000;

const STATUS_VALIDOS = new Set(["PENDING", "PAID", "SHIPPED", "CANCELLED"]);

const STATUS_PT: Record<string, string> = {
  PENDING: "Pendente",
  PAID: "Pago",
  SHIPPED: "Enviado",
  CANCELLED: "Cancelado",
};
const METODO_PT: Record<string, string> = { PIX: "Pix", CREDIT_CARD: "Cartão", BOLETO: "Boleto" };

type Endereco = {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
};

function lerEndereco(bruto: string | null): Endereco {
  if (!bruto) return {};
  try {
    const a = JSON.parse(bruto);
    return a && typeof a === "object" ? a : {};
  } catch {
    return {};
  }
}

/**
 * Telefone só com dígitos. É o formato que as ferramentas de disparo e o
 * próprio WhatsApp aceitam colado, e evita que o Excel trate "+55..." como
 * número e engula o sinal.
 */
const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

export async function GET(req: Request) {
  try {
    const { store } = await requireStore();
    const url = new URL(req.url);

    const status = url.searchParams.get("status") ?? "";
    const email = (url.searchParams.get("email") ?? "").trim().slice(0, 120);
    const cripto = url.searchParams.get("cripto") === "1";

    // Mesmo filtro da tela (src/app/painel/vendas/page.tsx), inclusive sem as
    // tentativas de cartão empilhadas — a coluna "Tentativas" diz quantas foram.
    const conds = ["o.storeId = ?", "o.cardHiddenBy IS NULL"];
    const params: unknown[] = [store.id];
    if (STATUS_VALIDOS.has(status)) {
      conds.push("o.status = ?");
      params.push(status);
    }
    if (email) {
      conds.push("COALESCE(u.email, o.customerEmail) LIKE ? ESCAPE '!'");
      params.push(`%${email.replace(/[!%_]/g, (c) => `!${c}`)}%`);
    }

    const pedidos = await query<{
      id: string;
      status: string;
      paymentMethod: string | null;
      paymentGateway: string | null;
      providerTxnId: string | null;
      totalCents: number;
      shippingCents: number | null;
      discountCents: number | null;
      nome: string | null;
      email: string | null;
      telefone: string | null;
      documento: string | null;
      customerAddress: string | null;
      trackingCode: string | null;
      createdAt: Date;
      paidAt: Date | null;
      itens: string | null;
      cardBrand: string | null;
      cardLast4: string | null;
      cardAttempts: number | null;
    }>(
      `SELECT o.id, o.status, o.paymentMethod, o.paymentGateway, o.providerTxnId,
              o.cardBrand, o.cardLast4, o.cardAttempts,
              o.totalCents, o.shippingCents, o.discountCents,
              COALESCE(u.name, o.customerName) AS nome,
              COALESCE(u.email, o.customerEmail) AS email,
              COALESCE(o.customerPhone, u.phone) AS telefone,
              o.customerDocument AS documento,
              o.customerAddress, o.trackingCode, o.createdAt, o.paidAt,
              (SELECT GROUP_CONCAT(CONCAT(oi.quantity, 'x ', ${cripto ? "COALESCE(NULLIF(TRIM(p.maskedName), ''), p.name)" : "p.name"}) SEPARATOR ' | ')
                 FROM order_items oi JOIN products p ON p.id = oi.productId
                WHERE oi.orderId = o.id) AS itens
         FROM orders o LEFT JOIN users u ON u.id = o.userId
        WHERE ${conds.join(" AND ")}
        ORDER BY o.createdAt DESC
        LIMIT ${LIMITE}`,
      params,
    );

    const cabecalho = [
      "Pedido",
      "Data",
      "Pago em",
      "Status",
      "Pagamento",
      "Cliente",
      "E-mail",
      "Telefone",
      "CPF",
      "CEP",
      "Endereço",
      "Número",
      "Complemento",
      "Bairro",
      "Cidade",
      "UF",
      "Produtos",
      "Frete",
      "Desconto",
      "Total",
      "Código de rastreio",
      "Gateway",
      "ID da transação",
      "Cartão",
      "Tentativas",
    ];

    const linhas = pedidos.map((p) => {
      const e = lerEndereco(p.customerAddress);
      return [
        p.id,
        dataHoraBr(p.createdAt),
        dataHoraBr(p.paidAt),
        STATUS_PT[p.status] ?? p.status,
        METODO_PT[p.paymentMethod ?? ""] ?? p.paymentMethod ?? "",
        p.nome,
        p.email,
        soDigitos(p.telefone),
        p.documento,
        e.cep,
        e.street,
        e.number,
        e.complement,
        e.neighborhood,
        e.city,
        e.uf,
        p.itens,
        dinheiro(p.shippingCents),
        dinheiro(p.discountCents),
        dinheiro(p.totalCents),
        p.trackingCode,
        p.paymentGateway,
        p.providerTxnId,
        // Só o final mascarado — nunca o número inteiro (não é gravado).
        p.cardLast4 ? `${p.cardBrand ?? "Cartão"} final ${p.cardLast4}` : "",
        Number(p.cardAttempts ?? 1),
      ];
    });

    // Nome do arquivo diz o que tem dentro: vendas-pagas-2026-09-29.csv
    // e não "export.csv", que vira "export (3).csv" na pasta de downloads.
    const recorte = STATUS_VALIDOS.has(status) ? `-${(STATUS_PT[status] ?? status).toLowerCase()}s` : "";
    const dia = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    return respostaCsv(montarCsv(cabecalho, linhas), `vendas${recorte}${cripto ? "-criptografado" : ""}-${dia}.csv`);
  } catch (err) {
    return handleError(err);
  }
}
