# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Lojista (MERCHANT, `/painel`)**: cliente pagante do VOX. Terceiros que se cadastram, conectam a loja Shopify, configuram gateways, pixels, cupons, order bumps e provas sociais, e acompanham vendas. É quem escolhe e paga pela plataforma.
- **Comprador final (`/checkout`, `/pix/[orderId]`, `/obrigado/[orderId]`, `/rastreio`)**: cliente da loja do lojista. Perfil principal: produto físico de dropshipping, vindo de anúncio (Meta/TikTok), majoritariamente no celular, decidindo por impulso e desconfiado de um checkout desconhecido. Perfil secundário: cliente de loja de marca própria, mais recorrente e menos impulsivo.
- **Operador da plataforma (ADMIN, `/admin`)**: o dono do VOX. Gerencia lojas, usuários, transações, taxas da plataforma, e-mails e relatórios.

## Product Purpose

O VOX é um checkout SaaS multi-loja para lojistas brasileiros que vendem com Shopify. Ele substitui o checkout nativo por um checkout próprio com Pix e cartão, via gateways plugáveis, e com ferramentas de conversão. O sucesso é medido pela taxa de aprovação/conversão das vendas dos lojistas, que gera receita de taxa por venda para a plataforma.

## Positioning

- **Conversão**: o checkout foi feito para fechar a venda de tráfego pago (order bump, provas sociais, recuperação de carrinho, cupons, pixels e Utmify, Pix com QR e status ao vivo, página de obrigado e rastreio).
- **Controle total**: plataforma própria. O lojista não depende das regras nem das decisões de um checkout terceiro (Yampi, CartPanda, Shopify). A troca de gateway é uma configuração, não uma migração.

## Operating Context

- Tráfego do comprador vem de anúncios pagos; a sessão de checkout é curta, mobile-first e sensível a atrito e a sinais de confiança.
- Contas de gateway caem, são bloqueadas ou mudam de regra com frequência; o lojista troca de gateway (Pix e cartão separados) pelo painel (`/painel/pagamentos`).
- O lojista personaliza o visual do checkout (`/painel/personalizar`, API `checkout-theme`), então o checkout carrega a marca do lojista, não a do VOX. A identidade do VOX aparece no painel, no admin e no login.
- Pós-venda: e-mails transacionais, página de obrigado, rastreio 17track, caixa de entrada de e-mails no painel.
- Tudo em português do Brasil, com valores em BRL, CPF, CEP (consulta automática) e Pix.

## Capabilities and Constraints

- Stack existente: Next.js 15 (App Router), React 19, TypeScript, Tailwind 3, MySQL via `mysql2` sem ORM, deploy na Vercel.
- Gateways: Appmax, Beehive, FintPag, Freepay, HylexPay, Hypercash, InfinitePay (checkout hospedado), Mercado Pago, PagNiv, Pagou, PinPay, PixGo, PushinPay, Transfyre, Vext. Alguns são só Pix e outros exigem SDK de tokenização de cartão no front.
- Segurança é um requisito do produto: identidade vem só da sessão, preço é recalculado no servidor, credenciais ficam criptografadas (ver `SECURITY.md`). Mudanças de UI não podem mover confiança para o cliente.
- Papéis: ADMIN, MERCHANT, USER.

## Brand Commitments

- Nome: **VOX**. Logo em `public/vox-logo.png`.
- No checkout, a marca que manda é a do lojista (tema configurável). O VOX não deve se impor ao comprador final.

## Evidence on Hand

- Logos oficiais de gateways (`public/gateways/`), bandeiras de cartão e Pix (`public/payment/`), transportadoras (`public/shipping/`), ícones de e-mail (`public/email/`).
- Provas sociais e avaliações são cadastradas pelo lojista (`/painel/provas-sociais`); não existem depoimentos, números de clientes ou benchmarks do próprio VOX. Não inventar nenhum.

## Product Principles

1. **O comprador não pode hesitar.** Cada campo, passo ou dúvida no checkout custa venda de tráfego pago; confiança e rapidez vêm antes de ornamento.
2. **A loja é do lojista.** O checkout veste a marca dele; o VOX é infraestrutura invisível para o comprador.
3. **Nenhum ponto único de falha.** Gateway, domínio e integrações são trocáveis sem reconstruir nada.
4. **O servidor é a fonte da verdade.** Preço, identidade e status de pagamento nunca vêm do front.
5. **O lojista opera rápido.** O painel serve para configurar e acompanhar vendas com o mínimo de cliques, não para impressionar.
