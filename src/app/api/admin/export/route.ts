import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { json, handleError } from "@/lib/http";
import { parseRange, taxaDeAprovacao, SEM_RECUSA_REPETIDA, type Range } from "@/lib/admin";
import { montarCsv, dinheiro } from "@/lib/csv";

// GET /api/admin/export?type=transacoes|lojas|clientes&range=today|7|30|all
// Exportação CSV da PLATAFORMA (todas as lojas). Só ADMIN.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIMIT = 20000; // teto de linhas: protege memória e tempo de resposta

// O CSV sai de lib/csv.ts, o mesmo do export do lojista. A versão que morava
// aqui escapava aspas mas não neutralizava FÓRMULA: um cliente com o nome
// `=HYPERLINK(...)` virava link clicável na planilha do admin.
const toCsv = montarCsv;
const money = dinheiro;

function dateFrag(col: string, range: Range): string {
  switch (range) {
    case "today":
      return ` AND DATE(CONVERT_TZ(${col},'+00:00','-03:00')) = DATE(CONVERT_TZ(NOW(),'+00:00','-03:00'))`;
    case "7":
      return ` AND ${col} >= NOW() - INTERVAL 7 DAY`;
    case "30":
      return ` AND ${col} >= NOW() - INTERVAL 30 DAY`;
    default:
      return "";
  }
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "transacoes";
    const range = parseRange(url.searchParams.get("range") || undefined);

    let headers: string[] = [];
    let rows: unknown[][] = [];

    if (type === "transacoes") {
      const d = dateFrag("o.createdAt", range);
      const r = await query<any>(
        `SELECT o.id, s.name AS loja, o.status, o.paymentMethod, o.paymentGateway,
                o.totalCents, o.shippingCents, o.discountCents,
                o.customerName, o.customerEmail, o.customerPhone, o.customerDocument,
                o.providerTxnId, o.createdAt, o.paidAt
         FROM orders o LEFT JOIN stores s ON s.id = o.storeId
         WHERE 1=1${d} ORDER BY o.createdAt DESC LIMIT ${LIMIT}`,
      );
      headers = ["Pedido", "Loja", "Status", "Metodo", "Gateway", "Total", "Frete", "Desconto", "Cliente", "Email", "Telefone", "Documento", "Transacao", "Criado em", "Pago em"];
      rows = r.map((x) => [
        x.id, x.loja, x.status, x.paymentMethod, x.paymentGateway,
        money(x.totalCents), money(x.shippingCents), money(x.discountCents),
        x.customerName, x.customerEmail, x.customerPhone, x.customerDocument,
        x.providerTxnId, x.createdAt, x.paidAt,
      ]);
    } else if (type === "lojas") {
      const d = dateFrag("o.createdAt", range);
      const r = await query<any>(
        `SELECT s.id, s.name, s.suspended, u.email AS dono, ss.customDomain, ss.shopifyStoreDomain,
                COALESCE(SUM(CASE WHEN o.status IN ('PAID','SHIPPED') THEN o.totalCents END),0) AS gmv,
                COALESCE(SUM(o.status IN ('PAID','SHIPPED')),0) AS aprovadas,
                COALESCE(SUM(o.status = 'CANCELLED'),0) AS recusadas,
                COALESCE(SUM(o.status = 'PENDING'),0) AS pendentes,
                COALESCE(SUM(o.status = 'PENDING' AND o.paymentMethod = 'PIX'),0) AS pixNaoPagos
         FROM stores s
         LEFT JOIN users u ON u.id = s.ownerUserId
         LEFT JOIN store_settings ss ON ss.storeId = s.id
         LEFT JOIN orders o ON o.storeId = s.id AND o.${SEM_RECUSA_REPETIDA}${d ? ` AND 1=1${d}` : ""}
         GROUP BY s.id, s.name, s.suspended, u.email, ss.customDomain, ss.shopifyStoreDomain
         ORDER BY gmv DESC LIMIT ${LIMIT}`,
      );
      headers = ["Loja", "Dono", "Dominio", "Shopify", "Receita", "Aprovadas", "Recusadas", "Pendentes", "Aprovacao %", "Situacao"];
      rows = r.map((x) => {
        // Mesma conta do painel (taxaDeAprovacao): Pix não pago conta contra,
        // recusa repetida do mesmo cartão não conta.
        const ap = taxaDeAprovacao(Number(x.aprovadas), Number(x.recusadas), Number(x.pixNaoPagos));
        return [
          x.name, x.dono, x.customDomain, x.shopifyStoreDomain,
          money(x.gmv), x.aprovadas, x.recusadas, x.pendentes,
          ap === null ? "" : ap.toFixed(1).replace(".", ","),
          Number(x.suspended) ? "Suspensa" : "Ativa",
        ];
      });
    } else if (type === "clientes") {
      const d = dateFrag("createdAt", range);
      const r = await query<any>(
        `SELECT customerEmail AS email, MAX(customerName) AS nome, MAX(customerPhone) AS telefone,
                MAX(customerDocument) AS documento, COUNT(*) AS pedidos,
                COALESCE(SUM(status IN ('PAID','SHIPPED')),0) AS pagos,
                COALESCE(SUM(CASE WHEN status IN ('PAID','SHIPPED') THEN totalCents END),0) AS gasto,
                COUNT(DISTINCT storeId) AS lojas,
                MIN(createdAt) AS primeira, MAX(createdAt) AS ultima
         FROM orders
         WHERE customerEmail IS NOT NULL AND customerEmail <> ''${d}
         GROUP BY customerEmail ORDER BY gasto DESC LIMIT ${LIMIT}`,
      );
      headers = ["Email", "Nome", "Telefone", "Documento", "Pedidos", "Pagos", "Gasto", "Lojas", "Primeira compra", "Ultima compra"];
      rows = r.map((x) => [x.email, x.nome, x.telefone, x.documento, x.pedidos, x.pagos, money(x.gasto), x.lojas, x.primeira, x.ultima]);
    } else {
      return json({ error: "Tipo de relatório inválido." }, 400);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${type}-${range}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
