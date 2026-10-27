import { useQuery } from '@tanstack/react-query'
import type { Capture, WaybackSnapshot } from '@shared/types'
import { waybackLinkLookupQueryOptions } from '@renderer/lib/api/wayback'
import {
  copySnapshotUrl,
  openSnapshot,
  useCaptureSnapshot
} from '@renderer/components/captures/linkWayback'
import {
  closestLinkSnapshot,
  linkLookupSummary
} from '@renderer/components/captures/waybackLinkModel'
import type { BatchCellState } from '@renderer/components/captures/useWaybackLinkBatch'

const ACTION_CLASS =
  'rounded px-1 text-accent hover:bg-accent-subtle focus-visible:outline-2 focus-visible:outline-ring'

function SnapshotActions({ caseId, snapshot }: { caseId: string; snapshot: WaybackSnapshot }) {
  const captureSnapshot = useCaptureSnapshot(caseId)
  const { snapshotUrl } = snapshot
  return (
    <>
      <button
        type="button"
        data-testid="links-wayback-open"
        className={ACTION_CLASS}
        onClick={() => openSnapshot(snapshotUrl)}
      >
        Open at archive.org
      </button>
      <button
        type="button"
        data-testid="links-wayback-copy"
        className={ACTION_CLASS}
        onClick={() => copySnapshotUrl(snapshotUrl)}
      >
        Copy snapshot URL
      </button>
      <button
        type="button"
        data-testid="links-wayback-capture"
        className={ACTION_CLASS}
        onClick={() => captureSnapshot(snapshotUrl)}
      >
        Capture snapshot
      </button>
    </>
  )
}

/**
 * A Links tab row's Wayback answer (#1737, plan S6). It only reads the cache the link
 * menu's Look up in Wayback and a batch (#1738) fill, and the batch's state for its
 * address, so rendering it never contacts archive.org. Its buttons are controls of their
 * own, apart from the row's link.
 */
export function WaybackLinkCell({
  capture,
  url,
  batch
}: {
  capture: Capture
  url: string
  batch?: BatchCellState
}) {
  const { data, error, isFetching, dataUpdatedAt, errorUpdatedAt } = useQuery(
    waybackLinkLookupQueryOptions(capture.id, url)
  )
  // A batch failure lives outside the cache, so the latest of it and the cache's own
  // answer or error is the one shown.
  const batchFailed =
    batch?.state === 'failed' && batch.at >= Math.max(dataUpdatedAt, errorUpdatedAt) ? batch : null
  let body
  if (isFetching || batch?.state === 'checking') {
    body = <span>Checking…</span>
  } else if (batchFailed) {
    body = <span className="text-danger-fg">{batchFailed.error}</span>
  } else if (error) {
    body = <span className="text-danger-fg">{error.message}</span>
  } else if (!data) {
    body = <span>Not checked</span>
  } else {
    const closest = closestLinkSnapshot(data)
    body = (
      <>
        <span>{linkLookupSummary(data, capture.timestamp)}</span>
        {closest && <SnapshotActions caseId={capture.caseId} snapshot={closest} />}
      </>
    )
  }
  return (
    <span
      data-testid="links-wayback"
      className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-text-faint"
    >
      <span className="font-semibold text-text-muted">Wayback:</span>
      {body}
    </span>
  )
}
