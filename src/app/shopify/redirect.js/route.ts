// GET /shopify/redirect.js?to=<url-do-checkout-voxpay>
// Script injetado na vitrine da Shopify (via ScriptTag). Ao clicar em "finalizar
// compra", lê o carrinho (/cart.js) e manda o cliente para o checkout do VoxPay
// levando os itens (productId da Shopify + quantidade). O VoxPay recalcula o
// preço no servidor pelos produtos sincronizados (nunca confia no frontend).

export async function GET(req: Request) {
  const url = new URL(req.url);
  const to = url.searchParams.get("to") || "";
  // Só aceita destino https válido (evita open-redirect via ScriptTag).
  const safeTo = /^https:\/\/[a-z0-9.-]+(\/[^\s"']*)?$/i.test(to) ? to : "";

  // Script defensivo: só INTERCEPTA o clique do botão de checkout e redireciona.
  // Nunca esconde/altera elementos. Tudo em try/catch para não quebrar o tema.
  const js = `(function(){
  try{
    var CHECKOUT = ${JSON.stringify(safeTo)};
    if(!CHECKOUT) return;
    // Guarda: se o snippet no theme.liquid E o ScriptTag carregarem juntos, só um
    // inicializa (evita listeners/beat duplicados).
    if(window.__voxRedirect) return; window.__voxRedirect = 1;
    var SEL = '[name="checkout"],button[name="checkout"],a[href$="/checkout"],a[href*="/checkout?"]';

    // Presença ao vivo (visitante da LOJA) — batida periódica para o painel.
    try{
      var ORIGIN = new URL(CHECKOUT).origin;
      var sid = localStorage.getItem("vox_sid") || (Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem("vox_sid", sid);
      var beat = function(){ try{ if(document.visibilityState !== "visible") return; new Image().src = ORIGIN + "/api/live/beat?sid=" + encodeURIComponent(sid) + "&scope=store&step=0&t=" + Date.now(); }catch(_){} };
      beat(); setInterval(beat, 20000);

      // ── Visita na PÁGINA DO PRODUTO ──
      // Uma batida só, no carregamento: é visita, não presença. Mandar junto com
      // o beat de 20s contaria a mesma pessoa parada na página como interesse
      // crescente.
      //
      // O id sai de ShopifyAnalytics.meta.product, que todo tema publica na
      // página de produto. Quando o tema não expõe (alguns headless/custom),
      // caímos no /products/<handle>.js, que é rota nativa da Shopify.
      if(/\\/products\\//.test(location.pathname)){
        var enviaProduto = function(id){
          try{
            if(!id) return;
            new Image().src = ORIGIN + "/api/live/beat?sid=" + encodeURIComponent(sid) +
              "&scope=store&step=0&pid=" + encodeURIComponent(id) + "&t=" + Date.now();
          }catch(_){}
        };
        var pid = "";
        try{
          if(window.ShopifyAnalytics && ShopifyAnalytics.meta && ShopifyAnalytics.meta.product){
            pid = String(ShopifyAnalytics.meta.product.id || "");
          }
        }catch(_){}
        if(pid){
          enviaProduto(pid);
        }else{
          try{
            var handle = (location.pathname.match(/\\/products\\/([^\\/?#]+)/) || [])[1];
            if(handle){
              fetch("/products/" + handle + ".js", {credentials:"same-origin"})
                .then(function(r){ return r.json(); })
                .then(function(p){ enviaProduto(p && p.id); })
                ["catch"](function(){});
            }
          }catch(_){}
        }
      }
    }catch(_){}
    var going = false;
    function go(e){
      try{
        if(going) return; going = true;
        if(e && e.preventDefault) e.preventDefault();
        fetch("/cart.js",{credentials:"same-origin"}).then(function(r){return r.json();}).then(function(cart){
          var items = (cart.items||[]).map(function(i){ return i.product_id + ":" + i.quantity; }).join(",");
          window.location.href = CHECKOUT + (items ? ("?items=" + encodeURIComponent(items)) : "");
        })["catch"](function(){ window.location.href = CHECKOUT; });
      }catch(_){ try{ window.location.href = CHECKOUT; }catch(__){} }
    }
    // Delegação em CAPTURA (3º arg true): roda ANTES dos handlers do tema, que
    // podem submeter/navegar ou dar stopPropagation antes do evento chegar no
    // document em fase de bolha. Sem captura, temas custom "escapam" pro nativo.
    document.addEventListener("click", function(e){
      try{
        var t = e.target && e.target.closest ? e.target.closest(SEL) : null;
        if(t) go(e);
      }catch(_){}
    }, true);

    // Backup: intercepta o SUBMIT do formulário quando quem disparou é o botão
    // "checkout" (ou o form aponta pra /checkout). Cobre finalização via submit e
    // via teclado (Enter). NÃO pega "atualizar carrinho" (submitter name="update").
    document.addEventListener("submit", function(e){
      try{
        var f = e.target; if(!f || f.tagName !== "FORM") return;
        var sub = e.submitter;
        var action = f.getAttribute("action") || "";
        if((sub && sub.name === "checkout") || /\\/checkout(\\?|$)/.test(action)) go(e);
      }catch(_){}
    }, true);

    // Ao voltar (bfcache), a página é restaurada com o estado antigo (going=true).
    // Sem resetar, o 2º clique escaparia para o checkout nativo da Shopify.
    window.addEventListener("pageshow", function(){ going = false; });
  }catch(_){}
})();`;

  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // pode cachear um pouco; o destino muda raramente.
      "Cache-Control": "public, max-age=300",
    },
  });
}
