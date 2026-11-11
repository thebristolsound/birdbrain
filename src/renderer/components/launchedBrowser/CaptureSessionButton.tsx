import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import { useAppStore } from '@renderer/stores/appStore'
import { RecordingMark } from '@renderer/components/status/RecordingMark'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'

// The top bar's Capture Session control on screens with no rail (`2c`, `2d`): the dashboard,
// Settings and the new-Case wizard. It opens the panel as a 300-pixel popover under it. While a
// session records, the recording mark itself is the trigger (docs/design-handoff/2026-11-08-top-bar/),
// so the bar carries one control for the session, not two; otherwise an outline button whose
// border takes the accent only while the popover is open, a selected state (C1).
export function CaptureSessionButton({ showOpenCase }: { showOpenCase: boolean }) {
  const view = useCaptureSessionView()
  const sessionActive = useAppStore((s) => s.sessionActive)
  const [open, setOpen] = useState(false)
  const shown = view.kind !== 'none'
  // A popover open as the button went would open again with the next launch.
  const [wasShown, setWasShown] = useState(shown)
  if (shown !== wasShown) {
    setWasShown(shown)
    if (!shown) setOpen(false)
  }

  if (!shown) return null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {sessionActive ? (
          <button
            type="button"
            data-testid="topbar-capture-session"
            className={cn('rounded-md hover:bg-elevated', open && 'bg-elevated')}
          >
            {/* The mark's elapsed time and source stay in the accessible name, as the Export
                button's label does: hidden text names the control, not an aria-label. */}
            <span className="sr-only">Capture Session, </span>
            <RecordingMark trigger />
          </button>
        ) : (
          <Button
            variant="outline"
            data-testid="topbar-capture-session"
            className={cn(
              'gap-1 font-normal',
              open && 'border-accent bg-accent-subtle text-accent hover:bg-accent-subtle'
            )}
          >
            Capture Session
            <ChevronDown aria-hidden="true" className="h-3 w-3" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} aria-label="Capture Session" className="w-[300px]">
        <CaptureSessionPanel
          form="popover"
          showOpenCase={showOpenCase}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
