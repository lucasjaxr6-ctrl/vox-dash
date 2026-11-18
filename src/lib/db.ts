import "server-only";
import mysql from "mysql2/promise";
import { randomUUID } from "crypto";
import { attachDatabasePool } from "@vercel/functions";

// ─────────────────────────────────────────────────────────────────────────────
// Acesso ao MySQL via mysql2 (sem ORM). Lê as variáveis DB_* do .env direto —
// formato separado, igual ao do XAMPP/Aiven.
//
// SEGURANÇA: todas as queries usam prepared statements (placeholders ?). NUNCA
// concatene input do usuário dentro da string SQL — sempre passe via ?.
// multipleStatements fica FALSE (padrão), o que impede empilhar várias queries
// numa única string e reduz a superfície de SQL injection.
// ─────────────────────────────────────────────────────────────────────────────

const globalForDb = globalThis as unknown as { _pool?: mysql.Pool };

// TLS: provedores gerenciados (Aiven, PlanetScale...) exigem SSL e assinam o
// certificado com CA própria. Se DB_CA_CERT estiver definido (conteúdo do
// ca.pem), conecta com verificação do CA. Sem ele (ex.: XAMPP local), conecta
// sem SSL.
// Aceita o PEM com quebras de linha reais OU com "\n" escapado (mais fácil de
// colar numa única linha no .env / painel da Vercel).
const dbCaCert = process.env.DB_CA_CERT
  ? process.env.DB_CA_CERT.replace(/\\n/g, "\n")
  : undefined;

// Tamanho do pool POR INSTÂNCIA. Em serverless (Vercel) cada instância mantém o
// próprio pool: um limite alto × muitas instâncias estoura o teto do provedor
// ("ER_CON_COUNT_ERROR: Too many connections") e derruba o site inteiro. Poucas
// conexões por instância + liberação das ociosas mantém o total sob controle.
const POOL_SIZE = Math.max(1, Number(process.env.DB_POOL_SIZE ?? 3));

export const pool =
  globalForDb._pool ??
  mysql.createPool({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    database: process.env.DB_NAME ?? "checkout",
    waitForConnections: true,
    // Capacidade de PICO por instância (rajadas usam até isso).
    connectionLimit: POOL_SIZE,
    queueLimit: 0,
    // Em REPOUSO cada instância retém só 1 conexão: `maxIdle` é quantas ociosas
    // o pool guarda, e mantê-lo igual ao connectionLimit fazia cada instância
    // segurar 3 vagas paradas. Com 46 vagas no total, isso multiplica rápido.
    maxIdle: 1,
    idleTimeout: 30_000,
    // Interpreta os DATETIME do banco como UTC (a exibição converte para SP).
    timezone: "Z",
    ssl: dbCaCert ? { ca: dbCaCert, minVersion: "TLSv1.2" } : undefined,
  });

// Conexão ociosa x função congelada (desde 01/11/2026). Entre uma requisição
// e outra a Vercel congela a função; a conexão guardada no pool morre do lado
// do banco, e a próxima consulta mandava o pedido por um socket morto e ficava
// esperando até desistir. Era a página que, de vez em quando, levava um tempão
// para trocar. `attachDatabasePool` (o jeito oficial da Vercel) mantém a função
// viva até o pool fechar as ociosas, então nada morto sobra para depois.
// Fica fora da Vercel (dev, build) sem efeito; e um tipo de pool que ela não
// reconheça não pode derrubar o banco, daí o try.
if (!globalForDb._pool) {
  try {
    // O pool do `mysql2/promise` é um invólucro: quem tem a configuração e o
    // evento "release" que ela observa é o pool de dentro (`.pool`).
    attachDatabasePool((pool as unknown as { pool: Parameters<typeof attachDatabasePool>[0] }).pool);
  } catch (e) {
    console.error("[db] attachDatabasePool:", e instanceof Error ? e.message : e);
  }
}

// Reaproveita o MESMO pool entre re-avaliações do módulo. Em produção isso é
// ainda mais importante que em dev: sem o cache global, cada re-avaliação abria
// um pool novo e as conexões antigas ficavam penduradas até estourar o limite.
globalForDb._pool = pool;

/**
 * Consulta que passou de 1,5 s vai para o log. Medido no mesmo datacenter, uma
 * ida ao banco leva milissegundos: passar disso é conexão travada ou consulta
 * pesada, e sem o registro a causa de uma tela lenta vira adivinhação.
 */
function registrarLenta(inicio: number, sql: string) {
  const ms = Date.now() - inicio;
  if (ms > 1500) console.warn(`[db] consulta lenta: ${ms} ms · ${sql.replace(/\s+/g, " ").slice(0, 90)}`);
}

// Falhas de CONEXÃO, não da consulta: a conexão parada no pool morreu (o banco
// derruba as ociosas, e a função serverless congela e volta com o socket
// morto) ou o banco recusou conexão nova num pico. O pool descarta a conexão
// ruim, então a segunda tentativa já sai por uma nova.
const FALHA_DE_CONEXAO = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ER_CON_COUNT_ERROR",
]);

/**
 * SELECT com prepared statement. Retorna as linhas.
 *
 * Leitura que cai por falha de conexão é repetida UMA vez. Sem isso a falha
 * chegava ao layout do painel, e o lojista logado precisava atualizar a página
 * algumas vezes até ela abrir. Só leitura: escrita (execute) nunca repete,
 * porque com a conexão caindo no meio não dá para saber se gravou.
 */
export async function query<T = any>(
  sql: string,
  params: any[] = [],
): Promise<T[]> {
  const inicio = Date.now();
  try {
    const [rows] = await pool.execute(sql, params);
    return rows as T[];
  } catch (e: any) {
    if (!FALHA_DE_CONEXAO.has(e?.code) || !/^\s*(SELECT|WITH|SHOW)\b/i.test(sql)) throw e;
    console.warn(`[db] conexão caiu (${e.code}) após ${Date.now() - inicio} ms; repetindo a leitura`);
    await new Promise((r) => setTimeout(r, 150));
    const [rows] = await pool.execute(sql, params);
    return rows as T[];
  } finally {
    registrarLenta(inicio, sql);
  }
}

/** INSERT/UPDATE/DELETE com prepared statement. Retorna o header (affectedRows). */
export async function execute(
  sql: string,
  params: any[] = [],
): Promise<mysql.ResultSetHeader> {
  const inicio = Date.now();
  try {
    const [result] = await pool.execute(sql, params);
    return result as mysql.ResultSetHeader;
  } finally {
    registrarLenta(inicio, sql);
  }
}

/** Roda um callback dentro de uma transação (commit/rollback automáticos). */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Gera IDs (UUID v4) no app, já que não há mais o cuid() do ORM. */
export function newId(): string {
  return randomUUID();
}

/** Monta placeholders para cláusula IN (...): inPlaceholders(3) => "?,?,?". */
export function inPlaceholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}
