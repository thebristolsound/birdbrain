import { useCallback, useState } from 'react'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ExhibitVerification } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The Exhibit model's read paths (ADR-0023, X36/X37). The renderer never
// computes chain state: the inventory says what the Case holds and whether the
// bytes are on disk, the snapshot carries the chain verdict, and verify is the
// only integrity claim a screen can make about one Exhibit.

export const exhibitInventoryQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.exhibitInventory(caseId),
    queryFn: () => window.birdbrain.exhibits.inventory(caseId),
    enabled: !!caseId
  })

export const manifestSnapshotQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.manifestSnapshot(caseId),
    queryFn: () => window.birdbrain.manifest.snapshot(caseId),
    enabled: !!caseId
  })

export function useExhibitsMutations(caseId: string) {
  const queryClient = useQueryClient()

  // Verify one Exhibit. The result is written into the per-Exhibit cache slot
  // so a view can show the outcome immediately, and the captures list is
  // invalidated because a Capture's verify persists `lastVerifiedStatus` on
  // its row — the same field the Overview's VerifyBar reads.
  const verify = useMutation<ExhibitVerification, unknown, string>({
    mutationFn: (exhibitId) => window.birdbrain.exhibits.verify(caseId, exhibitId),
    onSuccess: (result, exhibitId) => {
      queryClient.setQueryData(queryKeys.exhibitVerification(caseId, exhibitId), result)
      queryClient.invalidateQueries({ queryKey: queryKeys.captures(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(caseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
    },
    meta: { action: 'verify exhibit' }
  })

  return { verify }
}

export interface VerifyAllProgress {
  done: number
  total: number
}

// "Verify all" (X37): one `exhibits:verify` per Exhibit, in sequence, with
// progress. Sequential on purpose — there is deliberately no batch channel,
// and running the hashes in parallel would contend for the same disk. A
// rejected verify is reported through the mutation cache's onError and the
// loop continues, so one unreadable file does not stop the others.
export function useVerifyAll(caseId: string) {
  const { verify } = useExhibitsMutations(caseId)
  const [progress, setProgress] = useState<VerifyAllProgress | null>(null)

  const run = useCallback(
    async (
      exhibitIds: string[],
      onResult?: (result: ExhibitVerification) => void,
      onFailure?: (exhibitId: string) => void
    ) => {
      setProgress({ done: 0, total: exhibitIds.length })
      try {
        for (const [index, exhibitId] of exhibitIds.entries()) {
          try {
            onResult?.(await verify.mutateAsync(exhibitId))
          } catch {
            // The mutation cache toasts the error; the caller is told so the
            // row does not keep reading a stale persisted state as verified.
            onFailure?.(exhibitId)
          }
          setProgress({ done: index + 1, total: exhibitIds.length })
        }
      } finally {
        setProgress(null)
      }
    },
    [verify]
  )

  return { run, progress, running: progress !== null }
}
