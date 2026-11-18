import fs from "node:fs";
import mysql from "mysql2/promise";

// Gera o schema.sql a partir da estrutura REAL do banco.
//
//   node --env-file=.env scripts/gerar-schema.mjs
//
// Por que existe: as migrações só mexem no banco, nunca no schema.sql, e ele
// ficou para trás (em 05/11/2026 tinha 12 das 28 tabelas e 138 das 413 colunas).
// Quem importasse aquilo num banco novo teria um sistema quebrado. Rode de novo
// depois de qualquer migração.
//
// Só LÊ o banco: SHOW CREATE TABLE devolve estrutura, nenhum dado nem credencial.
//
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n"), minVersion: "TLSv1.2" } : undefined,
});

// ⚠️ A Aiven roda em modo ANSI, e nele o SHOW CREATE TABLE sai com aspas duplas e
// sem ENGINE/CHARSET: num servidor com a configuração padrão, isso é erro de
// sintaxe. Vale só para esta conexão.
await conn.query(`SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION', sql_quote_show_create = 1`);

const [tabelas] = await conn.query(
  `SELECT TABLE_NAME t FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
);
const [fks] = await conn.query(
  `SELECT TABLE_NAME t, REFERENCED_TABLE_NAME r FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
);

// Quem é referenciado por chave estrangeira é criado antes.
const dependeDe = new Map(tabelas.map(({ t }) => [t, new Set()]));
for (const { t, r } of fks) if (t !== r) dependeDe.get(t).add(r);
const ordem = [];
const visto = new Set();
const visitar = (t) => {
  if (visto.has(t)) return;
  visto.add(t);
  for (const r of dependeDe.get(t)) visitar(r);
  ordem.push(t);
};
for (const t of dependeDe.keys()) visitar(t);

const blocos = [];
let colunas = 0;
for (const t of ordem) {
  const [[r]] = await conn.query(`SHOW CREATE TABLE \`${t}\``);
  // O contador de AUTO_INCREMENT é dado da produção, não estrutura.
  // As 6 tabelas criadas sem collation explícita herdaram utf8mb4_0900_ai_ci do
  // servidor, que só existe no MySQL 8. Aqui viram a mesma das outras 22: o
  // arquivo importa em qualquer servidor e o banco novo já nasce uniforme.
  const ddl = r["Create Table"]
    .replace(/\s+AUTO_INCREMENT=\d+/, "")
    .replaceAll("utf8mb4_0900_ai_ci", "utf8mb4_unicode_ci");
  colunas += ddl.split("\n").filter((l) => /^\s*`/.test(l)).length;
  blocos.push(`${ddl};`);
}
await conn.end();

// Sem CREATE DATABASE/USE: importa no banco selecionado, que nem sempre se chama
// "checkout" (na Aiven é "defaultdb"). Sem DROP TABLE, também de propósito: num
// banco que já tem as tabelas, a importação falha em vez de apagar os dados.
const arquivo = `-- ─────────────────────────────────────────────────────────────────────────────
-- Schema MySQL do Checkout (só estrutura: ${ordem.length} tabelas, ${colunas} colunas)
--
-- GERADO por scripts/gerar-schema.mjs a partir do banco real. Não edite à mão:
-- depois de uma migração, rode o script de novo.
--
-- Importe num banco VAZIO, já selecionado:
--   phpMyAdmin: abra o banco, aba "Importar" e selecione este arquivo
--   Terminal:   mysql -u root -p nome_do_banco < schema.sql
--
-- Não apaga nada: num banco que já tem as tabelas, a importação falha com
-- "#1050 Tabela já existe", e os dados continuam lá.
--
-- O arquivo importa em MySQL 8 e em MariaDB 10.4+, mas o SISTEMA precisa de MySQL 8:
-- Carrinhos usa JSON_TABLE, que o MariaDB 10.4 não tem.
-- ─────────────────────────────────────────────────────────────────────────────

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

${blocos.join("\n\n")}

SET FOREIGN_KEY_CHECKS = 1;
`;

fs.writeFileSync(new URL("../schema.sql", import.meta.url), arquivo);
console.log(`schema.sql: ${ordem.length} tabelas, ${colunas} colunas`);
