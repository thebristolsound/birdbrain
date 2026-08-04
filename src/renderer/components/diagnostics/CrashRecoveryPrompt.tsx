import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { lastSession } from '@renderer/lib/api/diagnostics'
import type { SessionRecord } from '@shared/types'

// lastSession() is take-once server-side (see sessionLog.ts's takeUncleanSession):
// the first call after an unclean exit both returns and acknowledges the
// record, so this only ever offers the prompt once per crash.
export function CrashRecoveryPrompt() {
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    void lastSession()
      .then(setSession)
      .catch(() => {
        // No prompt is a degraded start, not a broken one.
      })
  }, [])

  if (!session || dismissed) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center p-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated px-4 py-3 shadow-lg">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="text-sm text-text-primary">Birdbrain closed unexpectedly last time.</p>
        <div className="flex shrink-0 gap-2">
          {/* Dispatch, don't mount. __root.tsx owns the single
              ReportProblemDialog instance and all of its open/correlationId
              state; every other trigger — the toast action, the Diagnostics
              button, the CommandPalette entry — reaches it through this event.
              A second dialog mounted here would be a parallel code path that
              silently drifts, and this one could never carry a correlation id. */}
          <Button
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent('birdbrain:report'))}
          >
            Create a report
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  )
}
