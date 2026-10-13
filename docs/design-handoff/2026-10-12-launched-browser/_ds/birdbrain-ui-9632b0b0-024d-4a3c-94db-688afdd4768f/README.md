# Birdbrain UI — how to build with these components

These are Birdbrain's own React primitives (from `src/renderer/components/ui/`),
styled with **Tailwind v4** semantic tokens. Build screens by composing these
components and styling your own layout glue with the token utilities below —
never invent a parallel color/spacing vocabulary.

## Setup & wrapping

- **No provider is required.** Button, Badge, Card, Input, Textarea, Label,
  ScrollArea, Skeleton, and Tabs all render standalone. Just import from the
  library and mount.
- **Load the stylesheet.** All styling comes from the bundle's `styles.css`
  (it imports `_ds_bundle.css` for the token/utility layer and
  `fonts/fonts.css` for the brand fonts). Without it, components render
  unstyled.
- **Dark mode is class-based.** Every token has a light default on `:root` and
  a dark override under `html.dark`. Add `class="dark"` to `<html>` to switch
  the whole tree — the same utility class names (`bg-canvas`, `text-text-primary`,
  …) resolve correctly in both themes; never hardcode hex for themed surfaces.
- **`Dialog` is controlled** — it takes `open` and `onOpenChange`, renders a
  `fixed` overlay + centered panel, and closes on Escape. Compose it as
  `Dialog > DialogContent(onClose) > DialogHeader/DialogTitle/DialogDescription`
  + `DialogFooter`.
- **`Tabs` is Radix-backed** — use it uncontrolled with `defaultValue`, matching
  `TabsTrigger value` / `TabsContent value`. `TabsList` takes `variant="default"`
  (pill) or `"line"` (underline).

## Styling idiom — the token vocabulary (use these exact names)

This is a Tailwind v4 utility system driven by semantic CSS custom properties.
Style your layout with these utilities; they are defined in `_ds_bundle.css`.

| Purpose | Utilities |
|---|---|
| Surfaces | `bg-canvas` (app bg), `bg-surface`, `bg-card`, `bg-elevated` |
| Text | `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-text-faint` |
| Accent (indigo) | `bg-accent`, `bg-accent-hover`, `bg-accent-subtle`, `text-accent`, `ring-ring` |
| Borders | `border-border`, `border-border-strong` |
| Radius | `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl` |
| Fonts | `font-display`, `font-body` (Inter Variable), `font-mono` (JetBrains Mono Variable) |
| Shadows | `shadow-[var(--shadow-card)]`, `var(--shadow-overlay)`, `var(--shadow-btn)` |
| Status colors | raw palette utilities exist for one-offs: `bg-red-600`, `text-emerald-500`, `bg-amber-400`, etc. |

Standard Tailwind spacing/flex/grid utilities (`flex`, `gap-2`, `px-4`, `h-9`,
`w-full`, …) are all available. Card surfaces also expose the custom classes
`neu-card` / `neu-card-hover` (the `Card` component applies these for you).

## Where the truth lives

- **Tokens & utilities:** `styles.css` → `_ds_bundle.css` (all `--color-*`,
  `--font-*`, `--radius*`, `--shadow-*` definitions, plus the `html.dark`
  overrides). Read it before styling.
- **Per-component API & usage:** each `components/<Name>/<Name>.d.ts`
  (the `<Name>Props` contract) and `<Name>.prompt.md`.

## Idiomatic build snippet

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge } from 'birdbrain-ui'

function CaseCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Operation Nightjar</CardTitle>
        <CardDescription>Opened 3 days ago · 42 captures</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          <Badge variant="accent">Active</Badge>
          <Badge variant="outline">7 selectors</Badge>
        </div>
      </CardContent>
      <CardFooter className="gap-3">
        <Button size="sm">Open</Button>
        <Button size="sm" variant="ghost">Export</Button>
      </CardFooter>
    </Card>
  )
}
```

# BirdbrainUI (birdbrain-ui@1.0.1-beta.11)

This design system is the published birdbrain-ui React library, bundled as a single
browser global. All 10 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.BirdbrainUI`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).
- `guidelines/` — the design system's own usage guidance (1 doc(s), see `guidelines/index.md`). Read these before composing larger layouts.

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.BirdbrainUI.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Badge } = window.BirdbrainUI;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Badge />);
```

## Tokens

181 CSS custom properties from birdbrain-ui. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (79): `--tw-border-style`, `--tw-shadow-color`, `--tw-inset-shadow-color`, …
- **spacing** (5): `--tw-space-y-reverse`, `--tw-inset-shadow`, `--tw-inset-shadow-alpha`, …
- **typography** (17): `--tw-font-weight`, `--tw-tracking`, `--font-sans`, …
- **radius** (6): `--radius-md`, `--radius-lg`, `--radius-xl`, …
- **shadow** (12): `--tw-shadow`, `--tw-shadow-alpha`, `--tw-ring-shadow`, …
- **other** (62): `--tw-translate-x`, `--tw-translate-y`, `--tw-translate-z`, …

## Components

### general
- `Badge`
- `Button`
- `Card`
- `Dialog`
- `Input`
- `Label`
- `ScrollArea`
- `Skeleton`
- `Tabs`
- `Textarea`
