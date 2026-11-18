import type { CSSProperties } from "react";
import { Inter, Manrope } from "next/font/google";
import "./landing.css";
import NavLanding from "./NavLanding";
import Simulador from "./Simulador";
import Perguntas from "./Perguntas";
import Revelar from "./Revelar";
import Icone from "./Icone";
import PainelDemo from "./PainelDemo";
import CheckoutCelular from "./CheckoutCelular";
import { CADASTRO_HREF, CONTATO_HREF, NUMEROS } from "./conteudo";

// Fontes da versão do dono, servidas pelo próprio app (next/font).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

/** Índice de uma peça numa sequência animada (atraso, ordem do pulso). */
const n = (i: number) => ({ "--n": i }) as CSSProperties;

// Rotas do Smart Routing no desenho do recurso (viewBox 500 x 300). O
// roteador termina em x=170 e os gateways começam em x=300, nas alturas 20%,
// 50% e 80% — as mesmas porcentagens do CSS que posiciona os cartões.
const ROTAS = [
  { g: "A", pct: "54%", d: "M170 150 C 236 150, 234 60, 300 60", pulsos: [0, 0.75, 1.5] },
  { g: "B", pct: "31%", d: "M170 150 L 300 150", pulsos: [0.35, 1.45] },
  { g: "C", pct: "15%", d: "M170 150 C 236 150, 234 240, 300 240", pulsos: [1.05] },
];

/**
 * Landing pública da VOX (raiz do site), a partir do VOX-landing-page.html
 * que o dono montou (20/10/2026).
 *
 * Modo claro, na paleta do painel (pedido do dono): papel e branco, grafite
 * nos títulos, verde VOX (#1F846E) só para ação e o verde-claro da marca só
 * para status. O painel de demonstração usa o tema claro do próprio painel.
 *
 * O produto aparece como ele é: o hero mostra o painel montado com os
 * componentes reais da dashboard (PainelDemo), e a seção de compra mostra
 * capturas do checkout nativo (CheckoutCelular). Os dois são rotulados como
 * demonstração.
 *
 * Movimento, num motivo só — o pulso verde é uma venda andando: pedidos
 * chegando no painel do hero, pulsos indo da VOX aos gateways na proporção do
 * Smart Routing, e o caminho do dinheiro aceso etapa por etapa. Tudo some com
 * movimento reduzido.
 *
 *   1. Hero: texto à esquerda, painel ao vivo à direita
 *   2. Produto: grade de recursos
 *   3. Smart Routing: simulador (troca MANUAL de gateway)
 *   4. Experiência de compra: o checkout real num celular
 *   5. Integrações
 *   6. Infraestrutura: o caminho do dinheiro
 *   7. Números
 *   8. Perguntas frequentes
 *   9. Fechamento e rodapé
 */
export default function Landing({ entrarHref, entrarRotulo }: { entrarHref: string; entrarRotulo: string }) {
  return (
    <div className={`landing ${inter.variable} ${manrope.variable}`}>
      {/* Tema claro do painel ANTES da pintura: o painel de demonstração usa os
          tokens e as variantes dark: do Tailwind, que dependem do <html>. Os
          links daqui são <a> comuns (carga completa), então o atributo nunca
          vaza para o painel — lá, o layout aplica o tema salvo do lojista. */}
      <script dangerouslySetInnerHTML={{ __html: `document.documentElement.setAttribute('data-theme','light')` }} />
      <div className="noise" aria-hidden />
      <Revelar />
      <NavLanding entrarHref={entrarHref} entrarRotulo={entrarRotulo} cadastroHref={CADASTRO_HREF} />

      <main>
        {/* ── 1. Hero ── */}
        <section className="hero section-white">
          <div className="shell hero-grid">
            <div className="hero-copy reveal">
              <h1>
                Seu checkout não deveria parar porque <span>um gateway parou.</span>
              </h1>
              <p className="hero-lead">
                Checkout transparente para Shopify, no seu domínio, com múltiplos gateways, Smart Routing e automações para manter sua
                operação vendendo.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href={CADASTRO_HREF}>
                  Começar com a VOX <Icone nome="setaDiagonal" tamanho={16} traco={2} />
                </a>
                <a className="button button-ghost" href="#routing">
                  Ver como funciona <Icone nome="setaBaixo" tamanho={16} traco={2} />
                </a>
              </div>
            </div>
            <div className="hero-produto reveal delay-1">
              <PainelDemo agora={Date.now()} />
            </div>
          </div>
        </section>

        {/* ── 2. Produto ── */}
        <section className="section-paper intro" id="produto">
          <div className="shell">
            <div className="section-heading centered reveal">
              <h2>O checkout vira parte da sua infraestrutura, não um gargalo.</h2>
              <p>
                A VOX conecta sua Shopify à camada de pagamento, recuperação e mensuração sem tirar da sua operação o controle sobre a marca ou
                os gateways.
              </p>
            </div>
            <div className="bento-grid">
              <article className="bento bento-large reveal">
                <div className="bento-copy">
                  <span className="feature-icon verde">
                    <Icone nome="rota" />
                  </span>
                  <h3>Smart Routing</h3>
                  <p>Distribua pagamentos entre gateways e altere sua estratégia de roteamento sem reconstruir o checkout.</p>
                </div>
                <div className="routing-visual" aria-hidden>
                  <svg viewBox="0 0 500 300">
                    {ROTAS.map((r) => (
                      <path key={r.g} className="rota" d={r.d} />
                    ))}
                    {/* Uma venda é um pulso; cada rota recebe pulsos na proporção da divisão. */}
                    {ROTAS.flatMap((r) =>
                      r.pulsos.map((b) => (
                        <g key={`${r.g}-${b}`} className="pulso">
                          <circle r="9" className="pulso-halo">
                            <animateMotion dur="2.2s" begin={`${b}s`} repeatCount="indefinite" path={r.d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1" />
                          </circle>
                          <circle r="4" className="pulso-nucleo">
                            <animateMotion dur="2.2s" begin={`${b}s`} repeatCount="indefinite" path={r.d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.25 1" />
                          </circle>
                        </g>
                      )),
                    )}
                  </svg>
                  <div className="route-source">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/vox-logo.png" alt="" width={37} height={18} />
                    <span>
                      VOX
                      <small>Payment Router</small>
                    </span>
                  </div>
                  {ROTAS.map((r, i) => (
                    <div key={r.g} className={`gate-node gate-${i + 1}`}>
                      <i>{r.g}</i>
                      <div>
                        <strong>Gateway {r.g}</strong>
                        <small>{r.pct} das vendas</small>
                      </div>
                      <span className="online" />
                    </div>
                  ))}
                </div>
              </article>

              <article className="bento reveal delay-1">
                <div className="bento-copy">
                  <span className="feature-icon">
                    <Icone nome="globo" />
                  </span>
                  <h3>Domínio próprio</h3>
                  <p>O cliente permanece dentro da experiência da sua marca até concluir o pagamento.</p>
                </div>
                <div className="browser-pill" aria-hidden>
                  <Icone nome="cadeado" tamanho={15} /> checkout.sualoja.com.br
                </div>
              </article>

              <article className="bento reveal delay-2">
                <div className="bento-copy">
                  <span className="feature-icon">
                    <Icone nome="carta" />
                  </span>
                  <h3>Recuperação automática</h3>
                  <p>Fluxos para carrinho e Pix ajudam a trazer de volta pedidos que ficaram pelo caminho.</p>
                </div>
                <div className="recovery-stack" aria-hidden>
                  {[
                    ["Checkout iniciado", "Cliente saiu antes de pagar", false],
                    ["Recuperação enviada", "Link direto para retomar", true],
                    ["Pagamento confirmado", "Pedido reconciliado", true],
                  ].map(([t, s, ok], i) => (
                    <div key={t as string} className={`message-card${i === 2 ? " success" : ""}`} style={n(i)}>
                      <i>{String(i + 1).padStart(2, "0")}</i>
                      <p>
                        <strong>{t}</strong>
                        <small>{s}</small>
                      </p>
                      {ok && (
                        <span>
                          <Icone nome="check" tamanho={16} traco={2.2} />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </article>

              <article className="bento bento-wide reveal">
                <div className="bento-copy">
                  <span className="feature-icon">
                    <Icone nome="pulso" />
                  </span>
                  <h3>Operação em tempo real</h3>
                  <p>Veja o funil da loja ao pagamento enquanto ele acontece.</p>
                </div>
                <div className="funnel-live" aria-hidden>
                  {[
                    ["134", "Na loja", 100],
                    ["76", "No checkout", 57],
                    ["41", "No pagamento", 31],
                    ["29", "Aprovados", 22],
                  ].map(([num, r, w], i) => (
                    <div key={r as string} className="funnel-passo" style={n(i)}>
                      {i > 0 && (
                        <em>
                          <Icone nome="setaDireita" tamanho={16} />
                        </em>
                      )}
                      <div className={i === 3 ? "final" : undefined}>
                        <span>{num}</span>
                        <small>{r}</small>
                        <i style={{ width: `${w}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="bento bento-strip reveal delay-1">
                <div className="bento-copy">
                  <span className="feature-icon">
                    <Icone nome="sincronizar" />
                  </span>
                  <h3>Conciliação</h3>
                  <p>A cada 5 minutos, os pedidos pendentes são conferidos na API do gateway. Webhook perdido não vira venda perdida.</p>
                </div>
                <ol className="rodadas" aria-hidden>
                  <li style={n(0)}>
                    <time>14:30</time>
                    <span>4 pendentes conferidos</span>
                    <b>1 pago</b>
                  </li>
                  <li style={n(1)}>
                    <time>14:35</time>
                    <span>3 pendentes conferidos</span>
                    <b className="nada">nenhum</b>
                  </li>
                  <li className="agora" style={n(2)}>
                    <time>14:40</time>
                    <span>5 pendentes conferidos</span>
                    <b>2 pagos</b>
                  </li>
                </ol>
              </article>
            </div>
          </div>
        </section>

        {/* ── 3. Smart Routing ── */}
        <section className="routing-demo section-white" id="routing">
          <div className="shell routing-grid">
            <div className="routing-copy reveal">
              <h2>
                <span className="frase">Troque a rota.</span> <span className="frase">Não o checkout.</span>
              </h2>
              <p>
                Um bloqueio no gateway não precisa virar operação parada. Deixe outros gateways configurados para Pix e cartão e troque a rota
                no painel, sem mexer no checkout.
              </p>
              <ul className="check-list">
                {[
                  "Gateways diferentes para Pix e cartão",
                  "Distribuição percentual entre provedores",
                  "Alteração centralizada pelo painel",
                  "Mesmo checkout, mesma experiência de compra",
                ].map((t) => (
                  <li key={t}>
                    <span>
                      <Icone nome="check" tamanho={12} traco={2.6} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <Simulador />
          </div>
        </section>

        {/* ── 4. Experiência de compra ── */}
        <section className="checkout-section section-paper">
          <div className="shell checkout-grid">
            <div className="checkout-phone reveal">
              <CheckoutCelular />
            </div>
            <div className="section-heading left reveal delay-1">
              <h2>
                <span className="frase">A tecnologia aparece para você.</span> <span className="frase">Para o cliente, aparece a sua marca.</span>
              </h2>
              <p>Uma experiência de pagamento limpa, rápida e coerente com a loja. Sua identidade acompanha o cliente até o último clique.</p>
              <dl className="feature-lines">
                <div>
                  <dt>Marca e domínio próprios</dt>
                  <dd>Mais continuidade entre loja e pagamento.</dd>
                </div>
                <div>
                  <dt>Pix e cartão</dt>
                  <dd>Meios de pagamento dentro da mesma experiência.</dd>
                </div>
                <div>
                  <dt>Order bump</dt>
                  <dd>Oferta complementar sem tirar o cliente do fluxo.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* ── 5. Integrações ── */}
        <section className="integrations section-white" id="integracoes">
          <div className="shell">
            <div className="section-heading centered reveal">
              <h2>A VOX entra na operação que você já usa.</h2>
              <p>Checkout, pagamentos, mídia e tracking trabalhando como uma única camada operacional.</p>
            </div>
            <div className="integration-stage reveal">
              <div className="integration-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/vox-logo.png" alt="" width={61} height={30} />
                <strong>VOX</strong>
              </div>
              <div className="orbit orbit-1" aria-hidden />
              <div className="orbit orbit-2" aria-hidden />
              <div className="integration-chip chip-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/apps/shopify.webp" alt="" width={30} height={30} />
                Shopify
              </div>
              <div className="integration-chip chip-2">
                <span aria-hidden>M</span>
                Meta
              </div>
              <div className="integration-chip chip-3">
                <span aria-hidden>G</span>
                Google
              </div>
              <div className="integration-chip chip-4">
                <span aria-hidden>T</span>
                TikTok
              </div>
              <div className="integration-chip chip-5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/apps/utmify.png" alt="" width={30} height={30} />
                Utmify
              </div>
              <div className="integration-chip chip-6">
                <span className="conta" aria-hidden>
                  {NUMEROS.gateways}
                </span>
                Gateways
              </div>
            </div>
          </div>
        </section>

        {/* ── 6. Infraestrutura ── */}
        <section className="architecture section-paper" id="seguranca">
          <div className="shell">
            <div className="section-heading centered reveal">
              <h2>Seu dinheiro não precisa passar pela VOX.</h2>
              <p>
                A VOX conecta o checkout ao gateway configurado pela sua operação. O pagamento segue a lógica do provedor escolhido, e a
                plataforma cuida da experiência e da orquestração.
              </p>
            </div>
            {/* Aqui a ordem 1→4 é o próprio caminho do dinheiro, por isso os
                números ficam. Um pulso percorre o caminho e acende cada etapa. */}
            <ol className="flow-map reveal">
              <li className="flow-box" style={n(0)}>
                <span>01</span>
                <i className="flow-icon">
                  <Icone nome="pessoa" />
                </i>
                <strong>Cliente</strong>
                <small>inicia o pagamento</small>
              </li>
              <li className="flow-arrow" aria-hidden style={n(0)}>
                <i />
                <b>checkout</b>
              </li>
              <li className="flow-box highlight" style={n(1)}>
                <span>02</span>
                <i className="flow-icon">VX</i>
                <strong>VOX</strong>
                <small>orquestra a transação</small>
              </li>
              <li className="flow-arrow" aria-hidden style={n(1)}>
                <i />
                <b>rota</b>
              </li>
              <li className="flow-box" style={n(2)}>
                <span>03</span>
                <i className="flow-icon">
                  <Icone nome="cartao" />
                </i>
                <strong>Seu gateway</strong>
                <small>processa o pagamento</small>
              </li>
              <li className="flow-arrow" aria-hidden style={n(2)}>
                <i />
                <b>liquidação</b>
              </li>
              <li className="flow-box" style={n(3)}>
                <span>04</span>
                <i className="flow-icon">R$</i>
                <strong>Sua conta</strong>
                <small>recebe pelo provedor</small>
              </li>
            </ol>
            <div className="security-grid reveal">
              <div>
                <span>
                  <Icone nome="rota" tamanho={20} />
                </span>
                <h3>Operação independente</h3>
                <p>Troque ou distribua gateways sem perder sua camada de checkout.</p>
              </div>
              <div>
                <span>
                  <Icone nome="painel" tamanho={20} />
                </span>
                <h3>Dados centralizados</h3>
                <p>Acompanhe checkout, pedidos e status em um único ambiente.</p>
              </div>
              <div>
                <span>
                  <Icone nome="relogio" tamanho={20} />
                </span>
                <h3>Rotinas automáticas</h3>
                <p>Recuperação e conciliação trabalham mesmo quando ninguém está olhando.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 7. Números ── */}
        <section className="numbers section-white">
          <div className="shell">
            <h2 className="numbers-head reveal">Construída para operações que não podem improvisar.</h2>
            <div className="number-cards reveal">
              <div>
                <strong>
                  {NUMEROS.processado}
                  <span>+</span>
                </strong>
                <p>em pagamentos processados</p>
              </div>
              <div>
                <strong>
                  {NUMEROS.pedidos}
                  <span>+</span>
                </strong>
                <p>pedidos pagos</p>
              </div>
              <div>
                <strong>{NUMEROS.gateways}</strong>
                <p>gateways integrados</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 8. Perguntas ── */}
        <section className="faq section-paper" id="faq">
          <div className="shell faq-grid">
            <div className="section-heading left reveal">
              <h2>O essencial, sem enrolação.</h2>
              <p>As dúvidas que normalmente aparecem antes de colocar a VOX em produção.</p>
            </div>
            <Perguntas />
          </div>
        </section>

        {/* ── 9. Fechamento ── */}
        <section className="cta-section" id="cta">
          {/* Os anéis em eco da logo, em escala de parede. */}
          <svg className="cta-aneis" viewBox="0 0 980 720" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <circle key={i} cx={310 + i * 120} cy={360} r={300} />
            ))}
          </svg>
          <div className="shell cta-inner reveal">
            <h2>
              Mais controle sobre pagamentos.
              <br />
              Menos dependência na operação.
            </h2>
            <p>Conecte sua Shopify à VOX e transforme o checkout em infraestrutura de verdade.</p>
            <div className="cta-actions">
              <a href={CADASTRO_HREF} className="button button-primary">
                Criar minha conta <Icone nome="setaDiagonal" tamanho={16} traco={2} />
              </a>
              {CONTATO_HREF && (
                <a href={CONTATO_HREF} className="button button-ghost">
                  Falar com o time
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="shell footer-grid">
          <div>
            <a className="brand footer-brand" href="#top" aria-label="VOX, voltar ao topo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vox-logo.png" alt="" width={49} height={24} />
              <span>VOX</span>
            </a>
            <p>Infraestrutura de checkout para operações Shopify.</p>
          </div>
          <nav aria-label="Produto">
            <strong>Produto</strong>
            <a href="#produto">Recursos</a>
            <a href="#routing">Smart Routing</a>
            <a href="#integracoes">Integrações</a>
          </nav>
          <nav aria-label="Plataforma">
            <strong>Plataforma</strong>
            <a href="#seguranca">Infraestrutura</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav aria-label="Conta">
            <strong>Conta</strong>
            <a href={entrarHref}>{entrarRotulo}</a>
            <a href={CADASTRO_HREF}>Criar conta</a>
          </nav>
        </div>
        <div className="shell footer-bottom">
          <span>© {new Date().getFullYear()} VOX. Todos os direitos reservados.</span>
          <span>Checkout without lock-in.</span>
        </div>
      </footer>
    </div>
  );
}
