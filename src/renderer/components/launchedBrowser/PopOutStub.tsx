import { Button } from '@renderer/components/ui'
import { dockPanel, showPopOutWindow } from '@renderer/lib/api/launchedBrowser'

// What the main window keeps where the panel was while it is popped out (`1g`): the rail on a
// Case screen, the overlay its strip opens, and the top bar's popover on the dashboard and in
// Settings.
export function PopOutStub({ onDone }: { onDone?: () => void }) {
  return (
    <div className="px-3 py-2.5 text-[11px] leading-[1.45]">
      <div className="flex items-center gap-2 rounded border border-border bg-surface px-2.5 py-1.5">
        <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-fg" />
        <span className="text-text-muted">Panel popped out</span>
        <span className="flex-1" />
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
      </div>
    </div>
  )
}
