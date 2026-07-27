import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { ReportProblemDialog } from '@renderer/components/diagnostics/ReportProblemDialog'
import type { SessionRecord } from '@shared/types'

// lastSession() is take-once server-side (see sessionLog.ts's takeUncleanSession):
// the first call after an unclean exit both returns and acknowledges the
// record, so this only ever offers the prompt once per crash.
export function CrashRecoveryPrompt() {
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  useEffect(() => {
    void window.birdbrain.diagnostics
      .lastSession()
      .then(setSession)
      .catch(() => {
        // No prompt is a degraded start, not a broken one.
      })
  }, [])

  if (!session || dismissed) return null

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-center p-4">
        <div className="flex items-center gap-3 rounded-lg border border-border bg-elevated px-4 py-3 shadow-lg">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm text-text-primary">Birdbrain closed unexpectedly last time.</p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => setReportOpen(true)}>
              Create a report
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
      <ReportProblemDialog open={reportOpen} onOpenChange={setReportOpen} />
    </>
  )
}
