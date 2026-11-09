import { useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import { useNavigate } from '@tanstack/react-router'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { getCapture } from '@renderer/lib/api/captures'
import { copyCaptureUrl } from '@renderer/components/captures/useCopyCaptureUrl'
import { notify } from '@renderer/lib/notify'
import { ContactStoppedError } from '@renderer/lib/vpnWarning'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { presets } from '@renderer/lib/motion'
import type { CaptureEvent } from '@shared/types'
import { Button } from '@renderer/components/ui'
import {
  recaptureQueueQueryOptions,
  testCaptureHttp,
  testCapturePipeline,
  enqueueEventRecapture
} from '@renderer/lib/api/recapture'

function EventIcon({ type }: { type: CaptureEvent['type'] }) {
  switch (type) {
    case 'stored':
      return <CheckCircle2 className="h-3.5 w-3.5 text-success-fg" />
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-danger-fg" />
    case 'skipped':
      return <AlertTriangle className="h-3.5 w-3.5 text-warning-fg" />
    case 'received':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
  }
}

function EventRow({ event }: { event: CaptureEvent }) {
  const navigate = useNavigate()
  const time = new Date(event.timestamp).toLocaleTimeString()
  let host = event.url
  try {
    host = new URL(event.url).host
  } catch {
    /* A pipeline error may carry an invalid URL. */
  }
  async function actOnCapture(recapture: boolean) {
    if (!event.captureId) return
    try {
      const capture = await getCapture(event.captureId)
      if (!capture) {
        notify.warn('This capture is no longer available')
        return
      }
      if (recapture) {
        const result = await enqueueEventRecapture(capture.caseId, capture.id)
        if (result.rejected.length) notify.warn(`Recapture rejected: ${result.rejected[0].reason}`)
        else notify.success(`Recapture queued — ${result.accepted} capture`)
      } else {
        navigate({
          to: '/cases/$caseId/captures',
          params: { caseId: capture.caseId },
          search: { captureId: capture.id }
        })
      }
    } catch (cause) {
      // Stopped at the VPN warning: nothing was sent, and nothing failed.
      if (cause instanceof ContactStoppedError) return
      notify.error(recapture ? "Couldn't queue recapture" : "Couldn't open capture", { cause })
    }
  }
  const urlShort = event.url.length > 40 ? event.url.slice(0, 40) + '...' : event.url

  return (
    <EntityContextMenu
      target={{
        kind: 'event',
        host,
        hasCapture: !!event.captureId,
        actions: {
          open: () => void actOnCapture(false),
          copyUrl: () => void copyCaptureUrl(event.url),
          recapture: () => void actOnCapture(true),
          clear: () =>
            useAppStore.setState((state) => ({
              captureEvents: state.captureEvents.filter((item) => item !== event)
            }))
        }
      }}
    >
      <div className="flex items-start gap-2 px-3 py-1.5 text-[11px]">
        <EventIcon type={event.type} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-text-secondary">{urlShort}</div>
          <div className="flex gap-2 text-text-muted">
            <span>{event.source}</span>
            <span>{time}</span>
            {event.durationMs !== undefined && <span>{event.durationMs}ms</span>}
            {event.error && <span className="text-danger-fg">{event.error}</span>}
            {event.skipReason && <span className="text-text-secondary">{event.skipReason}</span>}
            {event.screenshotWarning && (
              <span className="text-warning-fg">{event.screenshotWarning}</span>
            )}
            {event.warning && <span className="text-warning-fg">{event.warning}</span>}
          </div>
        </div>
      </div>
    </EntityContextMenu>
  )
}

// The capture log, the body of what was the Capture Health pill's popover: the counts, the last
// error, the event list with its context menu, and the two pipeline tests. The status group
// (StatusGroup.tsx) shows it inside its own popover behind Capture log.
export function CaptureLog() {
  const [testResult, setTestResult] = useState<{
    success: boolean
    durationMs: number
    error?: string
  } | null>(null)
  const [testing, setTesting] = useState(false)
  const captureEvents = useAppStore((s) => s.captureEvents)
  const captureStats = useAppStore((s) => s.captureStats)
  const clearCaptureEvents = useAppStore((s) => s.clearCaptureEvents)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const { data: queue } = useQuery({ ...recaptureQueueQueryOptions, refetchInterval: 2000 })

  async function runTest(
    run: () => Promise<{ success: boolean; durationMs: number; error?: string }>
  ) {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await run())
    } catch (err) {
      setTestResult({ success: false, durationMs: 0, error: String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div data-testid="capture-log">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-text-secondary">Capture log</span>
        <Button variant="ghost" size="xs" onClick={clearCaptureEvents}>
          Clear
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${connectedToExtension ? 'bg-success-fg' : 'bg-text-faint'}`}
          />
          <span className="text-text-muted">
            {connectedToExtension ? 'Extension' : 'No extension'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${sessionActive ? 'bg-danger-fg' : 'bg-text-faint'}`}
          />
          <span className="text-text-muted">{sessionActive ? 'Recording' : 'Idle'}</span>
        </div>
        <div className="text-text-muted">
          {captureStats.successCount} ok · {captureStats.failCount} failed ·{' '}
          {captureStats.skipCount} skipped
        </div>
        {queue && queue.pending > 0 && (
          <span data-testid="recapture-pending-badge" className="text-text-muted">
            {queue.pending} background capture{queue.pending === 1 ? '' : 's'} pending
          </span>
        )}
      </div>

      {captureStats.lastError && (
        <div className="border-b border-border px-3 py-2">
          <div className="text-[10px] font-medium text-danger-fg">Last error</div>
          <div className="text-[11px] text-text-muted">{captureStats.lastError.message}</div>
          <div className="text-[10px] text-text-faint">
            {new Date(captureStats.lastError.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}

      <div className="max-h-60 overflow-y-auto">
        {captureEvents.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-faint">
            No capture activity yet
          </div>
        ) : (
          <AnimatePresence>
            {captureEvents.map((event, i) => (
              <motion.div key={`${event.timestamp}-${event.type}-${i}`} {...presets.listItem}>
                <EventRow event={event} />
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="flex gap-2 border-t border-border px-3 py-2">
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={() => void runTest(testCapturePipeline)}
          disabled={testing}
        >
          {testing ? 'Testing…' : 'Test pipeline'}
        </Button>
        <Button
          variant="outline"
          size="xs"
          className="flex-1"
          onClick={() => void runTest(testCaptureHttp)}
          disabled={testing}
        >
          {testing ? 'Testing…' : 'Test HTTP'}
        </Button>
      </div>

      {testResult && (
        <div
          className={`px-3 py-2 text-[11px] ${testResult.success ? 'text-success-fg' : 'text-danger-fg'}`}
        >
          {testResult.success
            ? `Pipeline OK, verified in ${testResult.durationMs}ms`
            : `Pipeline failed: ${testResult.error}`}
        </div>
      )}
    </div>
  )
}
