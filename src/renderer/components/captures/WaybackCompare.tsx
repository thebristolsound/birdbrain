import { useQuery } from '@tanstack/react-query'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { Capture } from '@shared/types'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { waybackLookupQueryOptions } from '@renderer/lib/api/wayback'
import { Button } from '@renderer/components/ui'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { LegacyHtmlViewer } from '@renderer/components/captures/LegacyHtmlViewer'
import { WaybackReplayView } from '@renderer/components/captures/WaybackReplayView'
import {
  formatUtcDate,
  formatUtcTime,
  WAYBACK_DISCLOSURE_HINT,
  WAYBACK_NONEVIDENCE_HINT
} from '@renderer/components/captures/waybackPanelModel'
import { formatSnapshotDelta } from '@shared/wayback'

interface Props {
  capture: Capture
}

/**
 * Side-by-side: the operator's stored capture on the left, the selected archive.org
 * snapshot replayed live on the right.
 *
 * Both panes are live guests, which is the point of the arrangement — the left one
 * renders the stored MHTML through the evidence viewer rather than a screenshot of
 * it, so the two panes are the same kind of thing and a difference between them is a
 * difference between the documents, not between a document and a picture of one.
 *
 * Birdbrain does not diff the panes and the header says so. Any comparison is the
 * operator's reading, recorded in their notes; the tool asserts nothing about it.
 */
export function WaybackCompare({ capture }: Props) {
  const selection = useAppStore((s) => s.waybackSelection)
  const active = selection && selection.captureId === capture.id ? selection : null

  const openSnapshot = (): void => {
    if (!active) return
    openCaptureExternal(active.snapshotUrl).catch((cause) => {
      notify.error("Couldn't open the link in your browser", { cause })
    })
  }

  const delta = active ? formatSnapshotDelta(active.timestamp, capture.timestamp) : null

  return (
    <div data-testid="wayback-compare" className="flex h-full w-full flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        <div className="flex min-w-[300px] flex-1 flex-col overflow-hidden border-r border-border">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent-subtle px-3 py-2">
            <span className="shrink-0 text-[11px] font-semibold text-accent">Your capture</span>
            <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-text-muted">
              {formatUtcDate(capture.timestamp)} {formatUtcTime(capture.timestamp)} UTC
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <CapturePane capture={capture} />
          </div>
        </div>

        <div className="flex min-w-[300px] flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
            <span
              data-testid="wayback-snapshot-label"
              title={WAYBACK_NONEVIDENCE_HINT}
              className="shrink-0 text-[11px] font-semibold text-text-secondary"
            >
              archive.org snapshot
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-text-muted">
              {active
                ? `${formatUtcDate(active.timestamp)} ${formatUtcTime(active.timestamp)} UTC${
                    delta ? ` · ${delta}` : ''
                  }`
                : 'No snapshot selected'}
            </span>
            <button
              type="button"
              data-testid="wayback-open-external"
              onClick={openSnapshot}
              disabled={!active}
              className="flex h-[22px] shrink-0 items-center gap-1.5 rounded border border-border px-2 text-[11px] text-text-secondary disabled:opacity-40"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {active ? (
              <WaybackReplayView snapshotUrl={active.snapshotUrl} />
            ) : (
              <div
                data-testid="wayback-compare-empty"
                className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs text-text-faint"
              >
                <EmptyPane captureId={capture.id} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Reads the panel's lookup query by its key, so a lookup started here fills the panel's list
// and one started from the panel resolves this state.
function EmptyPane({ captureId }: { captureId: string }) {
  const lookup = useQuery(waybackLookupQueryOptions(captureId))
  const result = lookup.data

  if (result && !lookup.isFetching) {
    return result.snapshots.length === 0
      ? 'No archive.org snapshots found for this URL.'
      : 'Choose a snapshot from the list to compare.'
  }

  return (
    <Button
      variant="outline"
      data-testid="wayback-compare-lookup"
      title={WAYBACK_DISCLOSURE_HINT}
      onClick={() => void lookup.refetch()}
      disabled={lookup.isFetching}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${lookup.isFetching ? 'animate-spin' : ''}`} />
      {lookup.isFetching ? 'Querying the Wayback Machine…' : 'Look up on archive.org'}
    </Button>
  )
}

// The stored side of the comparison. Both formats go through an evidence viewer on
// a no-network partition: MHTML through MhtmlViewer, the pre-v11 HTML format through
// LegacyHtmlViewer, which replaced the Page tab's sandboxed srcDoc frame in #906.
// The timing is what made this mount the worse of the two: it renders when the
// operator opens the Wayback tab, before they have asked for any archive.org
// lookup, so a subresource fetched from it would be a disclosure the panel's own
// consent model says has not happened yet.
function CapturePane({ capture }: { capture: Capture }) {
  if (capture.format === 'mhtml')
    return <MhtmlViewer captureId={capture.id} caseId={capture.caseId} />
  return <LegacyHtmlViewer captureId={capture.id} emptyLabel="No stored page archive available" />
}
