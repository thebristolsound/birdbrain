import { useQuery } from '@tanstack/react-query'
import { Archive, ExternalLink, TriangleAlert } from 'lucide-react'
import type { Capture } from '@shared/types'
import { captureContentQueryOptions } from '@renderer/lib/api/captures'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
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
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3.5 py-2">
        <Archive className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">
          Side-by-side reference — archive.org&apos;s copy renders independently. Corroboration is
          your call; Birdbrain doesn&apos;t diff the two.
        </span>
      </div>

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

// The stored side of the comparison. MHTML goes through the evidence viewer
// unchanged; the pre-v11 HTML format keeps the Page tab's sandboxed srcDoc frame so
// a legacy capture is not simply blank here.
function CapturePane({ capture }: { capture: Capture }) {
  const isMhtml = capture.format === 'mhtml'
  const { data: content } = useQuery({
    ...captureContentQueryOptions(capture.id, 'html'),
    enabled: !isMhtml
  })

  if (isMhtml) return <MhtmlViewer captureId={capture.id} />
  if (!content) {
    return <div className="p-4 text-xs text-text-muted">No stored page archive available</div>
  }
  return (
    <iframe
      sandbox=""
      srcDoc={content}
      className="h-full w-full border-0 bg-white"
      title="Stored capture"
    />
  )
}
