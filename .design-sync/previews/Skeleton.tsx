import { Skeleton } from 'birdbrain-ui'

// Skeleton is the loading placeholder; the canonical story is a capture-card
// skeleton composed from a few bars at different widths.
export const CaptureCardLoading = () => (
  <div
    style={{
      width: 320,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      border: '1px solid var(--color-border)',
      borderRadius: 16
    }}
  >
    <Skeleton style={{ height: 14, width: '60%' }} />
    <Skeleton style={{ height: 10, width: '85%' }} />
    <Skeleton style={{ height: 10, width: '75%' }} />
    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
      <Skeleton style={{ height: 24, width: 64, borderRadius: 999 }} />
      <Skeleton style={{ height: 24, width: 48, borderRadius: 999 }} />
    </div>
  </div>
)

export const Line = () => <Skeleton style={{ height: 12, width: 200 }} />
