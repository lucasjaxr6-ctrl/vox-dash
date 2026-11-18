import { requireAdmin } from "@/lib/auth";
import { execute, query } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { json, handleError } from "@/lib/http";
import { getTrack17Token } from "@/lib/track17";

// GET/PUT /api/admin/platform/track17
//
// Token da API do 17TRACK, UM para toda a plataforma (uma conta atende todas as
// lojas). É ele que alimenta a página de rastreio no domínio de cada loja.
//
// O GET NUNCA devolve o token — só se está configurado. Um segredo que volta
// numa resposta acaba em log de navegador, extensão e print de tela.

export async function GET() {
  try {
    await requireAdmin();
    const token = await getTrack17Token();
    return json({ configurado: Boolean(token) });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json();
    const bruto = typeof body?.token === "string" ? body.token.trim() : "";

    // String vazia = remover. É o único jeito de desfazer um token colado errado.
    if (!bruto) {
      await execute(
        `INSERT INTO platform_settings (id, track17TokenEnc) VALUES (1, NULL)
         ON DUPLICATE KEY UPDATE track17TokenEnc = NULL`,
      );
      return json({ ok: true, configurado: false });
    }
    if (bruto.length > 200) return json({ error: "Token muito longo." }, 400);

    await execute(
      `INSERT INTO platform_settings (id, track17TokenEnc) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE track17TokenEnc = VALUES(track17TokenEnc)`,
      [encryptSecret(bruto)],
    );

    // Confere contra a API deles antes de dizer que está pronto: token colado
    // errado só apareceria depois, como página de rastreio vazia para o cliente.
    let valido: boolean | null = null;
    try {
      const res = await fetch("https://api.17track.net/track/v2.4/getquota", {
        method: "POST",
        headers: { "17token": bruto, "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      valido = res.ok && data?.code === 0;
    } catch {
      valido = null; // rede falhou: não dá para afirmar nada
    }
    return json({ ok: true, configurado: true, valido });
  } catch (err) {
    return handleError(err);
  }
}
