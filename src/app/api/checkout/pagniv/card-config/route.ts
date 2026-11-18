import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { json } from "@/lib/http";
import { resolveStoreByHost } from "@/lib/stores";
import { getPagnivCardConfig } from "@/lib/pagniv";

// GET /api/checkout/pagniv/card-config
//
// Devolve ao checkout a chave PÚBLICA e a URL de tokenização da PagNiv. A doc
// deles manda ler esses dois da API em vez de fixá-los no código, mas a consulta
// exige a chave SECRETA — que não pode ir para o navegador. Esta rota é essa
// ponte: lê com o segredo no servidor e repassa só o que é público.
//
// A loja vem do Host (mesmo caminho do checkout), não de parâmetro: senão
// qualquer um poderia pedir a configuração de outra loja.
export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const store = await resolveStoreByHost(h.get("host"));
  if (!store) return json({ error: "loja não encontrada" }, 404);

  const cfg = await getPagnivCardConfig(store.id);
  if (!cfg) return json({ error: "indisponível" }, 503);

  // Cache curto e PRIVADO: é configuração de uma loja, não pode ser guardada por
  // CDN e servida para o domínio de outra.
  return NextResponse.json(cfg, { status: 200, headers: { "Cache-Control": "private, max-age=300" } });
}
