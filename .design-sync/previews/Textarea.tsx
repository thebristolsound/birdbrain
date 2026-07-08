import { Textarea, Label } from 'birdbrain-ui'

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', maxWidth: 380 }

export const WithLabel = () => (
  <div style={field}>
    <Label htmlFor="note">Investigator note</Label>
    <Textarea
      id="note"
      rows={4}
      defaultValue={'Subject page changed between captures at 12:04 and 14:30 — headline reworded, byline removed.'}
    />
  </div>
)

export const Placeholder = () => (
  <div style={{ maxWidth: 380 }}>
    <Textarea rows={3} placeholder="Add a note about this capture…" />
  </div>
)
