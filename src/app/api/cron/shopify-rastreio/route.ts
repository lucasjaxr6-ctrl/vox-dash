import { json } from "@/lib/http";
import { sincronizarRastreiosDaShopify } from "@/lib/rastreio-shopify";

// GET/POST /api/cron/shopify-rastreio
//
// Rede de segurança do rastreio lançado na Shopify: o webhook orders/updated é
// o caminho rápido, mas entrega perdida, assinatura removida pela Shopify ou
// falha no meio do caminho deixavam o pedido sem código para sempre — foi o
// caso da Elvora Decor (21/10/2026). Aqui perguntamos à Shopify, em lote, pelos
// pedidos pagos dos últimos 45 dias que ainda estão sem rastreio, e aplicamos
// os que já têm código lá. Ver lib/rastreio-shopify.ts.
//
// Protegido por CRON_SECRET, como os outros crons.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const qs = new URL(req.url).searchParams.get("secret") || "";
    if (auth !== `Bearer ${secret}` && qs !== secret) return json({ error: "unauthorized" }, 401);
  }

  const r = await sincronizarRastreiosDaShopify();
  if (r.aplicados || r.erros.length) {
    console.log(
      `[cron shopify-rastreio] ${r.lojas} loja(s), ${r.consultados} pedido(s) consultado(s), ` +
        `${r.aplicados} rastreio(s) aplicado(s), ${r.avisados} e-mail(s)` +
        (r.erros.length ? ` | erros: ${r.erros.slice(0, 5).join("; ")}` : ""),
    );
  }
  return json({ ok: r.erros.length === 0, ...r });
}

export const GET = handle;
export const POST = handle;
