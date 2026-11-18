import { NextRequest } from "next/server";
import { json, handleError } from "@/lib/http";

// Busca de endereço por CEP via ViaCEP. É um proxy server-side: o navegador
// chama apenas o mesmo domínio (/api/cep/...), então o CSP continua com
// connect-src 'self'. Apenas leitura, sem dados sensíveis.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cep: string }> },
) {
  try {
    const { cep } = await params;
    const digits = (cep || "").replace(/\D/g, "");
    if (digits.length !== 8) return json({ error: "CEP inválido" }, 400);

    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: "application/json" },
      cache: "force-cache", // CEP muda muito raramente
    });
    if (!res.ok) return json({ error: "Falha ao consultar CEP" }, 502);

    const data = await res.json();
    if (data?.erro) return json({ error: "CEP não encontrado" }, 404);

    return json({
      cep: data.cep ?? "",
      street: data.logradouro ?? "",
      neighborhood: data.bairro ?? "",
      city: data.localidade ?? "",
      state: data.uf ?? "",
    });
  } catch (e) {
    return handleError(e);
  }
}
