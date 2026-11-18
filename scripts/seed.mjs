// Seed: cria o admin da plataforma e um lojista (merchant). Rode com: npm run seed
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "checkout",
});

async function upsertUser(email, name, role) {
  const hash = await bcrypt.hash("TroqueEstaSenha123", 12);
  await conn.execute(
    `INSERT INTO users (id, email, name, passwordHash, role)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [randomUUID(), email, name, hash, role],
  );
  console.log(`${role}:`, email);
}

await upsertUser("admin@example.com", "Administrador", "ADMIN");
await upsertUser("lojista@example.com", "Lojista", "MERCHANT");

console.log("Seed OK. Senha padrão: TroqueEstaSenha123 (troque depois!)");
await conn.end();
