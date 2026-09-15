import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { StagingCommitResult, StagingDiscardResult, StagingFile } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'

// The Staging Pool's three writes (ADR-0024, #1148). Upload and discard touch
// the pool only, so they invalidate the inventory; commit anchors bytes, so it
// also invalidates the snapshot the ledger reads and the captures list the
// buckets read.
export function useStagingMutations(caseId: string) {
  const queryClient = useQueryClient()
  const invalidateInventory = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(caseId) })

  const upload = useMutation<StagingFile[], unknown, void>({
    mutationFn: () => window.birdbrain.staging.upload(caseId),
    onSuccess: (staged) => {
      if (staged.length > 0) invalidateInventory()
    },
    meta: { action: 'add files to the staging pool' }
  })

  const commit = useMutation<StagingCommitResult, unknown, string[]>({
    mutationFn: (stagingIds) => window.birdbrain.staging.commit(caseId, stagingIds),
    onSuccess: () => {
      invalidateInventory()
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
    },
    meta: { action: 'commit pooled files' }
  })

  const discard = useMutation<StagingDiscardResult, unknown, string[]>({
    mutationFn: (stagingIds) => window.birdbrain.staging.discard(caseId, stagingIds),
    onSuccess: invalidateInventory,
    meta: { action: 'discard pooled files' }
  })

  return { upload, commit, discard }
}
