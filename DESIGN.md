---
name: VOX
description: Checkout próprio para Shopify. Public/marketing surface system ("Central de operações").
colors:
  vox-green: "#1f846e"
  vox-green-hover: "#186d5a"
  pulse-mint: "#73e8ce"
  logo-bright: "#22bf9d"
  alert: "#c2410c"
  alert-wash: "#fdeee6"
  alert-edge: "#f2b79b"
  paper: "#f3f5f4"
  surface: "#ffffff"
  ink: "#0e1714"
  mute: "#56635f"
  dim: "#7b8884"
  line: "#d8dfdc"
  line-strong: "#b9c4c0"
  grid: "rgba(14, 23, 20, 0.055)"
  night: "#0e1714"
  night-mute: "#a9bdb7"
typography:
  display:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 6.4vw, 5.1rem)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 4.8vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline-closing:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(2.4rem, 6vw, 4.75rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.04em"
  statement:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "clamp(1.65rem, 3.4vw, 2.85rem)"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.03em"
  figure:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "1.45em"
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: "-0.04em"
    fontFeature: "\"tnum\""
  title:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    letterSpacing: "-0.03em"
  title-sm:
    fontFamily: "Bricolage Grotesque, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.625
    fontFeature: "\"ss01\", \"cv11\""
  body-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.625
  body-xs:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 400
    lineHeight: 1.625
  item:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
  item-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14.5px"
    fontWeight: 600
    lineHeight: 1.375
  control:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 600
  note:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  label-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
  numeral:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    fontFeature: "\"tnum\""
  numeral-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "10.5px"
    fontWeight: 700
    fontFeature: "\"tnum\""
rounded:
  logo-chip: "8px"
  chip: "8px"
  control: "10px"
  node: "12px"
  panel: "14px"
  stage: "18px"
  pill: "999px"
spacing:
  gutter-mobile: "16px"
  gutter-tablet: "24px"
  gutter-desktop: "32px"
  container: "1240px"
  grid-cell: "48px"
  section: "96px"
  section-lg: "112px"
  closing: "112px"
  closing-lg: "144px"
components:
  button-primary:
    backgroundColor: "{colors.vox-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "14.4px 21.6px"
  button-primary-hover:
    backgroundColor: "{colors.vox-green-hover}"
    textColor: "{colors.surface}"
  button-primary-sm:
    backgroundColor: "{colors.vox-green}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8.8px 15.2px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9.6px 15.2px"
  button-text:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  segmented-control:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "4px"
  segment:
    textColor: "{colors.mute}"
    typography: "{typography.control}"
    rounded: "{rounded.chip}"
    padding: "6px 14px"
  segment-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.chip}"
    padding: "6px 14px"
  status-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.chip}"
    padding: "4px 10px"
  status-chip-pending:
    textColor: "{colors.mute}"
    typography: "{typography.caption}"
    rounded: "{rounded.chip}"
    padding: "4px 10px"
  station-dot:
    backgroundColor: "{colors.vox-green}"
    textColor: "{colors.surface}"
    typography: "{typography.numeral}"
    rounded: "{rounded.pill}"
    size: "28px"
  station-dot-pending:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.mute}"
    typography: "{typography.numeral}"
    rounded: "{rounded.pill}"
    size: "28px"
  step-badge:
    backgroundColor: "{colors.vox-green}"
    textColor: "{colors.surface}"
    typography: "{typography.numeral-sm}"
    rounded: "{rounded.pill}"
    size: "20px"
  step-badge-pending:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.mute}"
    typography: "{typography.numeral-sm}"
    rounded: "{rounded.pill}"
    size: "20px"
  route-node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.node}"
  route-node-blocked:
    backgroundColor: "{colors.alert-wash}"
    textColor: "{colors.alert}"
    rounded: "{rounded.node}"
  route-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "22px"
  diagram-stage:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.stage}"
    padding: "24px"
  sequence-stage:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.stage}"
    padding: "20px 24px 24px"
  lane-chip:
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  gateway-sheet:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  gateway-sheet-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.mute}"
    typography: "{typography.label-sm}"
    padding: "10px 16px"
  gateway-sheet-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    padding: "12px 16px"
  logo-chip:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.logo-chip}"
    size: "28px"
  nav:
    backgroundColor: "rgba(243, 245, 244, 0.86)"
    textColor: "{colors.mute}"
    height: "64px"
  closing-band:
    backgroundColor: "{colors.night}"
    textColor: "{colors.surface}"
---

# Design System: VOX

Scope: this file records the **public/marketing surface system** shipped at the site root (`src/app/page.tsx` → `src/components/landing/`, tokens scoped under `.landing` as `--l-*` in `landing.css`). It does not define the logged-in panel (`/painel`), admin (`/admin`) or login, which keep their incumbent, code-defined system (light/dark `--c-*` tokens in `src/app/globals.css`; brand green `#1F846E` and bright `#22BF9D` in `tailwind.config.ts`; Inter). This system shares the brand with that one: the logo (`public/vox-logo.png`), VOX green and Inter. The buyer-facing checkout wears each merchant's own theme and is out of scope.

> **Superseded on 2026-10-20 (layout and components).** The owner replaced the landing with a design of their own (`VOX-landing-page.html`), shipped in `src/components/landing/` (`landing.css`, scoped under `.landing`, `--l-*` tokens): alternating dark and light bands, Manrope headlines over Inter, bento cards, no uppercase kickers, no 01/02/03 labels. The same day the owner asked to bring back the **green palette** (no violet) and then for **light mode only** (no black bands): white and paper `#F3F5F4` alternate, graphite `#0E1714` headlines, VOX green `#1F846E` is the only action color, logo bright `#22BF9D` marks status and lights the pulses, the closing band is a mint wash with the logo's echo rings. Hero: copy left, the **real dashboard components** right (`PainelDemo.tsx`, panel light theme, demo orders arriving while in view), wider than its column and bleeding off the right edge, tilted in 3D and straightening with scroll. Motion has one motif — a green pulse is a sale moving: orders in the hero, pulses from VOX to gateways in the Smart Routing card, a pulse lighting the money path step by step; card contents enter in sequence; all of it stops under reduced motion. The checkout section shows **captures of the real Charm checkout** themed as a fictional store (`CheckoutCelular.tsx`, images in `public/landing/`). Everything below about layout, cards and components describes the **previous** "Central de operações" version; the palette tokens in the frontmatter apply again. Still binding: figures only from `conteudo.ts`; no automatic failover (the Smart Routing simulator shows the manual switch in explicit steps); every demonstration labeled; no contact, terms or institutional links until the owner provides them (`CONTATO_HREF` stays `null`).

## Overview

**Creative North Star: "Central de operações"**

The public surface is the control room that keeps each store's checkout running. It is light, institutional and exact: a cool paper ground ruled with a fine technical grid, white instrument panels edged with a single hairline, and graphite headlines in a heavy, tightly tracked grotesque. Its proof is a live route diagram (Shopify → your checkout → Pix and card branches, each with an active and a configured gateway, real logos) where the visitor blocks a gateway and then switches it in two explicit steps, exactly as the merchant would in the panel.

Below the hero the page reads as living technical documentation, never as cards: an activation line whose stations carry the panel's real status names, a technical sheet of the gateway network that says how each one captures the card, and a sequence diagram of one order showing where each security guarantee happens. Each is drawn from the real product (`conteudo.ts`, the panel, the payment routes) and lights up as the visitor reaches it.

Color is rationed like status lights on a console. VOX green is the only color that means "act", "active" or "done"; mint appears only as the glow of the pulses travelling a route; burnt orange appears only when a gateway is blocked. Everything else is paper, white, graphite and grey. The logo's echo rings are the structural geometry: concentric circles around the checkout node in the diagram, and the same rings at wall scale in the graphite closing band.

**Key Characteristics:**
- Cool paper ground with a 48px technical grid on the hero; white surfaces with 1px hairlines everywhere else.
- Graphite Bricolage Grotesque 800 headlines at -0.04em carry the page; Inter body stays calm in grey.
- One action/status color (VOX green), one light (mint, pulses only), one alarm (burnt orange, "bloqueada" only).
- Lists, tables, rails and diagrams instead of feature cards; only the hero diagram floats.
- Serious 10px corners on every control, 8px on chips; no pills for actions.
- Logo echo rings as concentric scaffold; graphite closing band to end the page.
- Motion is functional (pulses, route redraw, a short shake on block, a scroll-drawn rail, arrows lighting in sequence) and fully gated on `prefers-reduced-motion`; content is server-rendered, lit and readable without JS.

## Colors

A console palette: paper, white and graphite as the room, with three status colors that each have exactly one job.

### Primary
- **VOX Green** (`vox-green`): the only action and "active/done" color. Primary button fill, focus outline, text selection, active route lines and pulse cores, "Ativo" status text and dot, active node edge (at 45% alpha), lit station dots, the activation progress line, lit status-chip state text and dot (chip border at 35% alpha), lit sequence arrows and step badges, the "Servidor VOX" lane edge, lit security-guarantee dots, the highlighted capture type in the legend, table check marks, link hover, the inner logo ring in the diagram.
- **Deep Green** (`vox-green-hover`): hover fill of the primary button only.

### Secondary
- **Pulse Mint** (`pulse-mint`): the logo's mint, used only as the 35%-alpha halo around a pulse travelling a route (the hero diagram's 7px halo, the sequence diagram's 4px ring). It is light, not paint.
- **Logo Bright** (`logo-bright`): the brand's bright green, used only for the echo rings drawn on the graphite closing band, where VOX green would lack contrast.

### Tertiary
- **Burnt Orange** (`alert`): the "Bloqueada" state only: status text and dot, the dashed severed route line, the dot on the "Simular gateway bloqueado" control. **Alert Wash** (`alert-wash`) fills the blocked node; **Alert Edge** (`alert-edge`) is its border.

### Neutral
- **Control Paper** (`paper`): the page ground, browser chrome (`html` background, scrollbar track), the Pix/Cartão route labels, the segmented filter's track, the gateway sheet's header row, and the fill of pending station dots and step badges.
- **Panel White** (`surface`): alternating section bands, both diagram stages, route nodes, outline button, logo chips, lit status chips, the sliding segment indicator, gateway sheet rows.
- **Graphite** (`ink`): headlines, primary text, inline figures, lit sequence-step text.
- **Instrument Grey** (`mute`): body copy, captions, nav links at rest, table headers, inactive segments and counts, pending states ("pendente", unlit numerals, unreached guarantees).
- **Dim Grey** (`dim`): the large display statement around the real figures only (large text, never body).
- **Hairline** (`line`): section borders, list and table rules, node, chip and lane borders, the gateway sheet frame, the sequence diagram's dashed lifelines (`4 5`), the nav's permanent bottom rule.
- **Strong Hairline** (`line-strong`): idle/"Configurado" route lines and dots, the dashed activation rail (`4 6`), pending dots, badge rings and arrows in the sequence diagram, outline-button hover border, scrollbar thumb.
- **Grid Ink** (`grid`): the technical grid lines on the hero.
- **Graphite Band** (`night`, same value as `ink`): closing section and footer ground; **Night Grey** (`night-mute`) is text on it.

### Named Rules
**The One Signal Rule.** VOX green is the only color that means "act", "active" or "done". No second accent, no green gradients, no green for decoration beyond the logo rings.

**The Mint Is Light Rule.** Mint appears only as the glow of a moving pulse. Never as a fill, text, border or button.

**The Alarm Rule.** Burnt orange exists for one state, a blocked gateway. It is never used for emphasis, errors elsewhere on the page, or decoration.

## Typography

**Display Font:** Bricolage Grotesque, weights 600/700/800, served by next/font as `--font-display` (fallback system-ui, sans-serif)
**Body Font:** Inter (global), with stylistic sets `ss01` and `cv11` enabled on `.landing`

**Character:** A heavy, wide grotesque pulled tight reads as confident engineering; Inter underneath reads as documentation.

### Hierarchy
The ramp below is the one the code ships; Inter runs in half-pixel steps from 17px down to 10.5px because the documentation sections set dense technical text at several reading distances.
- **Display** (800, clamp 2.6rem to 5.1rem, 0.96, -0.04em): the hero headline only, balanced wrap, settles in three to four lines at desktop.
- **Headline** (800, clamp 2.2rem to 3.75rem, 1, -0.04em): section headlines, max 18ch, balanced. **Closing headline** runs one step larger (to 4.75rem, 0.98) on the graphite band, max 16ch.
- **Statement** (600, clamp 1.65rem to 2.85rem, 1.18, -0.03em, Dim Grey): the one sentence that carries the real platform numbers.
- **Figure** (800, 1.45em of its sentence, 0.9, -0.04em, tabular, Graphite): real numbers growing inside the statement, never in a metrics grid.
- **Title** (800, 26px, -0.03em): feature group headings. **Title small** (700, 22px, -0.025em): activation station titles.
- **Body** (400, 17px, 18px on the hero from sm, 1.625): supporting copy and the section-header paragraphs, measure 30 to 36rem. **Body small** (15px): station text, gateway sheet rows (500 for names), the activation status line (600). **Body extra small** (14.5px, 1.625): feature, group-summary and security-guarantee descriptions; legend descriptions run at 14px.
- **Item** (600, 15.5px): feature names, security-guarantee names, capture-type names in the legend. **Item small** (600, 14.5px, 1.375): sequence-step actions.
- **Control** (600, 13.5px): segmented-filter labels and lane chips (12.5px below sm). **Note** (400, 13.5px, 1.625): sequence-step notes, the pricing line under the hero CTA, the footer.
- **Label** (600, 13px, sentence case): the legend heading; the card capture type in sheet rows runs at 13px 500. **Label small** (600, 12.5px): the gateway sheet header row.
- **Caption** (400, 12.5px, Instrument Grey): demonstration and figure captions, status-chip text (500 subject, 600 lit state), legend counts.
- **Numeral** (700, 12px, tabular): numbers inside the 28px station dots. **Numeral small** (700, 10.5px, tabular): numbers inside the 20px sequence badges.

### Named Rules
**The Weight Carries It Rule.** Hierarchy comes from Bricolage weight and size with negative tracking. Labels are sentence case and never tracked out.

**The Tabular Figures Rule.** Every counted figure, count and step number uses tabular numerals.

## Layout

A single centered container (1240px max) with gutters of 16, 24 and 32px at mobile, sm and lg. Sections stack full-bleed on Control Paper or Panel White, each closed by a 1px Hairline bottom border, with 96px vertical padding (112px from sm). In order: hero (paper, grid), figures sentence (white), activation (paper), gateway sheet (white), features (paper), order path (paper), closing band (graphite). The hero alone carries the 48px technical grid, fills the viewport height at lg (`100svh`) and splits 0.92fr / 1.08fr (copy left, diagram stage right).

Section headers in the documentation sections are a two-column grid at lg (headline 1fr left, 17px Instrument Grey paragraph 0.8fr right, aligned to the bottom); below lg they stack. The activation stations run in four columns at lg over a horizontal rail, and in one column below lg beside a vertical rail. The gateway sheet sits beside an 18rem legend at lg (1fr / 18rem, the legend dropped 52px to align with the sheet); its rows split into two column-major columns at xl, with a hairline filler cell closing an odd count. The order path splits 0.8fr / 1.2fr at lg with the left column (headline, paragraph, guarantees) sticky 112px from the top. Features run in three columns. Below 1024px everything collapses to one column; the hero diagram swaps to a vertical layout (top-down flow, Pix left and card right, reserve routes skirting the edges) below 640px and its nodes size by container query units; the sequence diagram keeps its three lanes and moves step text to full width below sm. The closing band pads 112px / 144px. Nav is fixed, 64px tall; anchored sections use a 64px scroll margin. Layout is verified at the owner's real ~1046px viewport as well as standard breakpoints.

### Named Rules
**The Lit By Default Rule.** Server HTML, no-JS and reduced motion show every station, arrow and guarantee lit and every chip in its done state. Progressive lighting is applied only after mount, only where it can be followed (the guarantees light step by step only at lg, where their column is sticky beside the diagram), and never hides content.

## Elevation & Depth

Mostly flat: sections, lists, tables, the gateway sheet and the sequence diagram sit on the ground and are separated by hairlines. Depth is reserved for the instruments: the hero diagram stage floats softly off the grid, its nodes cast short diffuse shadows, the primary button has a green under-glow, and the segmented filter's sliding indicator lifts a hair off its track. All shadows are soft, negative-spread or tiny, and tinted with graphite or green; none are hard or offset.

### Shadow Vocabulary
- **Stage** (`box-shadow: 0 30px 60px -40px rgba(14,23,20,.35)`): the white hero diagram frame on the grid.
- **Checkout node** (`box-shadow: 0 18px 40px -24px rgba(14,23,20,.45)`): the circular center node.
- **Route node** (`box-shadow: 0 10px 24px -18px rgba(14,23,20,.5)`): Shopify and gateway nodes.
- **Green glow** (`box-shadow: 0 1px 0 rgba(255,255,255,.14) inset, 0 8px 18px -10px rgba(31,132,110,.65)`; hover `0 12px 22px -12px rgba(31,132,110,.8)`): primary button only.
- **Segment lift** (`box-shadow: 0 1px 3px rgba(14,23,20,.12)`): the white indicator under the active segment.
- **Pulse ring** (`box-shadow: 0 0 0 4px rgba(115,232,206,.35)`): the mint halo of the sequence diagram's travelling pulse.
- **Nav paper** (`rgba(243,245,244,.86)` with `backdrop-filter: blur(12px) saturate(1.2)`): applied after 16px of scroll; the bottom hairline is present from the top.

### Named Rules
**The Instruments Only Rule.** Only the hero diagram, the primary button and the active segment indicator are raised. Content sections, the gateway sheet and the sequence diagram never get shadows or cards.

## Shapes

Engineered, moderately rounded geometry. Every control (buttons, nav text button, segmented track, lane chips) uses 10px; chips (status chips, the inner segment indicator) and logo tiles 8px, logo tiles being white squares with a hairline and 2px inset; route nodes 12px; the gateway sheet 14px; both diagram stages 18px. Full rounds are reserved for status dots, route labels (Pix/Cartão, 22px tall), the circular checkout node and the numbered dots (28px stations, 20px sequence badges). Circles are structural: the logo's echo rings, concentric around the checkout node (inner ring solid 1.4px at 30%, outer rings 1px dashed `2 6` at 16%), with gateway nodes seated on the outer arcs. Structure is drawn with 1px lines: solid hairlines for rules and frames, dashed lines for paths not yet taken (the activation rail, sequence lifelines, idle routes).

## Components

### Buttons
Solid and serious: one green object per region.
- **Shape:** gently rounded (10px), never a pill.
- **Primary:** VOX Green fill, white 600 text at 15px, -0.005em, padding 0.9rem 1.35rem, trailing single-stroke arrow, green glow.
- **Hover / Focus:** fill to Deep Green, lifts 1px, arrow slides 3px right (0.25s, `cubic-bezier(0.22, 1, 0.36, 1)`); active returns to rest. Focus is a 2px VOX Green outline at 3px offset.
- **Small:** padding 0.55rem 0.95rem, 14px; nav and the diagram's decisive step.
- **Outline:** white, Hairline border, Graphite 600 at 14px, a leading 8px status dot; border strengthens to Strong Hairline on hover; disabled 60% opacity.
- **Text:** "Entrar" in the nav (Graphite 600, 10px radius, 5% graphite wash on hover); "Ver como funciona" as a Graphite 600 link turning green on hover with a nudging arrow.

### Segmented filter
A radiogroup, not a set of pills: a Control Paper track (10px, Hairline border, 4px padding) holding segments in Control type with a tabular count in Instrument Grey. The active segment is Graphite on a white 8px indicator that slides between segments (shared layout, spring 420/34; instant under reduced motion); inactive segments are Instrument Grey, Graphite on hover.

### Status chips
The panel's own status, shown verbatim. An 8px chip with a 6px dot, the subject in Graphite 500 and the state after it, all at 12.5px. Lit: white fill, VOX Green border at 35%, green dot, state in VOX Green 600 using the real panel name ("Ativa", "Conectada", "Verificado", "Ativo", "Conectado"). Pending: transparent, Hairline border, Strong Hairline dot, "pendente" in Instrument Grey. Colors cross-fade in 0.5s.

### Navigation
Fixed, transparent over the hero grid with a permanent Hairline bottom rule; after 16px of scroll it gains Nav paper (0.3s). Logo plus "VOX" in Bricolage 800 at 19px; anchors in Inter 500 at 14px, Instrument Grey, Graphite on hover; "Entrar" text button; small primary button. Below md the anchors hide; below sm the CTA hides (the hero carries it).

### Route diagram (signature)
The page's proof and signature, inside the white 18px stage.
- **Structure:** Shopify node → circular "Seu checkout" node (VOX Green 1px edge, logo, Bricolage 700 label) → Pix and Cartão branches, each with an active and a configured gateway node with its real logo. Logo echo rings centered on the checkout.
- **Lines:** active 2px VOX Green solid; idle 1.4px Strong Hairline dashed `4 6`; severed 1.4px Burnt Orange dashed `3 5`. The rerouted line draws itself in 0.9s.
- **Pulses:** a 3.4px VOX Green core inside a 7px Pulse Mint halo at 35%, travelling the full route (3.2 to 3.6s, eased spline). None under reduced motion.
- **Node states:** Ativo (green edge at 45%, green status), Configurado (Hairline, grey dot), Bloqueada (Alert Wash, Alert Edge, orange status, a 0.5s horizontal shake).
- **Interaction:** three explicit, user-driven steps in the caption control: "Simular gateway bloqueado" (outline, orange dot) → "Trocar o Pix para a …" (small primary) → "Voltar ao início" (outline, green dot). A polite live caption narrates each state and a permanent caption reads "Demonstração com integrações reais do VOX".

### Activation line
The panel's four real onboarding steps as stations on a rail.
- **Rail:** a 1px Strong Hairline dashed track (`4 6`) joining the station dots, horizontal at lg and vertical below; a 1px VOX Green line over it scales with scroll (from the section entering at 78% of the viewport to its end at 60%), and a station lights as the line reaches it.
- **Station:** a 28px numbered dot (lit: VOX Green fill, white numeral; pending: paper fill, Strong Hairline border, grey numeral), Title small heading, Body small text in Instrument Grey (max 17rem), then its status chips.
- **Closing line:** a polite live line with an 8px dot: "Checkout no ar, no seu domínio." in Graphite with a green dot when all four are lit, otherwise a grey note.

### Gateway sheet
The network as a technical sheet, data from `conteudo.ts` (13 gateways, `cartao` capture type, `TIPO_CARTAO` labels).
- **Frame:** a 14px Hairline-bordered sheet; a Control Paper header row (Gateway / Pix / Cartão, Label small in Instrument Grey); white rows with Hairline top rules, 12px 16px padding.
- **Row:** 28px logo tile, gateway name at 15px Graphite 500, a 17px VOX Green check under Pix, and the capture type at 13px (Graphite 500 for Transparente / Tokenizado / Campo seguro; an Instrument Grey em dash when the gateway has no card).
- **Filter:** the segmented filter above it (Todos / Pix e cartão / Só Pix, with counts); rows reflow with a spring (380/34), entering from 8px below and exiting in 0.15s; no animation under reduced motion.
- **Legend:** an aside headed "Como o cartão é capturado": hairline-ruled entries with the type name (Item), a tabular count in Caption and a description. Hover previews and click pins a type: its name turns VOX Green and non-matching rows dim to 32% opacity. A note closes it: every listed gateway processes Pix.

### Sequence diagram
One real order, Comprador → Servidor VOX → Gateway, inside a white 18px stage with a Hairline border and no shadow.
- **Lanes:** three lane chips (10px, Hairline border, Control type); "Servidor VOX" alone takes a VOX Green border. Dashed Hairline lifelines (`4 5`) run below each.
- **Messages:** 1px arrows with a 1.6px chevron, Strong Hairline (`#B9C4C0`) until in view, then VOX Green (0.5s); a self-call is a looped arrow. Each starts at a 20px numbered badge on its source lane. A single 10px green pulse with the mint Pulse ring travels each arrow once as it lights (0.9s, `cubic-bezier(0.45, 0, 0.25, 1)`).
- **Text:** action in Item small, note in Note, set between the two lanes of the message from sm and full width on a white backing below sm.
- **Guarantees:** the sticky left column lists the three guarantees from `SEGURANCA` between Hairline rules, each with a 10px dot that lights green (name to Graphite) when its step is reached; permanently lit below lg, without JS and under reduced motion.
- **Caption:** "Fluxo real de cada pedido no checkout do VOX." in Caption.

### Lists
Feature groups are definition lists between Hairline rules (Item names, Body extra small descriptions); the security guarantees use the same ruled list beside the sequence diagram.

### Closing band
Graphite ground, the closing headline in white, Night Grey body, primary button, and four Logo Bright echo rings at wall scale fading from 30% to 12% off the right edge. The footer continues the band below a 10% white rule.

## Do's and Don'ts

### Do:
- **Do** keep VOX Green (`#1f846e`) as the only action and "active" color; one primary button per view region.
- **Do** confine mint to pulse halos and burnt orange to the blocked state (The Mint Is Light Rule, The Alarm Rule).
- **Do** take every figure from `conteudo.ts` (real data); set figures and step numbers in tabular numerals, growing inside a sentence rather than in a metrics grid.
- **Do** depict the gateway switch as a manual action the merchant takes in the panel, in explicit user-driven steps.
- **Do** use the panel's real status names, onboarding steps and payment flow when the page shows product state; describe only what the code does.
- **Do** label every demonstration as such, in a plain sentence-case caption.
- **Do** use 10px corners on every control, 8px on chips, and 1px Hairline (`#d8dfdc`) rules to separate sections, rows and items.
- **Do** use the logo's echo rings as concentric structure, not as scattered decoration.
- **Do** gate every looping, scroll-driven or entrance animation on `prefers-reduced-motion` and keep all content lit and visible without JS (The Lit By Default Rule).
- **Do** draw icons as single-stroke inline SVG (1.6 to 2.4px, round caps and joins).

### Don't:
- **Don't** invent statistics, testimonials, client logos or ratings; a figure not in `conteudo.ts` does not appear.
- **Don't** depict or claim automatic failover, self-healing routes or detection of a gateway outage; routing does not detect outages and switching is always the merchant's manual action.
- **Don't** show an unlabeled demonstration, or a phone/checkout mockup as the hero proof.
- **Don't** wrap features in bordered card grids; use rules, lists, tables, rails and diagrams.
- **Don't** use pill-shaped buttons or filter pills, or hard offset shadows.
- **Don't** add uppercase tracked eyebrows or kickers above headlines.
- **Don't** add an institutional company section (CNPJ, contact, terms) until the owner opens the new CNPJ.
- **Don't** bring the panel's `--c-*` tokens into this surface, or these `--l-*` tokens into the panel, admin or checkout; `.landing` scoping keeps them apart.
