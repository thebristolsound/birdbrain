import { useCallback } from 'react'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { useRecaptureMutations } from '@renderer/lib/api/recapture'
import { notify } from '@renderer/lib/notify'
import { copyValue } from '@renderer/components/data/copy'

// What a Wayback answer for a link in a stored page offers (#1737, plan S5). There is no
// pin: a Wayback Ref is a snapshot of the Capture's own URL, and this is another URL's.

export function openSnapshot(snapshotUrl: string): void {
  openCaptureExternal(snapshotUrl).catch((cause) => {
    notify.error("Couldn't open the link in your browser", { cause })
  })
}

export function copySnapshotUrl(snapshotUrl: string): void {
  void copyValue(snapshotUrl, 'snapshot URL')
}

/**
 * Queues a background Capture of a snapshot's replay page into `caseId`, through the
 * queue Capture link uses. The replay URL keeps archive.org's toolbar, which states the
 * snapshot's time and source in the stored page itself (plan ruling 1).
 */
export function useCaptureSnapshot(caseId: string): (snapshotUrl: string) => void {
  const { mutate } = useRecaptureMutations(caseId).enqueue
  return useCallback(
    (snapshotUrl: string) =>
      mutate(
        { urls: [snapshotUrl] },
        {
          onSuccess: ({ accepted, rejected }) => {
            if (accepted > 0) {
              notify.success('Snapshot capture queued', { description: snapshotUrl })
            } else {
              notify.warn(`Snapshot not captured: ${rejected[0]?.reason ?? 'refused'}`)
            }
          }
        }
      ),
    [mutate]
  )
}
