import "server-only";

// ─────────────────────────────────────────────────────────────────────────────
// Peças de montagem dos e-mails transacionais.
//
// Existe para os quatro e-mails dividirem o MESMO esqueleto: antes cada um
// tinha o seu HTML copiado, então melhorar o do Pix não melhorava o de
// pagamento aprovado — e o cliente recebia três e-mails com três caras.
//
// Regras de e-mail que ditam o código aqui (não é preciosismo, é o que quebra):
//  • Só TABELA e estilo INLINE. Gmail descarta <style> do <head>, e flex/grid
//    não existem no Outlook (que renderiza com o motor do Word).
//  • Nada de SVG: o Gmail remove. Ícone é PNG nosso (ver `EmailIconName`).
//  • Imagem só com URL ABSOLUTA — no e-mail não existe caminho relativo.
//  • `border-radius` degrada para canto reto no Outlook, e tudo bem.
// ─────────────────────────────────────────────────────────────────────────────

export const VERDE = "#0b7a4b";
export const VERDE_CLARO = "#eaf5ef";

// ── Ícones ───────────────────────────────────────────────────────────────────
// Emoji era o caminho fácil, mas quem escolhe o desenho é o sistema do
// DESTINATÁRIO: 🔒 vira um cadeado amarelo gordo no Windows e um cinza no
// Mac — nada a ver com o verde do resto do e-mail. Estes PNGs (public/email/)
// são monocromáticos na cor da marca e iguais em qualquer cliente.

export type EmailIconName = "check" | "lock" | "box" | "truck" | "pix" | "cart";

const ICON_PATH: Record<EmailIconName, string> = {
  check: "/email/check.png",
  lock: "/email/lock.png",
  box: "/email/box.png",
  truck: "/email/truck.png",
  cart: "/email/cart.png",
  pix: "/payment/pix.png", // o mesmo logo do checkout
};

/** URL absoluta do ícone. Sem base resolvida, devolve null e o ícone é omitido. */
export function iconUrl(base: string | null | undefined, name: EmailIconName): string | null {
  return base ? `${base}${ICON_PATH[name]}` : null;
}

function iconImg(url: string, px: number, alt: string): string {
  return `<img src="${url}" alt="${esc(alt)}" width="${px}" height="${px}" style="display:block;width:${px}px;height:${px}px;border:0;outline:none;text-decoration:none;">`;
}

export function brl(c: number): string {
  return (Number(c) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Escapa valor do cliente/produto antes de injetar no HTML. */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só deixa passar http(s) — bloqueia `javascript:` e afins vindos de config. */
export function safeUrl(u: string | null | undefined): string | null {
  const v = (u || "").trim();
  if (!/^https?:\/\//i.test(v)) return null;
  return esc(v);
}

// Sem foto do produto de propósito: a maioria dos clientes de e-mail bloqueia
// imagem externa por padrão, e o que sobra é um retângulo vazio no lugar.
export type EmailItem = { name: string; quantity: number; unitPriceCents: number };

export type ShellOpts = {
  store: string;
  /** Logo da loja (URL absoluta). Sem ela, usa o nome em maiúsculas. */
  logoUrl?: string | null;
  tagline?: string | null;
  /** Origem dos ícones (`https://dominio`). Sem ela, o selo sai sem ícone. */
  assetBase?: string | null;
  /** Ícone do selo de status. */
  icon: EmailIconName;
  title: string;
  subtitle: string;
  body: string;
};

/** Envelope completo do e-mail: cabeçalho, faixa de status, corpo e rodapé. */
export function shell(o: ShellOpts): string {
  const logo = safeUrl(o.logoUrl);
  const cabecalho = logo
    ? `<img src="${logo}" alt="${esc(o.store)}" width="150" style="display:block;margin:0 auto;max-width:150px;height:auto;border:0;">`
    : `<div style="font-size:21px;font-weight:700;letter-spacing:3px;color:#14342a;text-transform:uppercase;">${esc(o.store)}</div>`;

  // Selo do status. O ladrilho branco só existe se o ícone existir — melhor um
  // quadrado ausente do que um quadrado vazio ao lado do título.
  const badgeUrl = iconUrl(o.assetBase, o.icon);
  const selo = badgeUrl
    ? `<td width="62" valign="middle" style="padding:20px 0 20px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td width="42" height="42" align="center" valign="middle" bgcolor="#ffffff" style="width:42px;height:42px;background:#ffffff;border-radius:11px;">
                    ${iconImg(badgeUrl, 22, "")}
                  </td></tr>
                </table>
              </td>`
    : "";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <!-- Resumo que aparece na lista do app de e-mail, antes de abrir. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(o.title)} — ${esc(o.subtitle)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:14px;border:1px solid #e6eaec;">

        <tr><td align="center" style="padding:30px 32px 22px;">
          ${cabecalho}
          ${o.tagline ? `<div style="margin-top:7px;font-size:11px;letter-spacing:3px;color:#8a9a93;text-transform:uppercase;">${esc(o.tagline)}</div>` : ""}
        </td></tr>

        <tr><td style="padding:0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${VERDE_CLARO};border-radius:12px;">
            <tr>
              ${selo}
              <td valign="middle" style="padding:20px 20px 20px ${selo ? "12px" : "20px"};">
                <div style="font-size:19px;font-weight:700;color:#12372a;line-height:1.3;">${esc(o.title)}</div>
                <div style="margin-top:4px;font-size:13.5px;color:#4a6b5c;line-height:1.45;">${esc(o.subtitle)}</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:22px 32px 4px;">${o.body}</td></tr>

        <tr><td style="padding:22px 32px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #edf1f3;">
            <tr>
              <td align="center" style="padding:16px 4px 0;font-size:11.5px;color:#8a9a93;">Compra segura</td>
              <td align="center" style="padding:16px 4px 0;font-size:11.5px;color:#8a9a93;border-left:1px solid #edf1f3;border-right:1px solid #edf1f3;">Dados protegidos</td>
              <td align="center" style="padding:16px 4px 0;font-size:11.5px;color:#8a9a93;">Atendimento</td>
            </tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:20px 32px 28px;">
          <div style="font-size:13px;font-weight:700;color:#3d4f47;">${esc(o.store)}</div>
          ${o.tagline ? `<div style="margin-top:2px;font-size:12px;color:#9aa8a2;">${esc(o.tagline)}</div>` : ""}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Saudação + frase de abertura. */
export function intro(firstName: string, text: string): string {
  return `
  <p style="margin:0 0 14px;font-size:15px;color:#2f3d37;">Olá${firstName ? `, <b>${esc(firstName)}</b>` : ""}!</p>
  <p style="margin:0 0 18px;font-size:14.5px;color:#4b5a53;line-height:1.55;">${text}</p>`;
}

/** Cartão "Resumo do pedido": itens com foto + subtotal/desconto/frete/total. */
export function summaryCard(opts: {
  items: EmailItem[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  totalLabel?: string;
  /** Cabeçalho do cartão. Em carrinho abandonado não existe pedido nenhum. */
  title?: string;
}): string {
  const linhas = opts.items
    .map(
      (it) => `
      <tr>
        <td valign="top" style="padding:14px 0;">
          <div style="font-size:14px;color:#2f3d37;line-height:1.4;">${esc(it.name)}</div>
          <div style="margin-top:3px;font-size:12.5px;color:#93a29b;">Quantidade: ${Number(it.quantity)}</div>
        </td>
        <td valign="top" align="right" style="padding:14px 0;font-size:14px;color:#2f3d37;white-space:nowrap;">
          ${brl(it.unitPriceCents * it.quantity)}
        </td>
      </tr>`,
    )
    .join("");

  const linha = (rotulo: string, valor: string, cor = "#2f3d37") => `
      <tr>
        <td style="padding:5px 0;font-size:13.5px;color:#6b7c74;">${esc(rotulo)}</td>
        <td align="right" style="padding:5px 0;font-size:13.5px;color:${cor};white-space:nowrap;">${valor}</td>
      </tr>`;

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6eaec;border-radius:12px;">
    <tr><td style="padding:14px 18px;background:#f7f9fa;border-bottom:1px solid #e6eaec;border-radius:12px 12px 0 0;">
      <div style="font-size:14px;font-weight:700;color:#2f3d37;">${esc(opts.title || "Resumo do pedido")}</div>
    </td></tr>
    <tr><td style="padding:0 18px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${linhas}
        <tr><td colspan="2" style="border-top:1px solid #edf1f3;padding:0;font-size:0;line-height:0;">&nbsp;</td></tr>
        ${linha("Subtotal", brl(opts.subtotalCents))}
        ${opts.discountCents > 0 ? linha("Desconto", `- ${brl(opts.discountCents)}`, "#0b7a4b") : ""}
        ${opts.shippingCents > 0 ? linha("Frete", brl(opts.shippingCents)) : ""}
        <tr>
          <td style="padding:11px 0 2px;border-top:1px solid #edf1f3;font-size:15.5px;font-weight:700;color:#2f3d37;">${esc(opts.totalLabel || "Total")}</td>
          <td align="right" style="padding:11px 0 2px;border-top:1px solid #edf1f3;font-size:16px;font-weight:700;color:${VERDE};white-space:nowrap;">${brl(opts.totalCents)}</td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

/** Caixa de destaque com ícone, título e texto (ex.: "Próxima etapa"). */
export function infoBox(base: string | null | undefined, icon: EmailIconName, title: string, text: string): string {
  const url = iconUrl(base, icon);
  // 13px em cima (contra os 16px do texto) centra o ícone de 22px na PRIMEIRA
  // linha do título, não no bloco inteiro.
  const cel = url ? `<td width="42" valign="top" style="padding:13px 0 16px 16px;">${iconImg(url, 22, "")}</td>` : "";
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:${VERDE_CLARO};border-radius:12px;">
    <tr>
      ${cel}
      <td valign="top" style="padding:16px 16px 16px ${cel ? "10px" : "16px"};">
        <div style="font-size:14px;font-weight:700;color:#12372a;">${esc(title)}</div>
        <div style="margin-top:3px;font-size:13px;color:#4a6b5c;line-height:1.5;">${esc(text)}</div>
      </td>
    </tr>
  </table>`;
}

/** Botão principal. Retorna vazio sem URL — link quebrado é pior que sem botão. */
export function ctaButton(label: string, url: string | null | undefined): string {
  const href = safeUrl(url);
  if (!href) return "";
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
    <tr><td align="center" style="background:${VERDE};border-radius:10px;">
      <a href="${href}" target="_blank" style="display:block;padding:15px 24px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/** Bloco de código monoespaçado (copia-e-cola do Pix, rastreio). */
export function codeBlock(title: string, code: string): string {
  return `
  <div style="margin-top:20px;font-size:13.5px;font-weight:700;color:#2f3d37;">${esc(title)}</div>
  <div style="margin-top:8px;padding:14px;background:#f7f9fa;border:1px solid #e6eaec;border-radius:10px;">
    <div style="font-family:'Courier New',Courier,monospace;font-size:12px;color:#3d4f47;word-break:break-all;line-height:1.6;">${esc(code)}</div>
  </div>`;
}

/**
 * Linha do tempo do pedido. `atual` é 0-indexado.
 *
 * O traço entre as bolinhas é feito de células de 3px com cor de fundo — é a
 * forma que sobrevive ao Outlook. Com borda ou pseudo-elemento, ele some.
 */
export function timeline(passos: string[], atual: number): string {
  // Cada etapa é uma tabela independente, então a linha só sai reta se todas
  // tiverem a MESMA altura. Como as bolinhas têm tamanhos diferentes (a atual
  // ganha um anel de 3px, a pendente uma borda de 2px), a altura vinha da
  // bolinha e o `valign=middle` centrava o traço num ponto diferente em cada
  // coluna — daí a linha quebrada. Aqui a faixa tem altura FIXA e a bolinha é
  // centralizada dentro dela, seja qual for o seu tamanho.
  const ALTURA = 24;

  // O traço é um DIV de altura fixa dentro de uma célula `valign=middle`.
  // Colorir o fundo da própria célula não funciona: ela estica até a altura da
  // faixa e o traço vira uma barra grossa.
  const traco = (cor: string | null) =>
    `<td valign="middle" height="${ALTURA}" style="height:${ALTURA}px;padding:0;">` +
    `<div style="height:3px;line-height:3px;font-size:1px;background:${cor ?? "transparent"};">&nbsp;</div>` +
    `</td>`;

  const celulas = passos
    .map((p, i) => {
      const feito = i < atual;
      const agora = i === atual;
      const esquerda = i === 0 ? null : i <= atual ? VERDE : "#dfe6e2";
      const direita = i === passos.length - 1 ? null : i < atual ? VERDE : "#dfe6e2";

      // A bolinha é uma CÉLULA de 18×18 com raio — divs aninhados com
      // line-height para centralizar não sobrevivem ao Outlook.
      //
      // O raio vale pela borda EXTERNA: numa célula de 18px com borda de 3px,
      // `border-radius:9px` arredonda um quadrado de 24px e sai um quadrado de
      // cantos moles, não um círculo. Por isso cada estado usa metade do seu
      // tamanho externo (18 → 9, 18+2+2 → 11, 18+3+3 → 12).
      const bola = feito
        ? `<td width="18" height="18" align="center" style="width:18px;height:18px;background:${VERDE};border-radius:9px;color:#ffffff;font-size:11px;line-height:18px;">&#10003;</td>`
        : agora
        ? `<td width="18" height="18" style="width:18px;height:18px;background:${VERDE};border-radius:12px;border:3px solid ${VERDE_CLARO};font-size:0;line-height:0;">&nbsp;</td>`
        : `<td width="18" height="18" style="width:18px;height:18px;background:#ffffff;border-radius:11px;border:2px solid #dfe6e2;font-size:0;line-height:0;">&nbsp;</td>`;

      return `
      <td width="25%" valign="top" style="padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${traco(esquerda)}
            <td width="${ALTURA}" height="${ALTURA}" align="center" valign="middle" style="width:${ALTURA}px;height:${ALTURA}px;padding:0;font-size:0;line-height:0;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>${bola}</tr></table>
            </td>
            ${traco(direita)}
          </tr>
        </table>
        <div style="margin-top:9px;text-align:center;font-size:11.5px;font-weight:${agora || feito ? "700" : "400"};color:${agora || feito ? "#12372a" : "#9aa8a2"};line-height:1.35;">${esc(p)}</div>
      </td>`;
    })
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6eaec;border-radius:12px;">
    <tr><td style="padding:14px 18px;background:#f7f9fa;border-bottom:1px solid #e6eaec;border-radius:12px 12px 0 0;">
      <div style="font-size:14px;font-weight:700;color:#2f3d37;">Status do pedido</div>
    </td></tr>
    <tr><td style="padding:20px 18px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${celulas}</tr></table>
    </td></tr>
  </table>`;
}

/** Duas informações lado a lado (ex.: forma de pagamento | pago em). */
export function twoCols(a: { label: string; value: string }, b: { label: string; value: string }): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;background:#f7f9fa;border:1px solid #e6eaec;border-radius:12px;">
    <tr>
      <td width="50%" valign="top" style="padding:16px 18px;">
        <div style="font-size:11.5px;color:#93a29b;">${esc(a.label)}</div>
        <div style="margin-top:3px;font-size:14px;color:#2f3d37;">${esc(a.value)}</div>
      </td>
      <td width="50%" valign="top" style="padding:16px 18px;">
        <div style="font-size:11.5px;color:#93a29b;">${esc(b.label)}</div>
        <div style="margin-top:3px;font-size:14px;color:#2f3d37;">${esc(b.value)}</div>
      </td>
    </tr>
  </table>`;
}

/** Observação final, em cinza. */
export function note(text: string): string {
  return `<p style="margin:18px 0 0;font-size:12.5px;color:#93a29b;line-height:1.55;">${text}</p>`;
}
