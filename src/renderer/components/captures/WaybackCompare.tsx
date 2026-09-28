import { ExternalLink, TriangleAlert } from 'lucide-react'
import type { Capture } from '@shared/types'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { LegacyHtmlViewer } from '@renderer/components/captures/LegacyHtmlViewer'
import { WaybackReplayView } from '@renderer/components/captures/WaybackReplayView'
import { formatUtcDate, formatUtcTime } from '@renderer/components/captures/waybackPanelModel'
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
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-2">
            <span className="shrink-0 text-[11px] font-semibold text-amber-500">
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
          {/* Always visible, and outside the guest: the pane below is remote
              content fetched now, and nothing about it is part of the case. */}
          <div
            data-testid="wayback-nonevidence-label"
            className="flex shrink-0 items-start gap-1.5 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-200"
          >
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
            <span>
              Live remote content, loaded from archive.org now — not evidence. It is not captured,
              not hashed and not stored in this case. Pinning records the reference only.
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {active ? (
              <WaybackReplayView snapshotUrl={active.snapshotUrl} />
            ) : (
              <div
                data-testid="wayback-compare-empty"
                className="flex h-full items-center justify-center p-6 text-center text-xs text-text-faint"
              >
                Look up this URL and choose a snapshot to compare.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
  if (capture.format === 'mhtml') return <MhtmlViewer captureId={capture.id} />
  return <LegacyHtmlViewer captureId={capture.id} emptyLabel="No stored page archive available" />
}
