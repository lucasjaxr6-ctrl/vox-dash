import { query } from "@/lib/db";
import { json } from "@/lib/http";
import { atualizarLote } from "@/lib/track17";

// GET/POST /api/cron/rastreio
//
// Atualiza o rastreio em SEGUNDO PLANO. Antes, uma remessa só era consultada
// quando alguém abria a página — e se a primeira visita caísse antes de a
// transportadora informar (caso real: 4 segundos antes), o código ficava
// "aguardando postagem" até a próxima visita. Das 706 remessas, 657 nunca
// tinham sido consultadas.
//
// O webhook do 17TRACK continua sendo o caminho rápido; isto é a rede de
// segurança — mesma lógica da caixa de e-mail do admin: webhook é
// otimização, a consulta periódica é garantia.
//
// Só consulta o que JÁ está registrado (`registrado = 1`). Consultar é grátis,
// registrar custa cota — ver atualizarLote().
//
// Protegido por CRON_SECRET, como os outros crons.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Teto por rodada. 400 códigos = 10 lotes de 40, uns 5 segundos de API. O que
 * não couber entra na próxima: a ordem é "mais tempo sem consulta primeiro".
 */
const POR_RODADA = 400;

/** Não reconsulta o que foi atualizado há pouco (por visita ou pelo webhook). */
const INTERVALO_MIN = 25;

/**
 * Remessa com mais de 90 dias sem entrega é caso encerrado na prática
 * (extraviada ou devolvida). Continuar consultando só gasta chamada.
 */
const IDADE_MAX_DIAS = 90;

async function handle(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") || "";
    const qs = new URL(req.url).searchParams.get("secret") || "";
    if (auth !== `Bearer ${secret}` && qs !== secret) return json({ error: "unauthorized" }, 401);
  }

  const alvos = await query<{ trackingCode: string }>(
    `SELECT trackingCode FROM tracking_shipments
      WHERE registrado = 1
        AND (estagio IS NULL OR estagio <> 'entregue')
        AND createdAt >= NOW(3) - INTERVAL ${IDADE_MAX_DIAS} DAY
        AND (syncedAt IS NULL OR syncedAt < NOW(3) - INTERVAL ${INTERVALO_MIN} MINUTE)
      ORDER BY syncedAt IS NOT NULL, syncedAt ASC
      LIMIT ${POR_RODADA}`,
  );

  if (!alvos.length) return json({ ok: true, consultados: 0 });

  const r = await atualizarLote(alvos.map((a) => a.trackingCode));
  console.log(
    `[cron rastreio] ${r.consultados} consultado(s), ${r.comDados} com dados, ${r.eventosNovos} evento(s) novo(s)` +
      (r.erro ? ` | erro: ${r.erro}` : ""),
  );
  return json({ ok: !r.erro, ...r });
}

export const GET = handle;
export const POST = handle;
