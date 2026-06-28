# Adopt an OpenRouter-derived flat theme (zinc + #6467f2), retiring the neumorphic identity

Birdbrain's UI is reskinned to clone OpenRouter's visual language in both light and dark: a
flat **zinc-neutral palette with a single indigo accent (`#6467f2`)**, an 8px radius system
(6px buttons), **Inter** for all text, and OpenRouter's categorical bar-chart palette. This
retires birdbrain's prior bespoke identity — neumorphic card shadows, indigo glows, shimmer
text, the animated logo pulse, the page noise overlay, and the grid background. Design and
extracted token values are in `docs/specs/2026-06-28-openrouter-theme-reskin-design.md`.

This is recorded as an ADR because it is hard to reverse (it sets birdbrain's design direction,
neutralizes the bespoke effect system, and adds a font dependency), surprising without context
(a future reader will reasonably ask why a forensic capture tool mirrors a third-party LLM
marketplace's look), and the result of real trade-offs with genuine alternatives.

**Decision and the trade-offs taken:**
- **Flat over bespoke.** The neumorphic/glow/shimmer identity is abandoned for OpenRouter's
  flat, border-defined surfaces. Chosen per explicit product direction; the cost is losing a
  distinctive look in favour of a familiar shadcn/OpenRouter idiom.
- **Minimal elevation ladder, not pure-flat.** OpenRouter collapses cards to ~page colour;
  birdbrain nests surfaces more deeply (CaseOverview, capture split-view, modals). A literal
  collapse made dark-mode nested views read as muddy hairline boxes, so we keep a
  just-perceptible page→card step plus a clearly raised step for overlays. The light page is
  zinc-50 (`#fafafa`) rather than pure white so white cards remain legible.
- **Overlays keep a soft shadow.** "Flat" means no decorative glow/neumorphism, not "no
  elevation cue on floating surfaces." Modals and the command palette use `bg-elevated` + a
  dedicated `--shadow-overlay`, matching shadcn/OpenRouter dropdown/menu conventions.
- **Effects neutralized in CSS, not deleted.** The effect classes (`.neu-card`, `.glow-*`,
  `.shimmer-text`, `.logo-pulse`, `.grid-bg`) are redefined to render flat rather than removed
  from ~15 components. This was chosen for low risk and reversibility; the cost is some inert
  CSS and now-unused `@keyframes` remaining in `globals.css`.

**Consequences / constraints:**
- The token *values* in `src/renderer/styles/globals.css` change, but token *names* are kept,
  so the ~82 components consuming `bg-canvas`/`text-text-*`/`border-border`/etc. reskin with no
  edits. New UI should follow the flat idiom and use the semantic tokens, not raw colours.
- Inter is added (`@fontsource-variable/inter`); Plus Jakarta Sans and DM Sans are dropped.
  JetBrains Mono is retained for code/hash display. `--font-display` and `--font-body` both map
  to Inter (headings differ by weight only).
- OpenRouter's 20-colour bar palette lives in `src/renderer/lib/chartColors.ts` and feeds the
  categorical `SOURCE_TONES` behind `SourcesBlock`. Single-series visualisations
  (`ActivityTimeline`, `SelectorCoverageBlock`) stay accent-coloured; no `--chart-*` CSS vars
  are added (no consumer).
- The bar-chart palette is sourced from a third party's running site; the values are functional
  design data (Recharts defaults + CSS/X11 named colours), not copied brand assets. No
  OpenRouter logo, wordmark, or proprietary artwork is adopted.

Reversible via git, but a future pass must not silently re-introduce glow/neumorphism or
"upgrade" the minimal ladder to deep elevation without re-opening the flat-clone decision.
