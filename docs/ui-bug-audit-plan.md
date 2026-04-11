# Desktop UI Bug Audit Plan

## Summary
Run a code-first UI audit across the Electron renderer, then produce a ranked bug list focused on visual inconsistencies, dead controls, resize/overflow issues, and interaction affordance gaps. Start with the dashboard, settings, and case workspace because the current code already shows likely defects there.

## Key Review Targets
- **Theme and visual token consistency**
  - Audit dashboard cards, quick-start tiles, banners, and status badges for hardcoded dark-only Tailwind colors used in light mode, especially in `CaseCard`, `QuickStartGuide`, and `ExtensionBanner`.
  - Flag components that bypass the semantic token system (`bg-surface`, `bg-card`, `text-text-*`, etc.) and therefore drift visually between themes.

- **Dead or misleading controls**
  - Verify and report buttons/links that present as interactive but have no behavior wired up.
  - Current likely examples: `View All` in recent cases, `Learn More` in the extension banner, and the `GitHub` link in `About`.

- **Resize, layout, and scrolling defects**
  - Review dashboard and settings layouts for narrow-window behavior and nested-scroll problems.
  - Current likely examples: `QuickStartGuide` using a fixed `grid-cols-4`, settings using `h-full` without a clearly height-bounded parent, and capture split panes using fixed proportions that may collapse poorly.

- **Affordance and state-visibility issues**
  - Check controls that only appear on hover or whose hover state is visually indistinct.
  - Current likely examples: `CaseCard` menu affordance hidden until hover, search result rows using the same hover/background surface, and edit affordances in `CaseHeader` that are invisible except on hover.

- **Token/class correctness**
  - Search renderer files for invalid utility classes and styling typos that silently break intended visuals.
  - Current confirmed example: `placeholder-text-muted` should be `placeholder:text-text-muted` in onboarding and new-case inputs.

## Deliverable Format
- Produce a findings list ordered by severity.
- For each finding, include:
  - user-visible impact
  - exact file reference(s)
  - why it is a bug or inconsistency
  - whether it is code-confirmed or needs runtime verification
- Keep style-only preferences out unless they create inconsistency, poor contrast, broken layout, or misleading interaction.

## Test and Verification Pass
- Static verification:
  - Search renderer files for hardcoded palette classes, invalid Tailwind utilities, fixed-width/fixed-column layouts, hidden-on-hover controls, and buttons without handlers.
- Targeted runtime verification after the code pass:
  - Resize the app to a narrow desktop width and re-check dashboard, settings, and case workspace.
  - Toggle light/dark themes and compare the flagged components for contrast and token consistency.
  - Tab through actionable controls to confirm keyboard-visible affordances are not hover-only.

## Assumptions
- Default audit mode is **code-first**, with runtime checks used only to confirm high-risk findings.
- “UI bugs” includes visual inconsistencies, misleading interactions, dead controls, contrast/theme drift, and layout/scroll issues.
- No implementation changes are made in this phase; the output is a prioritized review that can be handed directly into a fix pass.
