import { Label, Input } from 'birdbrain-ui'

// Label is a leaf; its true usage is captioning a field, so the canonical
// story pairs it with the control it describes.
export const FieldLabel = () => (
  <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 320 }}>
    <Label htmlFor="url">Source URL</Label>
    <Input id="url" defaultValue="https://example.com/article" />
  </div>
)

export const Standalone = () => <Label>Selectors</Label>
