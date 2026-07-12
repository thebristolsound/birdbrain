import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Pin, PinOff, RefreshCw } from 'lucide-react'
import type { Capture, WaybackSnapshot } from '@shared/types'
import {
  archiveLookupQueryOptions,
  archivePinsQueryOptions,
  useArchiveMutations
} from '@renderer/lib/queries'
import { openExternal } from '@renderer/lib/api/system'

interface Props {
  capture: Capture
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function ArchiveTab({ capture }: Props) {
  const lookup = useQuery(archiveLookupQueryOptions(capture.id))
  const pins = useQuery(archivePinsQueryOptions(capture.id))
  const { pin, unpin } = useArchiveMutations(capture.id)

  const result = lookup.data
  const pinnedUrls = new Set((pins.data ?? []).map((r) => r.snapshotUrl))

  const open = (url: string) => void openExternal(url)

  return (
    <div className="h-full overflow-y-auto p-5 text-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-faint">
            Wayback Machine
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            archive.org&apos;s independent record of this URL. Corroboration only — looking up
            discloses the URL to archive.org.
          </p>
        </div>
        <button
          type="button"
          data-testid="archive-lookup-btn"
          onClick={() => void lookup.refetch()}
          disabled={lookup.isFetching}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent-subtle disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${lookup.isFetching ? 'animate-spin' : ''}`} />
          {result ? 'Look up again' : 'Look up'}
        </button>
      </div>

      {(pins.data?.length ?? 0) > 0 && (
        <section className="mb-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-faint">
            Pinned
          </h4>
          <ul className="space-y-1">
            {pins.data!.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span className="text-text-primary">{formatDate(ref.snapshotTimestamp)}</span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => open(ref.snapshotUrl)}
                    className="text-accent hover:underline"
                    aria-label="Open snapshot"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => unpin.mutate(ref.id)}
                    className="text-text-muted hover:text-text-primary"
                    aria-label="Unpin snapshot"
                  >
                    <PinOff className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookup.isFetching && (
        <div data-testid="archive-loading" className="text-text-muted">
          Querying the Wayback Machine…
        </div>
      )}

      {lookup.isError && !lookup.isFetching && (
        <div data-testid="archive-error" className="text-red-500">
          Lookup failed:{' '}
          {lookup.error instanceof Error ? lookup.error.message : String(lookup.error)}
        </div>
      )}

      {result && !lookup.isFetching && result.snapshots.length === 0 && (
        <div data-testid="archive-empty" className="text-text-muted">
          No archive.org snapshots found for this URL.
        </div>
      )}

      {result && !lookup.isFetching && result.snapshots.length > 0 && (
        <ul className="space-y-1">
          {result.snapshots.map((snap, i) => (
            <SnapshotRow
              key={snap.snapshotUrl}
              snapshot={snap}
              isClosest={i === result.closestIndex}
              isPinned={pinnedUrls.has(snap.snapshotUrl)}
              onOpen={() => open(snap.snapshotUrl)}
              onPin={() =>
                pin.mutate({ captureId: capture.id, snapshot: snap, checkedAt: result.checkedAt })
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SnapshotRow({
  snapshot,
  isClosest,
  isPinned,
  onOpen,
  onPin
}: {
  snapshot: WaybackSnapshot
  isClosest: boolean
  isPinned: boolean
  onOpen: () => void
  onPin: () => void
}) {
  return (
    <li
      data-testid="archive-snapshot-row"
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        isClosest ? 'border-accent bg-accent-subtle' : 'border-border'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="text-text-primary">{formatDate(snapshot.timestamp)}</span>
        {isClosest && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
            closest to capture
          </span>
        )}
        {snapshot.mimeType && <span className="text-xs text-text-faint">{snapshot.mimeType}</span>}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-accent hover:underline"
          aria-label="Open snapshot"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onPin}
          disabled={isPinned}
          className="text-text-muted hover:text-text-primary disabled:opacity-40"
          aria-label={isPinned ? 'Already pinned' : 'Pin snapshot'}
        >
          <Pin className="h-4 w-4" />
        </button>
      </span>
    </li>
  )
}
