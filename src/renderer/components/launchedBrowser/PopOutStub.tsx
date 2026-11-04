import { Button } from '@renderer/components/ui'
import { dockPanel, showPopOutWindow } from '@renderer/lib/api/launchedBrowser'

// What the main window keeps where the panel was while it is popped out (`1g`): the rail on a
// Case screen, the overlay its strip opens, and the top bar's popover on the dashboard and in
// Settings.
export function PopOutStub({ onDone }: { onDone?: () => void }) {
  return (
    <div className="px-3 py-2.5 text-[11px] leading-[1.45]">
      {/* The buttons move under the label when one row does not fit. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded border border-border bg-surface px-2.5 py-1.5">
        <span className="flex flex-1 items-center gap-2 whitespace-nowrap text-text-muted">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-fg" />
          Panel popped out
        </span>
        <span className="ml-auto flex gap-1.5 whitespace-nowrap">
          <Button
            variant="outline"
            onClick={() => {
              onDone?.()
              void showPopOutWindow()
            }}
          >
            Show window
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onDone?.()
              void dockPanel()
            }}
          >
            Dock
          </Button>
        </span>
      </div>
    </div>
  )
}
