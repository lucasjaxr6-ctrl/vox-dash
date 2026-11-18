// Nome legível do aparelho a partir do User-Agent: "Chrome · Windows".
//
// Classificação grosseira DE PROPÓSITO — serve para a pessoa reconhecer o
// próprio acesso na lista de dispositivos, não para identificar o aparelho.
// Erro aqui não tem consequência de segurança: o que encerra a sessão é o id,
// não este texto.

/** Navegador. A ORDEM importa: quase todo navegador se diz "Chrome/Safari". */
function browser(ua: string): string | null {
  if (/edg[ea]?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  // Apps que abrem o site dentro deles — comum em tráfego de anúncio.
  if (/instagram/i.test(ua)) return "Instagram";
  if (/fban|fbav|fb_iab/i.test(ua)) return "Facebook";
  if (/chrome|crios/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return null;
}

/** Sistema. iPadOS moderno se anuncia como Macintosh, daí o teste de toque. */
function system(ua: string): string | null {
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/macintosh|mac os x/i.test(ua)) return /mobile/i.test(ua) ? "iPad" : "Mac";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}

/** "Chrome · Windows", "Safari · iPhone" — ou "Dispositivo desconhecido". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").trim();
  if (!ua) return "Dispositivo desconhecido";
  const parts = [browser(ua), system(ua)].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Dispositivo desconhecido";
}

/** "Rio de Janeiro, RJ, BR" a partir do que foi gravado — ou null. */
export function describeLocation(city?: string | null, region?: string | null, country?: string | null): string | null {
  const parts = [city, region, country].map((p) => (p || "").trim()).filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
