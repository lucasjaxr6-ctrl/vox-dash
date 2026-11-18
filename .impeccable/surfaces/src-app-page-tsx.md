---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/landing"]
---

# Landing do VOX (/)

> **Substituída em 20/10/2026.** O dono trocou a landing por um design próprio (`VOX-landing-page.html`): faixas escuras e claras, Manrope, bento e celular com checkout, que agora é escolha DELE (vale sobre o "SEM celular" abaixo). O "Direction contract" e as seções 3/4/6 abaixo descrevem a versão anterior. Decisões do dono no mesmo dia: sem rótulos em maiúsculas acima dos títulos, sem 01/02/03 decorativo, números só na seção "Volume real"; **paleta verde de volta** e depois **só modo claro** (branco e papel, sem faixa preta; verde VOX só em ação, verde-claro só em status e nos pulsos, sem violeta). Hero em duas colunas: texto à esquerda, painel à direita saindo pela borda, inclinado em 3D e endireitando com a rolagem. Textos das ilustrações dos cartões em tamanho de leitura (o dono reclamou de 6–8px). Movimento num motivo só: o pulso verde é uma venda andando. Overdrive "Produto vivo": o hero mostra a **dashboard real** (componentes do painel com dados de demonstração, pedidos chegando enquanto está na tela — `PainelDemo.tsx`), e a seção de compra mostra **capturas do checkout real** (Charm, loja fictícia Noma Studio) que avançam com a rolagem (`CheckoutCelular.tsx`). Continuam valendo: Mode Persuade, ação "Criar conta" (/login?cadastro=1), números só de `conteudo.ts`, troca de gateway sempre MANUAL, demonstrações rotuladas, pt-BR, reduced-motion e conteúdo visível sem JS.

Scope: landing pública na raiz (vox.black/). Mode: Persuade. Logado ou não, a raiz mostra a landing; "Entrar" leva direto ao painel de quem já tem sessão.

Audience: lojista brasileiro de Shopify (dropshipping e marca própria) que vende com tráfego pago, avaliando a plataforma com calma, de dia, no notebook. Job: decidir confiar o checkout dele ao VOX. Action: "Criar conta grátis" (/login?cadastro=1). Proof: diagrama de rotas com logos reais dos gateways e a troca de gateway demonstrada (rotulada); tabela real de gateways × Pix/cartão; números REAIS em conteudo.ts; segurança real (AES-256-GCM, preço no servidor). Sem planos/preços e SEM celular/mockup de checkout (há vários modelos; decisão do dono, 02/10/2026). Constraints: pt-BR, nada inventado, reduced-motion, conteúdo visível sem JS.

Redesign (02/10/2026): substitui "Chuva de notificações" — dono pediu algo mais institucional, profissional e sério, mantendo os títulos fortes (Bricolage pesado).

## Direction contract

THESIS: O VOX como infraestrutura: a página é a sala de controle que mantém o checkout de cada loja no ar — rotas de pagamento com gateway ativo e reserva. Recusa o hero com mockup de celular/painel e a grade de cards de recursos.

OWN-WORLD: Papel claro (#F3F5F4) com grade técnica fina; superfícies brancas com filete #D8DFDC; grafite (#0E1714) nos títulos Bricolage 800 apertados; Inter no corpo; verde VOX (#1F846E) é a única cor de ação e de status "ativo"; menta (#73E8CE) só como luz dos pulsos; laranja queimado (#C2410C) só para "bloqueado". Os círculos em eco da logo estruturam o diagrama. Fechamento em grafite cheio.

STORY: Entende que é um checkout próprio para Shopify com Pix, cartão e 13 gateways; acredita ao ver o lojista trocar o gateway no painel quando um bloqueia (troca manual, nunca failover automático), a ficha técnica real da rede e o caminho do pedido com as garantias de segurança; cria a conta grátis.

SEÇÕES 3/4/6 (04/10/2026, "Documentação técnica viva", sem cards): linha de ativação com as 4 etapas reais do Início e os status com o nome do painel; ficha técnica da rede (filtro Pix/cartão, tipo de captura do cartão por gateway, legenda que destaca); diagrama de sequência Comprador → Servidor VOX → Gateway com cada garantia acendendo no passo onde acontece. Seção institucional da empresa (CNPJ, contato, termos) adiada até o dono abrir o CNPJ novo.

FIRST VIEWPORT: Nav clara com filete (logo, âncoras, Entrar, CTA verde). Esquerda: título Bricolage ~5rem em 3 linhas, frase de apoio, CTA verde + link "Ver como funciona". Direita: diagrama vivo em SVG — Shopify → "Seu checkout" (anéis da logo) → ramos Pix e Cartão, cada um com gateway ativo e reserva (logos reais); pulsos percorrem as rotas; o bloqueio é simulado e o lojista troca o Pix para o gateway configurado. Assinatura: essa troca.

FORM: Central de operações — THE ROLL (5º da lista ordenada por ressonância), seed key 4dc13d36. Code-led. Raises: anéis da logo como estrutura radial (de Anéis de areia); números reais em numerais enormes dentro de uma frase (de Liga de corrida); rotas que se refazem com a troca feita pelo lojista no painel (de Jardim de gravidade).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
