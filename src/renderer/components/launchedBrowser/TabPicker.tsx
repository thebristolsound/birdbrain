import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@renderer/components/ui'
import {
  captureLaunchedTab,
  followLaunchedBrowserPickTab,
  launchedBrowserPopOutQueryOptions,
  launchedBrowserStatusQueryOptions
} from '@renderer/lib/api/launchedBrowser'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'
import {
  capturableTabs,
  tabTitle
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

// The tab picker (#1832, `1r`), mounted once at the root of each window. The capture shortcut
// opens it when more than one tab could be captured, or none, and the panel's Choose tab… opens
// it too. It captures nothing until the Operator picks: numbered rows with the URL, the first
// highlighted, Enter takes the highlighted row and Escape closes. While the panel is popped out,
// the pop-out's picker answers the shortcut and the main window's stays shut. It decides which
// tab a Capture takes, so it is on the evidence-affecting paths list.

const PICKER_TIP =
  'Birdbrain found more than one tab the shortcut could take, or none in front, so it captures ' +
  'only the tab you pick.'

export function TabPicker({ inPopOut }: { inPopOut: boolean }) {
  const open = useAppStore((s) => s.tabPickerOpen)
  const setOpen = useAppStore((s) => s.setTabPickerOpen)
  const setTarget = useAppStore((s) => s.setCaptureTargetId)
  const scrollToLoad = useAppStore((s) => s.scrollToLoadNext)
  const { data: status } = useQuery(launchedBrowserStatusQueryOptions)
  const { data: poppedOut = false } = useQuery(launchedBrowserPopOutQueryOptions)
  const [highlighted, setHighlighted] = useState(0)
  const [error, setError] = useState('')

  useEffect(
    () =>
      followLaunchedBrowserPickTab(() => {
        if (inPopOut || !poppedOut) {
          setHighlighted(0)
          setOpen(true)
        }
      }),
    [inPopOut, poppedOut, setOpen]
  )

  const browser = status?.state === 'open' ? status.browser : null
  const tabs = browser ? capturableTabs(browser.tabs) : []
  const shown = open && browser !== null && !browser.captureUnavailable

  function close() {
    setError('')
    setOpen(false)
  }

  async function pick(index: number) {
    const tab = tabs[index]
    if (!tab) return
    setTarget(tab.targetId)
    setOpen(false)
    try {
      await captureLaunchedTab(tab.targetId, scrollToLoad)
    } catch (err) {
      // Main refused before anything was taken (no browser open, or this platform): say why here.
      setError(err instanceof Error ? err.message : String(err))
      setOpen(true)
    }
  }

  return (
    <Dialog open={shown} onOpenChange={(next) => !next && close()}>
      {shown && (
        <DialogContent
          onClose={close}
          className="w-[calc(100%-1rem)] max-w-sm rounded-md p-3 text-xs"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') setHighlighted((i) => Math.min(tabs.length - 1, i + 1))
            if (event.key === 'ArrowUp') setHighlighted((i) => Math.max(0, i - 1))
            if (event.key === 'Enter') {
              event.preventDefault()
              void pick(highlighted)
            }
          }}
        >
          <div className="flex items-center gap-1.5">
            <DialogTitle>Which tab?</DialogTitle>
            <InfoTip text={PICKER_TIP} />
          </div>
          <DialogDescription className="mt-0.5 text-xs">
            {tabs.length === 0
              ? 'No tab in the launched browser can be captured.'
              : 'Pick the tab to capture.'}
          </DialogDescription>
          <ol aria-label="Tabs to capture" className="mt-2 flex flex-col gap-1">
            {tabs.map((tab, index) => (
              <li key={tab.targetId}>
                <button
                  type="button"
                  title={tab.url}
                  aria-current={index === highlighted ? 'true' : undefined}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => void pick(index)}
                  className={cn(
                    'w-full min-w-0 rounded border border-border px-[7px] py-[5px] text-left',
                    index === highlighted ? 'border-accent bg-accent-subtle' : 'bg-card'
                  )}
                >
                  <div className="truncate font-semibold text-text-primary">
                    {index + 1} · {tabTitle(tab)}
                  </div>
                  <div className="truncate font-mono text-[10px] text-text-muted">{tab.url}</div>
                </button>
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="mt-1.5 text-[11px] text-danger-fg">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
