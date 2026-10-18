import { useAppStore } from '@renderer/stores/appStore'
import { SessionControls } from '@renderer/components/status/SessionControls'

// The case's session switch sits in this bar under the top bar rather than in it, so the top
// bar's right side does not grow toward the native window controls while recording. The
// switch only exists with the extension connected, and the bar goes with it rather than
// leaving an empty strip. Export lives in the top bar.
export function CaseActionBar() {
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  if (!connectedToExtension) return null
  return (
    <div
      data-testid="case-action-bar"
      className="flex h-10 shrink-0 items-center justify-end gap-3 border-b border-border bg-surface px-4"
    >
      <SessionControls />
    </div>
  )
}
