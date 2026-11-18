"use client";

import React from "react";
import Script from "next/script";

export type ActivePixel = {
  type: "meta" | "google" | "ga4" | "tiktok" | "taboola" | "kwai" | "pinterest";
  pixelId: string;
  conversionLabel?: string;
  paidOnly?: boolean;
};

// Injeta os scripts base dos pixels e dispara os eventos de PÁGINA (PageView /
// InitiateCheckout / begin_checkout; no TikTok, page + InitiateCheckout; na
// Taboola, page_view + start_checkout; no Kwai, page + EVENT_INITIATED_CHECKOUT;
// no Pinterest, page — que é o pagevisit deles). O
// evento de compra é disparado depois, pelo firePurchase. Renderizado APENAS no
// checkout real (/checkout).
//
// Google Analytics (ga4): aqui só o `config`, que já conta a visita. O
// begin_checkout dele sai do CheckoutFormCharm, porque o relatório de e-commerce
// precisa dos itens do carrinho, que este componente não conhece.
//
// ⚠️ Pixels marcados como "Disparar apenas em vendas pagas" (paidOnly) NÃO
// disparam nada aqui — só o Purchase. Sem isso, cada visita ao checkout virava
// evento e inflava as conversões do Google Ads/Meta.
// `pageEvents=false` carrega só os scripts base (para o Purchase funcionar), sem
// disparar PageView/InitiateCheckout/begin_checkout. Usado na página de
// pagamento do Pix: ela é a continuação do mesmo checkout, então repetir os
// eventos de topo de funil contaria a mesma visita duas vezes.
export default function PixelScripts({ pixels, pageEvents = true }: { pixels: ActivePixel[]; pageEvents?: boolean }) {
  const meta = pixels.filter((p) => p.type === "meta" && p.pixelId);
  const google = pixels.filter((p) => p.type === "google" && p.pixelId);
  const ga4 = pixels.filter((p) => p.type === "ga4" && p.pixelId);
  // Google Ads e Analytics dividem o mesmo gtag.js: basta carregá-lo uma vez e
  // dar um `config` para cada ID.
  const gtagIds = [...google, ...ga4];
  const tiktok = pixels.filter((p) => p.type === "tiktok" && p.pixelId);
  // Taboola: só conta com o número da conta (é ele que monta a URL do tfa.js).
  const taboola = pixels.filter((p) => p.type === "taboola" && /^\d+$/.test(p.pixelId));
  const kwai = pixels.filter((p) => p.type === "kwai" && p.pixelId);
  const pinterest = pixels.filter((p) => p.type === "pinterest" && p.pixelId);

  if (meta.length === 0 && gtagIds.length === 0 && tiktok.length === 0 && taboola.length === 0 && kwai.length === 0 && pinterest.length === 0) {
    return null;
  }

  // Kwai: mesma estrutura do TikTok (o events.js deles lê a fila `kwaiq`
  // declarada em `KwaiAnalyticsObject`, com `load` por pixel e `instance(id)`).
  // Eventos por instance: com vários pixels, `kwaiq.page()` dispararia em todos.
  const kwaiLoad = kwai.map((p) => `kwaiq.load(${JSON.stringify(p.pixelId)});`).join("\n");
  const kwaiPageEvents = !pageEvents
    ? ""
    : kwai
        .filter((p) => !p.paidOnly)
        .map(
          (p) =>
            `kwaiq.instance(${JSON.stringify(p.pixelId)}).page();\nkwaiq.instance(${JSON.stringify(p.pixelId)}).track('EVENT_INITIATED_CHECKOUT');`,
        )
        .join("\n");

  // Pinterest: o `pintrk('track')` vai para TODAS as tags carregadas na página
  // — não existe disparo por tag. Por isso, na página do checkout (que dispara
  // pagevisit) só entram as tags que NÃO são "só vendas pagas"; nas páginas sem
  // eventos de topo (Pix, obrigado), entram todas. A de venda paga que faltar
  // é carregada na hora da compra (firePurchase). `__voxPin` registra quais já
  // foram carregadas, para não carregar a mesma duas vezes.
  const pinterestCarregar = pageEvents ? pinterest.filter((p) => !p.paidOnly) : pinterest;
  const pinterestLoad = pinterestCarregar
    .map((p) => `pintrk('load', ${JSON.stringify(p.pixelId)});window.__voxPin[${JSON.stringify(p.pixelId)}]=1;`)
    .join("\n");

  // Taboola: `window._tfa` é uma FILA — o tfa.js processa o que já estiver
  // nela quando carrega, então dá para empurrar eventos antes do script. Um
  // tfa.js por conta (o id do <script> evita carregar a mesma conta duas vezes).
  const taboolaEventos = !pageEvents
    ? ""
    : taboola
        .filter((p) => !p.paidOnly)
        .map(
          (p) =>
            `window._tfa.push({notify:'event',name:'page_view',id:${Number(p.pixelId)}});\nwindow._tfa.push({notify:'event',name:'start_checkout',id:${Number(p.pixelId)}});`,
        )
        .join("\n");
  const taboolaLoad = taboola
    .map(
      (p) =>
        `!function(t,f,a,x){if(!document.getElementById(x)){t.async=1;t.src=a;t.id=x;f.parentNode.insertBefore(t,f)}}(document.createElement('script'),document.getElementsByTagName('script')[0],'//cdn.taboola.com/libtrc/unip/${Number(p.pixelId)}/tfa.js','tb_tfa_script_${Number(p.pixelId)}');`,
    )
    .join("\n");

  // TikTok: o snippet oficial deles, com `ttq.load` para cada pixel. Os eventos
  // vão por `ttq.instance(id)` — com vários pixels, `ttq.page()` dispararia em
  // todos, inclusive nos marcados "só vendas pagas".
  const tiktokLoad = tiktok.map((p) => `ttq.load(${JSON.stringify(p.pixelId)});`).join("\n");
  const tiktokPageEvents = !pageEvents
    ? ""
    : tiktok
        .filter((p) => !p.paidOnly)
        .map(
          (p) =>
            `ttq.instance(${JSON.stringify(p.pixelId)}).page();\nttq.instance(${JSON.stringify(p.pixelId)}).track('InitiateCheckout');`,
        )
        .join("\n");

  const metaInit = meta.map((p) => `fbq('init', ${JSON.stringify(p.pixelId)});`).join("\n");
  // Eventos de página só nos pixels que NÃO são "apenas vendas pagas".
  const metaPageEvents = !pageEvents
    ? ""
    : meta
        .filter((p) => !p.paidOnly)
        .map(
          (p) =>
            `fbq('trackSingle', ${JSON.stringify(p.pixelId)}, 'PageView');\nfbq('trackSingle', ${JSON.stringify(p.pixelId)}, 'InitiateCheckout');`,
        )
        .join("\n");

  // send_page_view: false impede que o próprio config conte uma visita.
  const googleConfig = gtagIds
    .map(
      (p) =>
        `gtag('config', ${JSON.stringify(p.pixelId)}${p.paidOnly || !pageEvents ? ", { send_page_view: false }" : ""});`,
    )
    .join("\n");
  const googleBeginCheckout = !pageEvents
    ? ""
    : google
        .filter((p) => !p.paidOnly)
        .map((p) => `gtag('event', 'begin_checkout', { send_to: ${JSON.stringify(p.pixelId)} });`)
        .join("\n");

  return (
    <>
      {meta.length > 0 && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
${metaInit}
${metaPageEvents}`}
        </Script>
      )}

      {gtagIds.length > 0 && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gtagIds[0].pixelId)}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
${googleConfig}
${googleBeginCheckout}`}
          </Script>
        </>
      )}

      {tiktok.length > 0 && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function (w, d, t) {
w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
${tiktokLoad}
${tiktokPageEvents}
}(window, document, 'ttq');`}
        </Script>
      )}

      {kwai.length > 0 && (
        <Script id="kwai-pixel" strategy="afterInteractive">
          {`!function (w, d, t) {
w.KwaiAnalyticsObject=t;var kwaiq=w[t]=w[t]||[];kwaiq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],kwaiq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<kwaiq.methods.length;i++)kwaiq.setAndDefer(kwaiq,kwaiq.methods[i]);kwaiq.instance=function(t){for(var e=kwaiq._i[t]||[],n=0;n<kwaiq.methods.length;n++)kwaiq.setAndDefer(e,kwaiq.methods[n]);return e},kwaiq.load=function(e,n){var r="https://s1.kwai.net/kos/s101/nlav11187/pixel/events.js";kwaiq._i=kwaiq._i||{},kwaiq._i[e]=[],kwaiq._i[e]._u=r,kwaiq._t=kwaiq._t||{},kwaiq._t[e]=+new Date,kwaiq._o=kwaiq._o||{},kwaiq._o[e]=n||{};n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
${kwaiLoad}
${kwaiPageEvents}
}(window, document, 'kwaiq');`}
        </Script>
      )}

      {pinterest.length > 0 && (
        <Script id="pinterest-tag" strategy="afterInteractive">
          {`!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");
window.__voxPin = window.__voxPin || {};
${pinterestLoad}
${pageEvents && pinterestCarregar.length ? "pintrk('page');" : ""}`}
        </Script>
      )}

      {taboola.length > 0 && (
        <Script id="taboola-pixel" strategy="afterInteractive">
          {`window._tfa = window._tfa || [];
${taboolaEventos}
${taboolaLoad}`}
        </Script>
      )}
    </>
  );
}
