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
 * menu's Look up in Wayback fills, so rendering it never contacts archive.org. Its
 * buttons are controls of their own, apart from the row's link.
 */
export function WaybackLinkCell({ capture, url }: { capture: Capture; url: string }) {
  const { data, error, isFetching } = useQuery(waybackLinkLookupQueryOptions(capture.id, url))
  let body
  if (isFetching) {
    body = <span>Checking…</span>
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
