import { Button } from 'birdbrain-ui'

const row: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }

export const Variants = () => (
  <div style={row}>
    <Button variant="default">Capture page</Button>
    <Button variant="destructive">Delete case</Button>
    <Button variant="outline">Export</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="link">View source</Button>
  </div>
)

export const Sizes = () => (
  <div style={row}>
    <Button size="xs">Extra small</Button>
    <Button size="sm">Small</Button>
    <Button size="default">Default</Button>
    <Button size="lg">Large</Button>
  </div>
)

export const IconButtons = () => (
  <div style={row}>
    <Button size="icon" aria-label="Add">+</Button>
    <Button size="icon-sm" variant="outline" aria-label="Refresh">↻</Button>
    <Button size="icon" variant="ghost" aria-label="More">⋯</Button>
  </div>
)

export const Disabled = () => (
  <div style={row}>
    <Button disabled>Capturing…</Button>
    <Button variant="outline" disabled>Export</Button>
  </div>
)
