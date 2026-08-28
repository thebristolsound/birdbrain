import { useCallback } from 'react'
import type { Capture } from '@shared/types'
import type { DuplicateCaptureResult } from '@shared/ipc'
import { useCapturesMutations } from '@renderer/lib/api/captures'
import { notify } from '@renderer/lib/notify'

// What the operator is told when the main process refuses. Each line names the
// state that blocked the copy, because every one of them is something they can
// act on — and a refusal reported as a generic failure would read as a bug in
// the app rather than as the evidence rule it is.
export function duplicateRefusalMessage(
  result: Extract<DuplicateCaptureResult, { status: 'rejected' }>
): string {
  switch (result.reason) {
    case 'not_found':
      return 'That capture is no longer in this case'
    case 'operator_name_required':
      return 'Set an operator name in Settings before duplicating a capture'
    case 'copy_mismatch':
      return 'The capture changed while it was being copied — nothing was added'
    case 'not_verified':
      return result.detail === 'legacy'
        ? 'Legacy HTML captures have no manifest entry, so they cannot be duplicated'
        : 'Only a capture that currently verifies can be duplicated'
  }
}

/**
 * Duplicate any capture in the case by id (#827).
 *
 * Split out of the hook below when the capture row's context menu became a
 * second route (#701): a right-click acts on the row under the pointer, which
 * is not necessarily the selected one, and the refusal handling above must stay
 * in one place rather than be restated per call site.
 */
export function useDuplicateCaptureById(caseId: string): {
  duplicate: (captureId: string) => void
  isPending: boolean
} {
  const { duplicate } = useCapturesMutations(caseId)
  const { mutate } = duplicate

  const run = useCallback(
    (captureId: string) => {
      mutate(captureId, {
        onSuccess: (result) => {
          if (result.status === 'duplicated') notify.success('Duplicated capture')
          else notify.warn(duplicateRefusalMessage(result))
        }
      })
    },
    [mutate]
  )

  return { duplicate: run, isPending: duplicate.isPending }
}

/**
 * The capture actions menu's Duplicate route (#827).
 *
 * Mounted on the captures surface rather than inside the details panel, for the
 * reason `useCopyCaptureUrl` documents: the panel is absent whenever the details
 * column is a rail or hidden, and is rendered from two separate call sites.
 *
 * Selection is deliberately left alone. The duplicate carries the source's
 * capture time, so the list — ordered by timestamp — puts it next to the row the
 * operator was already looking at.
 */
export function useDuplicateCapture(
  capture: Capture | null,
  caseId: string
): { duplicate: () => void; isPending: boolean } {
  const { duplicate, isPending } = useDuplicateCaptureById(caseId)
  const captureId = capture?.id

  const run = useCallback(() => {
    if (captureId) duplicate(captureId)
  }, [captureId, duplicate])

  return { duplicate: run, isPending }
}
