import { Input, Label } from 'birdbrain-ui'

const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', maxWidth: 320 }

export const WithLabel = () => (
  <div style={field}>
    <Label htmlFor="case-name">Case name</Label>
    <Input id="case-name" placeholder="e.g. Operation Nightjar" defaultValue="Operation Nightjar" />
  </div>
)

export const Placeholder = () => (
  <div style={{ maxWidth: 320 }}>
    <Input placeholder="Paste a URL to capture…" />
  </div>
)

export const Disabled = () => (
  <div style={field}>
    <Label htmlFor="ro">Installation ID</Label>
    <Input id="ro" defaultValue="bb_9f2a…c41d" disabled />
  </div>
)
