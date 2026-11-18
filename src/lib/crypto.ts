import "server-only";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Criptografia de segredos guardados no banco (ex.: tokens da Shopify).
// AES-256-GCM = criptografia AUTENTICADA: além de cifrar, detecta adulteração
// (auth tag). IV aleatório por operação. A chave-mestra vem da ENCRYPTION_KEY
// (32 bytes em base64) — o ÚNICO segredo de integração que fica no .env.
// ─────────────────────────────────────────────────────────────────────────────

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY não configurada no ambiente");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY deve conter 32 bytes (base64 de 32 bytes)");
  }
  return key;
}

/** Cifra um texto. Saída: base64(iv).base64(tag).base64(ciphertext). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(".");
}

/** Decifra um payload gerado por encryptSecret. Lança se foi adulterado. */
export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("payload criptografado inválido");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
