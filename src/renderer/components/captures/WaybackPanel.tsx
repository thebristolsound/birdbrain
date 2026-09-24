import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Pin,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import type { Capture, WaybackRef, WaybackSnapshot } from '@shared/types'
import {
  waybackLookupQueryOptions,
  waybackPinsQueryOptions,
  useWaybackMutations
} from '@renderer/lib/api/wayback'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import {
  buildWaybackList,
  calendarHint,
  DAY_OF_WEEK_NAMES,
  footerLine,
  formatRangeLabel,
  monthGrid,
  monthLabel,
  nextMonth,
  presetLabel,
  presetRange,
  previousMonth,
  rangeFromDays,
  summaryLine,
  WAYBACK_PANEL_WIDTH_PX,
  WAYBACK_PRESET_IDS,
  type StatusBand,
  type WaybackPresetId,
  type WaybackRange,
  type WaybackRowView
} from '@renderer/components/captures/waybackPanelModel'

interface Props {
  capture: Capture
  onClose: () => void
}

const BAND_CLASS: Record<StatusBand, string> = {
  ok: 'text-emerald-500',
  redirect: 'text-amber-500',
  error: 'text-red-400'
}

/**
 * The archive.org slide-out: lookup, filters, calendar range, presets and the
 * paginated snapshot list. Selecting a row loads it into the compare pane beside
 * the capture; pinning it stores a corroboration reference against the capture.
 *
 * Nothing here downloads or stores archived content. A pin records where a snapshot
 * was and when archive.org says it was taken — it never converts replayed content
 * into a Capture.
 */
export function WaybackPanel({ capture, onClose }: Props) {
  const lookup = useQuery(waybackLookupQueryOptions(capture.id))
  const pins = useQuery(waybackPinsQueryOptions(capture.id))
  const { pin, unpin } = useWaybackMutations(capture.id)
  const selection = useAppStore((s) => s.waybackSelection)
  const setSelection = useAppStore((s) => s.setWaybackSelection)

  const [query, setQuery] = useState('')
  const [preset, setPreset] = useState<WaybackPresetId>('all')
  const [customRange, setCustomRange] = useState<WaybackRange | null>(null)
  const [page, setPage] = useState(0)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [pendingFromMs, setPendingFromMs] = useState<number | null>(null)
  const [pendingRange, setPendingRange] = useState<WaybackRange | null>(null)
  const [month, setMonth] = useState(() => {
    const ms = Date.parse(capture.timestamp)
    const date = new Date(Number.isNaN(ms) ? Date.now() : ms)
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
  })

  const result = lookup.data
  const snapshots = useMemo(() => result?.snapshots ?? [], [result])
  const range = customRange ?? presetRange(preset, capture.timestamp)

  const list = useMemo(
    () =>
      buildWaybackList({
        snapshots,
        closestIndex: result?.closestIndex ?? null,
        captureTimestamp: capture.timestamp,
        query,
        range,
        page
      }),
    [snapshots, result?.closestIndex, capture.timestamp, query, range, page]
  )

  const pinnedUrls = useMemo(
    () => new Set((pins.data ?? []).map((ref) => ref.snapshotUrl)),
    [pins.data]
  )
  const refByUrl = useMemo(() => {
    const map = new Map<string, WaybackRef>()
    for (const ref of pins.data ?? []) map.set(ref.snapshotUrl, ref)
    return map
  }, [pins.data])

  // The compare pane opens on the closest snapshot as soon as one exists, so the
  // operator is never looking at an empty right-hand pane with a full list beside
  // it. A selection the operator made themselves is never overwritten.
  useEffect(() => {
    if (snapshots.length === 0) return
    if (selection && selection.captureId === capture.id) return
    const closest = result?.closestIndex !== null ? snapshots[result?.closestIndex ?? 0] : undefined
    const chosen = closest ?? snapshots[0]
    setSelection({
      captureId: capture.id,
      snapshotUrl: chosen.snapshotUrl,
      timestamp: chosen.timestamp
    })
  }, [snapshots, result?.closestIndex, capture.id, selection, setSelection])

  const open = (url: string): void => {
    openCaptureExternal(url).catch((cause) => {
      notify.error("Couldn't open the link in your browser", { cause })
    })
  }

  const selectSnapshot = (snapshot: WaybackSnapshot): void => {
    setSelection({
      captureId: capture.id,
      snapshotUrl: snapshot.snapshotUrl,
      timestamp: snapshot.timestamp
    })
  }

  const togglePin = (snapshot: WaybackSnapshot): void => {
    const existing = refByUrl.get(snapshot.snapshotUrl)
    if (existing) {
      unpin.mutate(existing.id)
      return
    }
    if (!result) return
    pin.mutate({ captureId: capture.id, snapshot, checkedAt: result.checkedAt })
  }

  const applyPreset = (id: WaybackPresetId): void => {
    setPreset(id)
    setCustomRange(null)
    setPage(0)
    setCalendarOpen(false)
  }

  const pickDay = (ms: number): void => {
    if (pendingFromMs === null) {
      setPendingFromMs(ms)
      setPendingRange(rangeFromDays(ms, ms))
      return
    }
    setPendingRange(rangeFromDays(pendingFromMs, ms))
    setPendingFromMs(null)
  }

  const applyCalendar = (): void => {
    if (pendingRange) {
      setCustomRange(pendingRange)
      setPage(0)
    }
    setPendingFromMs(null)
    setCalendarOpen(false)
  }

  const jumpToClosest = (): void => {
    if (list.closestPage === null) return
    setPage(list.closestPage)
    setCalendarOpen(false)
  }

  const days = monthGrid({
    year: month.year,
    month: month.month,
    range: pendingRange ?? range,
    captureTimestamp: capture.timestamp,
    pendingFromMs
  })

  return (
    <aside
      data-testid="wayback-panel"
      style={{ width: WAYBACK_PANEL_WIDTH_PX, minWidth: WAYBACK_PANEL_WIDTH_PX }}
      className="flex shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3.5 py-3">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
          archive.org
        </span>
        <span
          data-testid="wayback-summary"
          className="min-w-0 flex-1 truncate text-[11px] text-text-faint"
        >
          {summaryLine({
            snapshots,
            closestIndex: result?.closestIndex ?? null,
            captureTimestamp: capture.timestamp,
            hasResult: !!result
          })}
        </span>
        <button
          type="button"
          // Same testid the flat tab's button carried: this is the same
          // affordance, moved into the panel header (#401).
          data-testid="wayback-lookup-btn"
          title={result ? 'Look up again' : 'Look up'}
          onClick={() => void lookup.refetch()}
          disabled={lookup.isFetching}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-accent hover:bg-accent-subtle disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${lookup.isFetching ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          data-testid="wayback-panel-close"
          title="Close archive panel"
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-muted hover:bg-elevated"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <p className="shrink-0 border-b border-border px-3.5 py-2 text-[11px] leading-relaxed text-text-faint">
        Independent record of this URL. Corroboration only — looking up discloses the URL to
        archive.org.
      </p>

      <div className="relative flex shrink-0 flex-col gap-2 border-b border-border px-3.5 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
            placeholder="Filter snapshots by date, status or type…"
            aria-label="Filter snapshots"
            className="w-full rounded-md border border-border bg-canvas py-1.5 pl-7 pr-2.5 text-xs text-text-primary outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="wayback-calendar-toggle"
            aria-expanded={calendarOpen}
            onClick={() => setCalendarOpen((v) => !v)}
            className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-elevated px-2.5 text-xs text-text-primary ${
              calendarOpen ? 'border-accent' : 'border-border'
            }`}
          >
            <Calendar className="h-3 w-3 text-text-muted" />
            <span>{formatRangeLabel(range)}</span>
            <ChevronDown
              className={`h-3 w-3 text-text-muted transition-transform ${
                calendarOpen ? 'rotate-180' : ''
              }`}
            />
          </button>
          {WAYBACK_PRESET_IDS.map((id) => {
            const active = customRange === null && preset === id
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => applyPreset(id)}
                className={`h-6 shrink-0 rounded-full border px-2.5 text-[11px] ${
                  active
                    ? 'border-accent/35 bg-accent-subtle font-semibold text-accent'
                    : 'border-border bg-surface font-medium text-text-secondary'
                }`}
              >
                {presetLabel(id, capture.timestamp)}
              </button>
            )
          })}
          <button
            type="button"
            data-testid="wayback-jump-closest"
            onClick={jumpToClosest}
            disabled={list.closestPage === null}
            className="flex shrink-0 items-center gap-1 px-0.5 text-[11px] text-accent disabled:opacity-40"
          >
            <Crosshair className="h-3 w-3" />
            Closest
          </button>
        </div>

        {calendarOpen && (
          <div
            data-testid="wayback-calendar"
            className="absolute left-3.5 top-[calc(100%-4px)] z-[60] w-[272px] rounded-xl border border-border-strong bg-card p-3 shadow-xl"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth(previousMonth(month.year, month.month))}
                className="grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-elevated"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-bold text-text-primary">
                {monthLabel(month.year, month.month)}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setMonth(nextMonth(month.year, month.month))}
                className="grid h-6 w-6 place-items-center rounded-md text-text-muted hover:bg-elevated"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7 gap-0.5">
              {DAY_OF_WEEK_NAMES.map((name) => (
                <span
                  key={name}
                  className="grid h-5 place-items-center text-[11px] font-semibold text-text-faint"
                >
                  {name}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((cell, index) =>
                cell.day === null || cell.ms === null ? (
                  <span key={`blank-${index}`} className="h-7" />
                ) : (
                  <button
                    key={cell.ms}
                    type="button"
                    onClick={() => pickDay(cell.ms as number)}
                    aria-label={`${monthLabel(month.year, month.month)} ${cell.day}`}
                    className={`grid h-7 place-items-center rounded-md text-xs ${
                      cell.isEndpoint || cell.isCaptureDay
                        ? 'bg-accent font-bold text-white'
                        : cell.inRange
                          ? 'bg-accent-subtle text-text-primary'
                          : 'text-text-faint'
                    }`}
                  >
                    {cell.day}
                  </button>
                )
              )}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
              <span className="text-[11px] text-text-muted">
                {pendingFromMs !== null
                  ? 'Pick the end of the range'
                  : calendarHint({ preset, customRange, captureTimestamp: capture.timestamp })}
              </span>
              <button
                type="button"
                data-testid="wayback-calendar-apply"
                onClick={applyCalendar}
                className="text-xs font-semibold text-accent"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {lookup.isFetching && (
          <div data-testid="wayback-loading" className="p-7 text-center text-xs text-text-muted">
            Querying the Wayback Machine…
          </div>
        )}
        {lookup.isError && !lookup.isFetching && (
          <div data-testid="wayback-error" className="p-7 text-center text-xs text-red-400">
            Lookup failed:{' '}
            {lookup.error instanceof Error ? lookup.error.message : String(lookup.error)}
          </div>
        )}
        {!lookup.isFetching && !lookup.isError && !result && (
          <div data-testid="wayback-idle" className="p-7 text-center text-xs text-text-faint">
            Look up this URL to see archive.org&apos;s snapshots of it.
          </div>
        )}
        {!lookup.isFetching && !lookup.isError && result && list.rows.length === 0 && (
          <div data-testid="wayback-empty" className="p-7 text-center text-xs text-text-faint">
            {snapshots.length === 0
              ? 'No archive.org snapshots found for this URL.'
              : 'No snapshots in this range.'}
          </div>
        )}
        {!lookup.isFetching &&
          list.rows.map((row) => (
            <SnapshotRow
              key={row.key}
              row={row}
              isSelected={selection?.snapshotUrl === row.key}
              isPinned={pinnedUrls.has(row.key)}
              onSelect={() => selectSnapshot(row.snapshot)}
              onTogglePin={() => togglePin(row.snapshot)}
              onOpen={() => open(row.key)}
            />
          ))}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3.5 py-2.5">
        <span data-testid="wayback-footer" className="min-w-0 text-[11px] text-text-muted">
          {footerLine({
            totalCount: list.totalCount,
            inRangeCount: list.inRangeCount,
            checkedAt: result?.checkedAt ?? null,
            now: Date.now()
          })}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          data-testid="wayback-prev-page"
          onClick={() => setPage(Math.max(0, list.page - 1))}
          disabled={list.page === 0}
          className="flex items-center gap-1 text-xs text-accent disabled:text-text-faint"
        >
          <ChevronLeft className="h-3 w-3" />
          Prev
        </button>
        <button
          type="button"
          data-testid="wayback-next-page"
          onClick={() => setPage(Math.min(list.pageCount - 1, list.page + 1))}
          disabled={list.page >= list.pageCount - 1}
          className="flex items-center gap-1 text-xs text-accent disabled:text-text-faint"
        >
          Next
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </aside>
  )
}

function SnapshotRow({
  row,
  isSelected,
  isPinned,
  onSelect,
  onTogglePin,
  onOpen
}: {
  row: WaybackRowView
  isSelected: boolean
  isPinned: boolean
  onSelect: () => void
  onTogglePin: () => void
  onOpen: () => void
}) {
  return (
    <div
      data-testid="wayback-snapshot-row"
      role="button"
      tabIndex={0}
      aria-current={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`flex cursor-pointer flex-col gap-0.5 border-b border-l-2 border-border px-3.5 py-2 ${
        isSelected ? 'border-l-accent bg-accent-subtle' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-medium text-text-primary">{row.date}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{row.time} UTC</span>
        {row.isClosest && (
          <span className="shrink-0 rounded bg-accent px-1.5 py-px text-[10px] font-semibold text-white">
            closest
          </span>
        )}
        <div className="min-w-[4px] flex-1" />
        <button
          type="button"
          aria-pressed={isPinned}
          aria-label={isPinned ? 'Unpin snapshot' : 'Pin snapshot'}
          title={isPinned ? 'Unpin from case' : 'Pin to case'}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin()
          }}
          className={`grid h-5 w-5 shrink-0 place-items-center rounded ${
            isPinned ? 'text-accent' : 'text-text-faint hover:text-text-primary'
          }`}
        >
          <Pin className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Open snapshot"
          title="Open snapshot at archive.org"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-muted hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {row.snapshot.mimeType && (
          <span className="shrink-0 font-mono text-[11px] text-text-faint">
            {row.snapshot.mimeType}
          </span>
        )}
        {row.snapshot.statusCode !== undefined && row.band && (
          <span className={`shrink-0 font-mono text-[11px] font-semibold ${BAND_CLASS[row.band]}`}>
            {row.snapshot.statusCode}
          </span>
        )}
        {row.delta && (
          <span
            className={`min-w-0 truncate text-[11px] ${
              row.isClosest ? 'text-text-primary' : 'text-text-muted'
            }`}
          >
            {row.delta}
          </span>
        )}
      </div>
    </div>
  )
}
