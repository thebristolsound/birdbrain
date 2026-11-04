import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import {
  CaptureSessionPanel,
  useCaptureSessionView
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'

// The top bar's Capture Session button on screens with no rail (`2c`, `2d`): the dashboard,
// Settings and the new-Case wizard. It opens the panel as a 300-pixel popover under it. The outline
// takes the accent only while the popover is open, a selected state (C1).
export function CaptureSessionButton({ showOpenCase }: { showOpenCase: boolean }) {
  const view = useCaptureSessionView()
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
