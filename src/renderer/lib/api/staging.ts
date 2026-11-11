import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { StagingCommitResult, StagingDiscardResult, StagingFile } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { notify } from '@renderer/lib/notify'

const COMMIT_NEEDS_OPERATOR = 'Set an operator name in Settings before committing a pooled file'

// The Staging Pool's three writes (ADR-0024, #1148). Upload and discard touch
// the pool only, so they invalidate the inventory; commit anchors bytes, so it
// also invalidates the manifest snapshot the ledger reads.
export function useStagingMutations(caseId: string) {
  const queryClient = useQueryClient()
  const invalidateInventory = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.exhibitInventory(caseId) })

  const upload = useMutation<StagingFile[], unknown, void>({
    mutationFn: () => window.birdbrain.staging.upload(caseId),
    // A rejected upload can still have pooled the files before the one that
    // failed, so the inventory is refreshed on error as well as on success.
    onSettled: (staged) => {
      if (staged === undefined || staged.length > 0) invalidateInventory()
    },
    meta: { action: 'add files to the staging pool' }
  })

  const commit = useMutation<StagingCommitResult, unknown, string[]>({
    mutationFn: (stagingIds) => window.birdbrain.staging.commit(caseId, stagingIds),
    onSuccess: ({ outcomes }) => {
      invalidateInventory()
      queryClient.invalidateQueries({ queryKey: queryKeys.manifestSnapshot(caseId) })
      // The refusal names something the operator can act on, so it is said (X47).
      if (outcomes.some((o) => o.status === 'refused' && o.reason === 'operator_name_required')) {
        notify.warn(COMMIT_NEEDS_OPERATOR)
      }
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
