import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Camera, StickyNote } from 'lucide-react'
import type { RecentActivityEvent } from '@shared/types'
import { RECENT_ACTIVITY_LIMIT } from '@shared/constants'
import { recentActivityQueryOptions } from '@renderer/lib/api/cases'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'
import { getProvenanceColor } from '@renderer/components/captures/getProvenanceColor'
import { getCaseTypeStyle } from '@renderer/components/dashboard/caseTypeStyle'
import { useAppStore } from '@renderer/stores/appStore'

function eventKey(event: RecentActivityEvent): string {
  return event.kind === 'note' ? `note-${event.noteId}` : `capture-${event.captureId}`
}

function eventLabel(event: RecentActivityEvent): string {
  if (event.kind === 'note') return `Edited note — ${event.title ?? '(Untitled note)'}`
  return `Captured ${event.title ?? event.url}`
}

interface ActivityRowProps {
  event: RecentActivityEvent
  onOpen: (event: RecentActivityEvent) => void
}

function ActivityRow({ event, onOpen }: ActivityRowProps) {
  const Icon = event.kind === 'note' ? StickyNote : Camera
  const { chipClass } = getCaseTypeStyle(event.caseType)
  // Note rows carry no integrity status, but keep the dot's 6px column so
  // labels and times stay aligned down the list (prototype: transparent dot).
  const provenance = event.kind === 'capture' ? getProvenanceColor(event.lastVerifiedStatus) : null

  return (
    <button
      type="button"
      data-testid="recent-activity-row"
      onClick={() => onOpen(event)}
      className="flex h-[var(--d-row)] w-full items-center gap-2.5 border-b border-border px-[var(--d-rowpad)] text-left transition-colors last:border-b-0 hover:bg-elevated"
    >
      <Icon className="h-[13px] w-[13px] shrink-0 text-text-faint" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{eventLabel(event)}</span>
      <span
        className={`shrink-0 rounded-full border px-2 py-px text-[10px] font-medium ${chipClass}`}
      >
        {event.caseName}
      </span>
      <span
        title={provenance?.label}
        data-testid="recent-activity-provenance"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${provenance ? provenance.dot : 'bg-transparent'}`}
      />
      <span className="w-16 shrink-0 text-right text-[10px] text-text-faint">
        {formatRelativeTime(event.occurredAt)}
      </span>
    </button>
  )
}

interface RecentActivityFeedProps {
  limit?: number
}

/**
 * Cross-case activity for a returning operator (#403): the last N capture and
 * note events across every case, newest first. Rows open what they describe —
 * note rows the Notes tab with that note selected, capture rows the Captures
 * tab with that capture selected — matching the prototype's row targets.
 */
export function RecentActivityFeed({ limit = RECENT_ACTIVITY_LIMIT }: RecentActivityFeedProps) {
  const navigate = useNavigate()
  const setSelectedCaptureId = useAppStore((s) => s.setSelectedCaptureId)
  const setSelectedNoteId = useAppStore((s) => s.setSelectedNoteId)
  const { data: events = [], isPending } = useQuery(recentActivityQueryOptions(limit))

  const handleOpen = useCallback(
    (event: RecentActivityEvent) => {
      if (event.kind === 'note') {
        setSelectedNoteId(event.noteId)
        navigate({ to: '/cases/$caseId/notes', params: { caseId: event.caseId } })
        return
      }
      setSelectedCaptureId(event.captureId)
      navigate({ to: '/cases/$caseId/captures', params: { caseId: event.caseId } })
    },
    [navigate, setSelectedCaptureId, setSelectedNoteId]
  )

  return (
    <section data-testid="recent-activity-feed" className="px-8 pb-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-display text-[10px] font-semibold uppercase tracking-[0.06em] text-text-faint">
            Recent activity
          </h2>
          <div className="h-px flex-1 bg-border-strong" />
          <span className="text-[10px] text-text-faint">last {limit} events · all cases</span>
        </div>

        {isPending ? null : events.length === 0 ? (
          <div
            data-testid="recent-activity-empty"
            className="flex items-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-canvas px-3.5 py-3 text-xs text-text-muted"
          >
            No activity yet — captures and note edits land here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {events.map((event) => (
              <ActivityRow key={eventKey(event)} event={event} onOpen={handleOpen} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
