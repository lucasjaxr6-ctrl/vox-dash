// Endereço canônico da plataforma.
//
// ⚠️ O `www` NÃO é enfeite. Na Vercel o apex redireciona para o www com 308, e
// quem envia webhook não segue redirect em POST — o Resend chamava
// https://vox.black/api/webhooks/resend-inbound, levava 308 e a chamada morria
// ali, sem nunca chegar ao handler. Sintoma: e-mail visível no Resend e caixa
// de entrada vazia. Medido:
//
//   POST https://vox.black/api/webhooks/resend-inbound      -> 308 (Location: www)
//   POST https://www.vox.black/api/webhooks/resend-inbound  -> 200 {"ok":true}
//
// O painel do lojista nunca caiu nessa armadilha porque monta a URL com
// window.location.origin, que já vem com o www. Só o texto do admin era escrito
// à mão. Se um dia o domínio mudar, confira o redirect ANTES de trocar aqui.
//
// O domínio antigo (www.voxcheckout.cloud) continua servindo o mesmo app e
// nenhuma rota depende do host, então webhook já cadastrado nele segue valendo.
export const DOMINIO_PLATAFORMA = "www.vox.black";
export const URL_PLATAFORMA = `https://${DOMINIO_PLATAFORMA}`;

/** URL de um webhook NOSSO, para entregar a terceiro. Sempre com o www. */
export const urlWebhook = (nome: string) => `${URL_PLATAFORMA}/api/webhooks/${nome}`;

export const WEBHOOK_INBOUND = urlWebhook("resend-inbound");
// O Pix das taxas e dos planos (Cakto) usa urlWebhook("cakto-plataforma"),
// cadastrado sozinho pela API: ver lib/cakto-plataforma.ts.
