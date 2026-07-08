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
