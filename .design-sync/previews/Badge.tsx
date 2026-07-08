import { Badge } from 'birdbrain-ui'

const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }

export const Variants = () => (
  <div style={row}>
    <Badge variant="default">Verified</Badge>
    <Badge variant="secondary">Draft</Badge>
    <Badge variant="outline">Archived</Badge>
    <Badge variant="accent">Selector match</Badge>
  </div>
)

export const Sizes = () => (
  <div style={row}>
    <Badge size="sm" variant="secondary">SHA-256</Badge>
    <Badge size="default" variant="secondary">MHTML capture</Badge>
  </div>
)

export const StatusRow = () => (
  <div style={row}>
    <Badge variant="accent">12 captures</Badge>
    <Badge variant="outline">3 tags</Badge>
    <Badge size="sm" variant="default">RFC-3161</Badge>
  </div>
)
