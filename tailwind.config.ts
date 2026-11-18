import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    // `src/lib` também carrega classe: as cores dos gateways (gateways.ts), os
    // badges de status (order-status.ts) e os estilos dos e-mails (email-ui.ts)
    // são DADOS, não JSX. Fora desta lista o Tailwind não as via e as apagava
    // da build — o círculo do gateway ficava sem fundo e, no tema claro, a
    // letra branca sumia no card branco.
    "./src/lib/**/*.{js,ts}",
  ],
  // Tema do painel via atributo no <html>. O padrão (sem atributo) é dark.
  darkMode: ["selector", 'html:not([data-theme="light"])'],
  theme: {
    extend: {
      colors: {
        // Laranja do botão do checkout (Barata Safira) — identidade VoxCheckout.
        // `bright` é a variação usada sobre fundo escuro no painel.
        // Verde do painel, derivado da MATIZ da logo (~167°) e escurecido até
        // passar no contraste: `bg-brand text-white` é usado em botão e pílula,
        // e a menta da logo (#73E8CE) dá 1,48:1 com branco — ilegível.
        // #1F846E dá 4,58:1 (mínimo da WCAG AA é 4,5). O laranja anterior
        // estava em 3,3:1, ou seja, isto também corrige um problema de leitura.
        brand: {
          DEFAULT: "#1F846E",
          hover: "#186D5A",
          bright: "#22BF9D", // só sobre fundo escuro (pontos e brilhos)
        },
        success: "#16A34A",

        // ── Tokens semânticos do painel (definidos em globals.css) ──
        // Trocam sozinhos entre dark e light: a tela nunca sabe qual está ativo.
        app: "var(--c-app)",       // fundo da aplicação
        card: "var(--c-card)",     // superfície de card
        soft: "var(--c-soft)",     // superfície sutil (inputs, faixas)
        raised: "var(--c-raised)", // popovers / menus
        line: {
          DEFAULT: "var(--c-line)",
          strong: "var(--c-line-strong)",
        },
        hover: "var(--c-hover)",
        hi: "var(--c-text-hi)",    // texto principal
        mid: "var(--c-text-mid)",  // texto secundário
        low: "var(--c-text-low)",  // texto de apoio
        dim: "var(--c-text-dim)",  // rótulos / placeholders
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Arial", "sans-serif"],
      },
      boxShadow: {
        // Profundidade sutil; os valores mudam por tema (globals.css).
        panel: "var(--s-panel)",
        "panel-hover": "var(--s-panel-hover)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up .35s cubic-bezier(.22,.61,.36,1) both",
      },
      transitionTimingFunction: {
        // Saída forte: quase todo o movimento no começo, assentando devagar.
        // É a mesma curva que o AnimatedNumber usa em JS, para número e barra
        // chegarem juntos.
        fluid: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
