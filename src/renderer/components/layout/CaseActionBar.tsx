import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { Button } from '@renderer/components/ui'
import { SessionControls } from '@renderer/components/status/SessionControls'
import { launchedBrowserStatusQueryOptions } from '@renderer/lib/api/launchedBrowser'
import { busyRefusal } from '@renderer/components/launchedBrowser/startDialogModel'

// The case's session switch sits in this bar under the top bar rather than in it, so the top
// bar's right side does not grow toward the native window controls while recording. The bar
// renders whenever a Case is open, for Launch browser, which needs no extension (`2b`); the
// switch shows itself only while it has something to control. Export lives in the top bar.
export function CaseActionBar({ caseId }: { caseId: string }) {
  const openStartDialog = useAppStore((s) => s.openStartDialog)
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  // One launched browser at a time. A disabled button takes no pointer, so the reason sits on
  // its wrapper.
  const busy = busyRefusal(status)?.title
  return (
    <div
      data-testid="case-action-bar"
      className="flex h-10 shrink-0 items-center justify-end gap-3 border-b border-border bg-surface px-4"
    >
      <span title={busy}>
        <Button
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => openStartDialog(caseId)}
        >
          Launch browser
        </Button>
      </span>
      <SessionControls />
    </div>
  )
}
