import { query } from "@/lib/db";
import { requireStore } from "@/lib/stores";
import { json, handleError } from "@/lib/http";
import { listAppmaxProducts, skuFromName, skuFromProductId } from "@/lib/appmax";

export const dynamic = "force-dynamic";

// GET /api/painel/appmax/catalogo
//
// Diagnóstico da aba Criptografia. O painel da Appmax não mostra o SKU e o
// GET do pedido não devolve os itens, então a única forma de saber que nome ela
// guardou é olhar o catálogo dela (GET /v1/products).
//
// O truque: o nosso `sku` é o hash do nome que ENVIAMOS. Então, para cada
// produto do catálogo deles, o par (sku, name) denuncia a origem:
//
//   sku = hash(máscara) e name = máscara  -> veio de nós, mascarado (esperado)
//   sku = hash(máscara) e name != máscara -> veio de nós e foi RENOMEADO depois
//   sku = hash(nome real)                 -> veio de nós antes de existir máscara
//   sku fora do nosso formato             -> entrou por OUTRA porta (ex.: Shopify)
export async function GET() {
  try {
    const { store } = await requireStore();

    const nossos = await query<{ id: string; name: string; maskedName: string | null }>(
      `SELECT id, name, maskedName FROM products WHERE storeId = ?`,
      [store.id],
    );

    // Índice: sku esperado -> o que aquele sku significa do nosso lado.
    type Esperado = { produtoId: string; nomeReal: string; enviado: string; tipo: "mascara" | "nome-real" };
    const porSku = new Map<string, Esperado>();
    for (const p of nossos) {
      const mascara = p.maskedName?.trim();
      const enviado = mascara && mascara !== p.name ? mascara : p.name;
      const tipo = mascara && mascara !== p.name ? ("mascara" as const) : ("nome-real" as const);
      // SKU atual: derivado do id do produto.
      porSku.set(skuFromProductId(p.id), { produtoId: p.id, nomeReal: p.name, enviado, tipo });
      // SKUs LEGADOS (derivados do nome). Ficaram no catálogo da Appmax dos
      // pedidos antigos; sem eles o diagnóstico marcaria tudo como "de fora".
      if (!porSku.has(skuFromName(p.name))) {
        porSku.set(skuFromName(p.name), { produtoId: p.id, nomeReal: p.name, enviado: p.name, tipo: "nome-real" });
      }
      if (mascara && mascara !== p.name && !porSku.has(skuFromName(mascara))) {
        porSku.set(skuFromName(mascara), { produtoId: p.id, nomeReal: p.name, enviado: mascara, tipo: "mascara" });
      }
    }

    // Máscaras repetidas: no SKU antigo elas colapsavam produtos diferentes numa
    // só entrada do catálogo da Appmax. O SKU novo resolve dali para frente, mas
    // o lojista precisa saber que a máscara não é exclusiva daquele produto.
    const porNomeEnviado = new Map<string, string[]>();
    for (const p of nossos) {
      const enviado = (p.maskedName?.trim() || p.name).toLowerCase();
      porNomeEnviado.set(enviado, [...(porNomeEnviado.get(enviado) ?? []), p.name]);
    }
    const mascarasRepetidas = [...porNomeEnviado.entries()]
      .filter(([, reais]) => reais.length > 1)
      .map(([enviado, reais]) => ({ enviado, produtos: reais }));

    const { items, truncado } = await listAppmaxProducts(store.id);

    const classificados = items.map((it) => {
      const esperado = porSku.get(it.sku);
      if (!esperado) {
        return {
          sku: it.sku,
          nomeNaAppmax: it.name,
          origem: "fora-do-nosso-checkout" as const,
          nossoFormatoDeSku: /^P[0-9a-f]{20}$/.test(it.sku),
        };
      }
      const bate = it.name.trim() === esperado.enviado.trim();
      return {
        sku: it.sku,
        nomeNaAppmax: it.name,
        origem: bate
          ? (esperado.tipo === "mascara" ? ("nosso-mascarado" as const) : ("nosso-sem-mascara" as const))
          : ("nosso-mas-renomeado" as const),
        enviamos: esperado.enviado,
        nomeReal: esperado.nomeReal,
      };
    });

    const contar = (o: string) => classificados.filter((c) => c.origem === o).length;

    return json({
      loja: store.name,
      totalNoCatalogoAppmax: items.length,
      truncado,
      resumo: {
        nossoMascarado: contar("nosso-mascarado"),
        nossoSemMascara: contar("nosso-sem-mascara"),
        nossoMasRenomeado: contar("nosso-mas-renomeado"),
        foraDoNossoCheckout: contar("fora-do-nosso-checkout"),
      },
      semMascara: nossos.filter((p) => !(p.maskedName?.trim() && p.maskedName.trim() !== p.name)).map((p) => p.name),
      mascarasRepetidas,
      itens: classificados,
    });
  } catch (err) {
    return handleError(err);
  }
}
