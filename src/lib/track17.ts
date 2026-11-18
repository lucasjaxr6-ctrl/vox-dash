import "server-only";
import { query, execute, newId } from "./db";
import { decryptSecret } from "./crypto";
import { traduzirEvento, traduzirLocais, temCJK } from "./track17-traducao";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Rastreio de encomendas via 17TRACK (api.17track.net/track/v2.4).
//
// Por que um provedor e não os Correios: os códigos vêm da China (ex.:
// ZA07348105601) e trocam de transportadora no caminho. O 17TRACK detecta a
// transportadora sozinho entre milhares e devolve os eventos JÁ TRADUZIDOS
// quando registramos com `lang: "pt"` — é isso que permite a página ficar em
// português no domínio da loja, em vez de jogar o cliente para fora.
//
// O token é UM por plataforma (uma conta serve todas as lojas), guardado
// criptografado em platform_settings.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = "https://api.17track.net/track/v2.4";

/** Quanto tempo o resultado vale antes de consultarmos de novo. */
export const CACHE_MINUTOS = 30;

export type Estagio =
  | "aguardando"
  | "postado"
  | "transito"
  | "alfandega"
  | "saiu_entrega"
  | "entregue"
  | "excecao";

export type EventoRastreio = {
  ocorridoEm: Date;
  descricao: string;
  localizacao: string | null;
  estagio: Estagio | null;
};

export type Remessa = {
  trackingCode: string;
  carrier: string | null;
  estagio: Estagio | null;
  ultimoTexto: string | null;
  ultimoEm: Date | null;
  entregueEm: Date | null;
  /** Previsão do provedor; nula quando a transportadora não informa. */
  previsaoEm: Date | null;
  syncedAt: Date | null;
  erro: string | null;
};

/**
 * Estágios do 17TRACK -> o nosso vocabulário.
 *
 * A tela NUNCA lê o texto do provedor para decidir cor ou ícone: um texto novo
 * do lado deles não pode quebrar o desenho da linha do tempo.
 */
const ESTAGIOS: Record<string, Estagio> = {
  notfound: "aguardando",
  inforeceived: "postado",
  intransit: "transito",
  customshold: "alfandega",
  availableforpickup: "saiu_entrega",
  outfordelivery: "saiu_entrega",
  delivered: "entregue",
  deliveryfailure: "excecao",
  exception: "excecao",
  expired: "excecao",
  undelivered: "excecao",
  alert: "excecao",
};

export function normalizarEstagio(v: unknown): Estagio | null {
  const k = String(v ?? "").toLowerCase().replace(/[\s_-]/g, "");
  if (!k) return null;
  if (ESTAGIOS[k]) return ESTAGIOS[k];
  // Subestados vêm com sufixo ("InTransit_PickedUp"); o prefixo já decide.
  for (const [chave, valor] of Object.entries(ESTAGIOS)) {
    if (k.startsWith(chave)) return valor;
  }
  return null;
}

/** Rótulo em português de cada estágio — usado na página e no painel. */
export const ROTULO_ESTAGIO: Record<Estagio, string> = {
  aguardando: "Aguardando postagem",
  postado: "Pedido postado",
  transito: "Em trânsito",
  alfandega: "Na alfândega",
  saiu_entrega: "Saiu para entrega",
  entregue: "Entregue",
  excecao: "Atenção necessária",
};

/** Token da plataforma, ou null se ninguém configurou. */
export async function getTrack17Token(): Promise<string | null> {
  const rows = await query<{ track17TokenEnc: string | null }>(
    `SELECT track17TokenEnc FROM platform_settings WHERE id = 1 LIMIT 1`,
  );
  const enc = rows[0]?.track17TokenEnc;
  if (!enc) return null;
  try {
    return decryptSecret(enc);
  } catch {
    return null;
  }
}

async function api(token: string, caminho: string, corpo: unknown): Promise<any> {
  const res = await fetch(`${BASE}${caminho}`, {
    method: "POST",
    headers: { "17token": token, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`17track ${caminho}: HTTP ${res.status}`);
  // `code` 0 = ok. Qualquer outro traz a razão em `data.errors`.
  if (data?.code !== 0 && data?.code !== undefined && data?.code !== null) {
    const motivo = data?.data?.errors?.[0]?.message ?? data?.msg ?? `code ${data.code}`;
    throw new Error(`17track ${caminho}: ${motivo}`);
  }
  return data;
}

/**
 * Registra o código no 17TRACK para ele começar a acompanhar.
 *
 * `lang: "pt"` é o ponto todo: sem isso os eventos voltam em inglês ou chinês.
 * Best-effort — registrar de novo um código já conhecido não é erro, e uma
 * falha aqui não pode impedir o lojista de despachar o pedido.
 */
/** O 17TRACK responde isto quando o número já estava registrado. Não é falha. */
const JA_REGISTRADO = -18019901;

export async function registrarCodigo(trackingCode: string): Promise<{ ok: boolean; erro?: string }> {
  const token = await getTrack17Token();
  if (!token) return { ok: false, erro: "17TRACK sem token configurado." };
  try {
    const data = await api(token, "/register", [{ number: trackingCode, lang: "pt" }]);

    // ⚠️ `code: 0` NÃO quer dizer que registrou. O resultado de cada número
    // vem em `accepted` ou `rejected` — e cota esgotada chega como rejeição
    // dentro de uma resposta "ok". Sem olhar isto, o dia em que a cota acabar
    // todo registro falharia em silêncio e o cliente veria "aguardando
    // postagem" para sempre.
    const aceito = (data?.data?.accepted ?? []).some((a: any) => a?.number === trackingCode);
    const rejeicao = (data?.data?.rejected ?? []).find((r: any) => r?.number === trackingCode);
    const jaTinha = rejeicao?.error?.code === JA_REGISTRADO;

    if (aceito || jaTinha) {
      await execute(`UPDATE tracking_shipments SET registrado = 1 WHERE trackingCode = ?`, [trackingCode]);
      return { ok: true };
    }
    const erro = String(rejeicao?.error?.message ?? "registro recusado pelo 17TRACK").slice(0, 200);
    console.error("[17track registrar] RECUSADO", trackingCode, rejeicao?.error?.code, erro);
    return { ok: false, erro };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("[17track registrar]", trackingCode, erro);
    return { ok: false, erro };
  }
}

/** Quantos números o 17TRACK aceita por consulta. */
const LOTE_17TRACK = 40;

/**
 * Atualiza vários códigos de uma vez, SEM registrar nenhum.
 *
 * É o que o cron usa. Consultar é grátis; registrar custa cota. Se esta função
 * registrasse o que não encontra, uma rodada sobre as remessas antigas
 * (despachadas antes do token existir) consumiria a cota inteira.
 *
 * Código que volta sem dados só tem o `syncedAt` renovado — na próxima rodada
 * ele entra de novo, e quando a transportadora informar, os eventos aparecem.
 */
export async function atualizarLote(
  codigos: string[],
): Promise<{ consultados: number; comDados: number; eventosNovos: number; erro?: string }> {
  const token = await getTrack17Token();
  if (!token) return { consultados: 0, comDados: 0, eventosNovos: 0, erro: "sem token" };

  let comDados = 0;
  let eventosNovos = 0;
  for (let i = 0; i < codigos.length; i += LOTE_17TRACK) {
    const lote = codigos.slice(i, i + LOTE_17TRACK);
    try {
      const data = await api(token, "/gettrackinfo", lote.map((number) => ({ number })));
      for (const aceito of data?.data?.accepted ?? []) {
        const numero = String(aceito?.number ?? "").toUpperCase();
        if (!numero) continue;
        eventosNovos += await aplicarTrackInfo(numero, aceito);
        comDados++;
      }
      // Os que vieram sem dados também contam como consultados agora: sem
      // isto, a ordem "mais antigo primeiro" do cron os escolheria de novo
      // em toda rodada e os outros nunca chegariam a vez.
      const m = lote.map(() => "?").join(",");
      await execute(`UPDATE tracking_shipments SET syncedAt = NOW(3) WHERE trackingCode IN (${m})`, lote);
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      console.error("[17track lote]", erro);
      return { consultados: i, comDados, eventosNovos, erro };
    }
    // O 17TRACK limita chamadas por segundo; uma folga entre lotes evita 429.
    if (i + LOTE_17TRACK < codigos.length) await new Promise((r) => setTimeout(r, 400));
  }
  return { consultados: codigos.length, comDados, eventosNovos };
}

/** Extrai os eventos da resposta, tolerando variações de formato. */
function lerEventos(aceito: any): EventoRastreio[] {
  const provedores = aceito?.track_info?.tracking?.providers ?? [];
  const brutos: any[] = [];
  for (const p of provedores) {
    if (Array.isArray(p?.events)) brutos.push(...p.events);
  }
  const eventos: EventoRastreio[] = [];
  for (const e of brutos) {
    const quando = new Date(e?.time_iso ?? e?.time_utc ?? e?.time_raw?.date ?? "");
    if (!Number.isFinite(quando.getTime())) continue;
    // A tradução DELES só vale quando de fato traduziu: quando o provedor
    // chinês não tem versão traduzida, o 17TRACK devolve o mesmo texto em
    // chinês dentro de `description_translation` (medido em evento real).
    const deles = String(e?.description_translation?.description ?? "").trim();
    const original = String(e?.description ?? "").trim();
    const descricao = deles && !temCJK(deles) ? deles : original;
    if (!descricao) continue;
    // `location` às vezes vem string, às vezes objeto com a cidade.
    const loc = e?.location;
    const localizacao =
      typeof loc === "string" ? loc.trim() : [loc?.city, loc?.state, loc?.country].filter(Boolean).join(", ");
    eventos.push({
      ocorridoEm: quando,
      descricao: descricao.slice(0, 500),
      localizacao: localizacao ? localizacao.slice(0, 200) : null,
      estagio: normalizarEstagio(e?.stage),
    });
  }
  // Mais novo primeiro — é a ordem em que a página mostra.
  return eventos.sort((a, b) => b.ocorridoEm.getTime() - a.ocorridoEm.getTime());
}

const assinar = (codigo: string, e: EventoRastreio) =>
  crypto.createHash("sha1").update(`${codigo}|${e.ocorridoEm.toISOString()}|${e.descricao}`).digest("hex");

/**
 * Grava um `accepted` do 17TRACK (eventos + estado da remessa).
 *
 * Fica separado porque a MESMA carga chega por dois caminhos: a consulta que
 * fazemos e o push do webhook deles. Duas cópias desta lógica sairiam do lugar
 * com o tempo e uma delas passaria a mostrar coisa diferente da outra.
 */
export async function aplicarTrackInfo(trackingCode: string, aceito: any): Promise<number> {
  const eventos = lerEventos(aceito);
  let novos = 0;
  for (const ev of eventos) {
    const r = await execute(
      `INSERT IGNORE INTO tracking_events
         (id, trackingCode, ocorridoEm, descricao, localizacao, estagio, assinatura)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), trackingCode, ev.ocorridoEm, ev.descricao, ev.localizacao, ev.estagio, assinar(trackingCode, ev)],
    );
    if (r.affectedRows > 0) novos++;
  }

  const ultimo = eventos[0] ?? null;
  const estagio = normalizarEstagio(aceito?.track_info?.latest_status?.status) ?? ultimo?.estagio ?? "aguardando";
  const entregue = estagio === "entregue" ? (ultimo?.ocorridoEm ?? new Date()) : null;
  const carrier = aceito?.track_info?.tracking?.providers?.[0]?.provider?.name ?? null;

  // Previsão de entrega: nem toda transportadora devolve, e o campo muda de
  // nome conforme a fonte. Data ilegível vira null — a tela prefere omitir a
  // previsão a mostrar uma data errada, que geraria reclamação.
  const brutoPrev =
    aceito?.track_info?.time_metrics?.estimated_delivery_date?.to ??
    aceito?.track_info?.time_metrics?.estimated_delivery_date?.from ??
    null;
  const prev = brutoPrev ? new Date(brutoPrev) : null;
  const previsao = prev && Number.isFinite(prev.getTime()) ? prev : null;

  await execute(
    `UPDATE tracking_shipments
        SET carrier = ?, estagio = ?, ultimoTexto = ?, ultimoEm = ?, entregueEm = ?,
            previsaoEm = ?, syncedAt = NOW(3), erro = NULL
      WHERE trackingCode = ?`,
    [
      carrier ? String(carrier).slice(0, 120) : null,
      estagio,
      ultimo?.descricao ?? null,
      ultimo?.ocorridoEm ?? null,
      entregue,
      previsao,
      trackingCode,
    ],
  );
  return novos;
}

/**
 * Garante a linha da remessa quando o código chega pelo webhook — lá não vem
 * loja, só o número. Devolve false se o código não é de nenhum pedido nosso.
 */
export async function garantirRemessa(trackingCode: string): Promise<boolean> {
  const [dono] = await query<{ storeId: string }>(
    `SELECT storeId FROM orders WHERE UPPER(TRIM(trackingCode)) = ? LIMIT 1`,
    [trackingCode],
  );
  if (!dono?.storeId) return false;
  // `registrado = 1` já na criação: o 17TRACK só manda push de número que está
  // registrado na nossa conta, então quem chega por aqui é registrado por
  // definição — e precisa entrar no cron de atualização.
  await execute(
    `INSERT INTO tracking_shipments (trackingCode, storeId, registrado) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE registrado = 1`,
    [trackingCode, dono.storeId],
  );
  return true;
}

/**
 * Consulta o provedor e grava o que voltou. Nunca lança: a página tem que
 * abrir mesmo com o provedor fora do ar, mostrando o que já estava salvo.
 */
export async function sincronizar(trackingCode: string): Promise<{ ok: boolean; novos: number; erro?: string }> {
  const token = await getTrack17Token();
  if (!token) {
    await execute(`UPDATE tracking_shipments SET syncedAt = NOW(3), erro = ? WHERE trackingCode = ?`, [
      "17TRACK sem token configurado.",
      trackingCode,
    ]);
    return { ok: false, novos: 0, erro: "17TRACK sem token configurado." };
  }

  try {
    const data = await api(token, "/gettrackinfo", [{ number: trackingCode }]);
    const aceito = data?.data?.accepted?.[0];
    if (!aceito) {
      // Código ainda desconhecido: registra e tenta de novo na próxima visita.
      await registrarCodigo(trackingCode);
      await execute(
        `UPDATE tracking_shipments SET syncedAt = NOW(3), erro = ?, estagio = COALESCE(estagio,'aguardando') WHERE trackingCode = ?`,
        ["Código ainda não reconhecido pela transportadora.", trackingCode],
      );
      return { ok: true, novos: 0 };
    }

    const novos = await aplicarTrackInfo(trackingCode, aceito);
    return { ok: true, novos };
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    console.error("[17track sincronizar]", trackingCode, erro);
    await execute(`UPDATE tracking_shipments SET syncedAt = NOW(3), erro = ? WHERE trackingCode = ?`, [
      erro,
      trackingCode,
    ]);
    return { ok: false, novos: 0, erro };
  }
}

/** A remessa e seus eventos, sincronizando só se o cache venceu. */
export async function lerRemessa(
  trackingCode: string,
  storeId: string,
): Promise<{ remessa: Remessa | null; eventos: EventoRastreio[] }> {
  // A linha pode não existir em pedido despachado antes desta tela.
  await execute(`INSERT IGNORE INTO tracking_shipments (trackingCode, storeId) VALUES (?, ?)`, [
    trackingCode,
    storeId,
  ]);

  const [atual] = await query<Remessa>(
    `SELECT trackingCode, carrier, estagio, ultimoTexto, ultimoEm, entregueEm, syncedAt, erro
       FROM tracking_shipments WHERE trackingCode = ? AND storeId = ? LIMIT 1`,
    [trackingCode, storeId],
  );

  // Entregue não muda mais: não gasta consulta (o provedor cobra por número).
  const vencido =
    !atual?.syncedAt || Date.now() - new Date(atual.syncedAt).getTime() > CACHE_MINUTOS * 60_000;
  if (vencido && atual?.estagio !== "entregue") await sincronizar(trackingCode);

  const [remessa] = await query<Remessa>(
    `SELECT trackingCode, carrier, estagio, ultimoTexto, ultimoEm, entregueEm, syncedAt, erro
       FROM tracking_shipments WHERE trackingCode = ? AND storeId = ? LIMIT 1`,
    [trackingCode, storeId],
  );
  const brutos = await query<EventoRastreio>(
    `SELECT ocorridoEm, descricao, localizacao, estagio
       FROM tracking_events WHERE trackingCode = ? ORDER BY ocorridoEm DESC LIMIT 100`,
    [trackingCode],
  );

  // Traduz na LEITURA, não na gravação: o texto original fica salvo e, quando
  // a tabela de traduções crescer, os eventos antigos passam a aparecer em
  // português sozinhos — sem reprocessar nada.
  // Locais juntos: um local cortado pelo provedor é completado com o mesmo
  // lugar vindo inteiro em outro evento da remessa (ver traduzirLocais).
  const locais = traduzirLocais(brutos.map((e) => e.localizacao));
  const eventos = brutos.map((e, i) => ({
    ...e,
    descricao: traduzirEvento(e.descricao),
    localizacao: locais[i],
  }));
  return {
    remessa: remessa ? { ...remessa, ultimoTexto: traduzirEvento(remessa.ultimoTexto) } : null,
    eventos,
  };
}
