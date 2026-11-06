import { useState } from 'react'
import type { LaunchedBrowserSummary, LaunchedBrowserTab } from '@shared/types'
import { Button } from '@renderer/components/ui'
import { captureLaunchedTab, launchedBrowserName } from '@renderer/lib/api/launchedBrowser'
import { modifierLabel } from '@renderer/lib/accelerator'
import { useAppStore } from '@renderer/stores/appStore'
import { cn } from '@renderer/lib/utils'
import { InfoTip } from '@renderer/components/launchedBrowser/InfoTip'
import {
  acceleratorLabel,
  captureTarget,
  progressLine,
  shortcutLine,
  tabTitle
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'

// The panel's Capture control (#1832, `1f`, `1l`, `1r`): it names the tab it will capture, with
// title and URL, before the Operator clicks, holds the per-Capture Scroll-to-load choice (off by
// default), and shows the progress, then the Exhibit Number or why nothing was stored. It decides
// which tab a Capture takes, so it is on the evidence-affecting paths list beside the tab picker.

const EYEBROW = 'font-display text-[10px] font-semibold uppercase tracking-[.06em] text-text-faint'

const SCROLL_TIP =
  'Scrolls the page in the browser to load content that appears as you scroll, then returns to ' +
  'the top before the Capture. The page sees the scrolling.'

export function CaptureControl({ browser, pad }: { browser: LaunchedBrowserSummary; pad: string }) {
  const pickedId = useAppStore((s) => s.captureTargetId)
  const scrollToLoad = useAppStore((s) => s.scrollToLoadNext)
  const setScrollToLoad = useAppStore((s) => s.setScrollToLoadNext)
  const setTabPickerOpen = useAppStore((s) => s.setTabPickerOpen)
  const [error, setError] = useState('')
  const { tabs, capture, captureUnavailable, shortcut, label } = browser

  if (captureUnavailable) {
    return (
      <div className={cn('border-b border-border text-text-muted', pad)}>
        <p role="note">{captureUnavailable}</p>
      </div>
    )
  }

  const target = captureTarget(tabs, pickedId)
  const capturing = capture?.state === 'capturing'
  const line = progressLine(capture, tabs)

  async function take(tab: LaunchedBrowserTab) {
    setError('')
    try {
      await captureLaunchedTab(tab.targetId, scrollToLoad)
      // The choice is per Capture (spec, "Scroll-to-load"), so the next one starts with it off.
      setScrollToLoad(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5 border-b border-border', pad)}>
      <div className={EYEBROW}>Capture will take</div>
      {target ? (
        <div className="min-w-0" title={target.url}>
          <div className="truncate font-semibold text-text-primary">{tabTitle(target)}</div>
          <div className="truncate font-mono text-[10px] text-text-muted">{target.url}</div>
          <div className="text-[10px] text-text-muted">{launchedBrowserName(label)}</div>
        </div>
      ) : (
        <p className="text-text-muted">Pick a tab below, or choose one.</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex items-center gap-1 text-text-muted">
          <input
            type="checkbox"
            checked={scrollToLoad}
            disabled={capturing}
            onChange={(event) => setScrollToLoad(event.target.checked)}
          />
          Scroll to load
        </label>
        <InfoTip text={SCROLL_TIP} />
        <span className="flex-1" />
        <Button variant="outline" disabled={capturing} onClick={() => setTabPickerOpen(true)}>
          Choose tab…
        </Button>
        <Button
          className="font-semibold text-accent-foreground"
          disabled={capturing || target === null}
          aria-label={target ? `Capture ${tabTitle(target)}` : 'Capture'}
          onClick={() => target && void take(target)}
        >
          Capture
        </Button>
      </div>
      {shortcut && (
        <p className="text-[10px] text-text-muted">
          <span className={cn('font-mono', shortcut.state === 'failed' && 'line-through')}>
            {acceleratorLabel(shortcut.accelerator, modifierLabel())}
          </span>{' '}
          · {shortcutLine(shortcut)}
        </p>
      )}
      {line && (
        <div
          role="status"
          className={cn(
            line.kind === 'abandoned' || line.kind === 'refused'
              ? 'text-danger-fg'
              : 'text-text-primary'
          )}
        >
          {line.kind === 'capturing' && (
            <div className="mb-1 h-1 overflow-hidden rounded bg-border">
              <div className="h-1 w-1/2 animate-pulse bg-accent" />
            </div>
          )}
          <span className="font-semibold">{line.text}</span>
          {line.detail && <span className="text-text-muted"> {line.detail}</span>}
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      )}
    </div>
  )
}
