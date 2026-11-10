import { createElement, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Activity, Loader2, Puzzle, type LucideIcon } from 'lucide-react'
import type { EgressSetting } from '@shared/types'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui'
import { useAppStore } from '@renderer/stores/appStore'
import { settingsQueryOptions } from '@renderer/lib/api/settings'
import { vpnStatusQueryOptions } from '@renderer/lib/api/egress'
import { recaptureQueueQueryOptions } from '@renderer/lib/api/recapture'
import { cn } from '@renderer/lib/utils'
import { egressIcon } from '@renderer/components/status/egressText'
import {
  statusModel,
  type Severity,
  type Signal
} from '@renderer/components/status/statusGroupModel'
import { CaptureLog } from '@renderer/components/status/CaptureHealth'

// The top bar's one status control (docs/design-handoff/2026-11-08-top-bar/, Option B): the
// Egress, the extension connection and Capture Health as three faint dots in a neutral pill.
// Nothing in the chrome paints a status background. Off nominal, the worst signal's icon joins
// its dot and both take that signal's colour, with one short word; the pill itself stays
// unfilled. The button's accessible name is the whole state in one sentence, and a polite live
// region announces severity changes only, never each count. Click opens the three rows.

const FG: Record<Severity, string> = {
  nominal: 'text-text-faint',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg'
}
const DOT: Record<Severity, string> = {
  nominal: 'bg-text-faint',
  warning: 'bg-warning-fg',
  danger: 'bg-danger-fg'
}

const UNREAD_EGRESS: EgressSetting = { kind: 'unavailable' }

export function StatusGroup() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const connectedToExtension = useAppStore((s) => s.connectedToExtension)
  const captureStats = useAppStore((s) => s.captureStats)
  const sessionActive = useAppStore((s) => s.sessionActive)
  const { data: settings, isError: settingsFailed } = useQuery(settingsQueryOptions)
  const egress = settings?.egress
  // A failed settings read leaves the Egress unknown, with the unknown Egress's icon.
  const egressReadFailed = settingsFailed && !egress
  const iconEgress = egress ?? (egressReadFailed ? UNREAD_EGRESS : undefined)
  const direct = egress?.kind === 'direct'
  const { data: vpn } = useQuery({ ...vpnStatusQueryOptions, enabled: direct })
  const vpnSeen = direct ? vpn?.vpnSeen : undefined
  // The button shows queued background captures while closed. A job that starts or ends emits a
  // recapture event, so the queue is re-read on each one, then polled while something is pending.
  const latestRecaptureEvent = useAppStore((s) =>
    s.captureEvents.find((event) => event.source === 'recapture')
  )
  const { data: queue, refetch: refetchQueue } = useQuery({
    ...recaptureQueueQueryOptions,
    refetchInterval: (query) => ((query.state.data?.pending ?? 0) > 0 ? 2000 : false)
  })
  useEffect(() => {
    if (latestRecaptureEvent) void refetchQueue()
  }, [latestRecaptureEvent, refetchQueue])
  const pending = queue?.pending ?? 0

  const model = statusModel({
    egress,
    egressReadFailed,
    vpnSeen,
    connectedToExtension,
    successCount: captureStats.successCount,
    failCount: captureStats.failCount,
    sessionActive,
    pending
  })
  const [extension, egressSignal, health] = model.signals

  // Announce a change of severity, not a change of count: the stored count ticks on every
  // Capture and would be unbearable read aloud.
  const [announcement, setAnnouncement] = useState('')
  const lastSeverity = useRef(model.severity)
  useEffect(() => {
    if (lastSeverity.current === model.severity) return
    lastSeverity.current = model.severity
    setAnnouncement(model.summary)
  }, [model.severity, model.summary])

  const worstIcon: LucideIcon | null =
    model.worst?.key === 'egress' && iconEgress
      ? egressIcon(iconEgress, vpnSeen)
      : model.worst?.key === 'health'
        ? Activity
        : null

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setShowLog(false)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="status-group"
          data-severity={model.severity}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={model.summary}
          title={model.summary}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-2 rounded-full border border-border-strong px-2.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-elevated',
            open && 'bg-elevated'
          )}
        >
          <span className="inline-flex items-center gap-1" aria-hidden="true">
            <Dot severity={extension.severity} />
            <Dot severity={egressSignal.severity} />
            <Dot severity={health.severity} />
          </span>
          {worstIcon &&
            model.worst &&
            createElement(worstIcon, {
              className: cn('h-3 w-3 shrink-0', FG[model.worst.severity]),
              'aria-hidden': true
            })}
          {/* The e2e for the VPN warning reads the Egress text here (vpn-warning.spec.ts). */}
          <span
            data-testid="egress-indicator"
            title={`Egress: ${egressSignal.text}`}
            className="sr-only"
          >
            {egressSignal.text}
          </span>
          {(model.count !== null || model.word) && (
            <span className="whitespace-nowrap text-text-secondary">
              {model.count !== null && <span className="tabular-nums">{model.count}</span>}
              {model.count !== null && model.word && <span className="text-text-faint"> · </span>}
              {/* The word shows from xl; below that the icon and dot carry the state. */}
              {model.word && (
                <span className={cn(model.count === null && 'sr-only xl:not-sr-only')}>
                  {model.word}
                </span>
              )}
            </span>
          )}
          {model.queued && (
            <span
              data-testid="recapture-pending-indicator"
              title={model.queued}
              className="inline-flex items-center gap-1 tabular-nums text-text-secondary"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {pending}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <PopoverContent align="end" sideOffset={6} aria-label="Status" className="w-[300px] p-0">
        <div className="px-2.5 py-2 font-display text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          Status
        </div>
        <Row icon={Puzzle} signal={extension} />
        <Row icon={iconEgress ? egressIcon(iconEgress, vpnSeen) : Activity} signal={egressSignal} />
        <Row icon={Activity} signal={health} />
        <div className="flex gap-2 border-t border-border px-2.5 py-2">
          <Button
            variant="outline"
            size="xs"
            aria-expanded={showLog}
            onClick={() => setShowLog((v) => !v)}
          >
            Capture log
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setOpen(false)
              void navigate({ to: '/settings', search: { section: 'egress' } })
            }}
          >
            Egress settings
          </Button>
        </div>
        {showLog && (
          <div className="border-t border-border">
            <CaptureLog />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Dot({ severity }: { severity: Severity }) {
  return <span className={cn('h-1.5 w-1.5 rounded-full', DOT[severity])} />
}

function Row({ icon, signal }: { icon: LucideIcon; signal: Signal }) {
  return (
    <div
      data-testid={`status-row-${signal.key}`}
      className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11px]"
    >
      {createElement(icon, { className: 'h-3.5 w-3.5 text-text-muted', 'aria-hidden': true })}
      <span className="text-text-primary">{signal.name}</span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap',
          signal.severity === 'nominal' ? 'text-text-secondary' : FG[signal.severity]
        )}
      >
        <Dot severity={signal.severity} />
        {signal.text}
      </span>
    </div>
  )
}
