import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting simples (token bucket por chave). Protege login/cadastro contra
// força bruta e credential stuffing.
//
// ⚠️  ESTE É EM MEMÓRIA: funciona em uma única instância. Em produção com
//     múltiplos servidores/serverless, troque por Redis (ex.: @upstash/ratelimit).
// ─────────────────────────────────────────────────────────────────────────────

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count++;
  return { ok: true, retryAfterSec: 0 };
}

// Limpeza periódica para não vazar memória.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }, 60_000).unref?.();
}

/** Extrai um identificador de IP da requisição (atrás de proxy use X-Forwarded-For). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
