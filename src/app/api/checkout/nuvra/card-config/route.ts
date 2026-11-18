import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { json } from "@/lib/http";
import { resolveStoreByHost } from "@/lib/stores";
import { getNuvraCardConfig } from "@/lib/nuvra";

// GET /api/checkout/nuvra/card-config
//
// Entrega ao checkout o que o NAVEGADOR precisa para tokenizar o cartão na
// Nuvra: o esquema (s1/s2/sandbox), a chave publicável e a URL de
// tokenização. A consulta (GET /card-tokenization) exige a chave SECRETA, que
// não pode ir para o navegador: esta rota lê no servidor e repassa só o público.
// O `processor` não sai daqui: o servidor o põe na cobrança sozinho.
//
// A loja vem do Host (mesmo caminho do checkout), não de parâmetro: senão
// qualquer um poderia pedir a configuração de outra loja.
export const dynamic = "force-dynamic";

export async function GET() {
  const h = await headers();
  const store = await resolveStoreByHost(h.get("host"));
  if (!store) return json({ error: "loja não encontrada" }, 404);

  const cfg = await getNuvraCardConfig(store.id);
  if (!cfg || !cfg.available) return json({ error: "indisponível" }, 503);

  // Cache curto e PRIVADO: é configuração de uma loja, não pode ser guardada por
  // CDN e servida para o domínio de outra.
  return NextResponse.json(
    { scheme: cfg.scheme, publicKey: cfg.publicKey, tokenizeUrl: cfg.tokenizeUrl, maxInstallments: cfg.maxInstallments },
    { status: 200, headers: { "Cache-Control": "private, max-age=300" } },
  );
}
