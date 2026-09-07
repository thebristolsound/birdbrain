import { useQuery } from '@tanstack/react-query'
import type { Tag } from '@shared/types'
import {
  tagSelectionCountsQueryOptions,
  tagsQueryOptions,
  useTagsMutations
} from '@renderer/lib/api/tags'

// How much of the selection carries a tag. `partial` is the state the interim
// picker could not express (#665): re-applying a tag some rows already hold
// looked identical to applying a new one.
export type BatchTagState = 'none' | 'partial' | 'all'

export interface BatchTagRow {
  tag: Tag
  // How many of the selected captures carry it.
  count: number
  state: BatchTagState
}

/**
 * The selection's tag membership, and the two writes that change it (#665).
 * The N-capture counterpart of `useCaptureTagEditor`, which is per-capture and
 * has no notion of a tag being on some rows and not others.
 */
export function useBatchTagEditor(caseId: string, captureIds: string[]) {
  const tagsQuery = useQuery(tagsQueryOptions)
  const countsQuery = useQuery(tagSelectionCountsQueryOptions(caseId, captureIds))
  const { addToCaptures, removeFromCaptures, findOrCreate } = useTagsMutations(caseId)

  const allTags = tagsQuery.data ?? []
  const counts = countsQuery.data ?? {}
  const total = captureIds.length

  // Kept in `listTags`' name order rather than sorted by state: rows that
  // reorder under the cursor as each click lands would make applying three
  // tags in one gesture a game of chase.
  //
  // `count >= total` rather than `===` because the count comes from main's
  // same-case snapshot, which drops ids whose row is gone; a selection holding
  // a stale id therefore reads `partial` at worst, and clicking it re-applies,
  // which INSERT OR IGNORE makes a no-op.
  const rows: BatchTagRow[] = allTags.map((tag) => {
    const count = counts[tag.id] ?? 0
    return { tag, count, state: count === 0 ? 'none' : count >= total ? 'all' : 'partial' }
  })

  /**
   * One click, one write. `partial` resolves upward — the gesture that
   * completes a partial application is the same one that starts a new one —
   * so only a fully applied tag is removable, and the operator never removes
   * a tag from rows they could not see it on.
   *
   * This is the row click's path and nothing else's: it is the only gesture
   * that can remove, and the row it belongs to says so in its tooltip.
   */
  async function toggleTag(tagId: string): Promise<'applied' | 'removed'> {
    const applied = rows.find((r) => r.tag.id === tagId)?.state === 'all'
    if (applied) {
      await removeFromCaptures.mutateAsync({ captureIds, tagId })
      return 'removed'
    }
    await addToCaptures.mutateAsync({ captureIds, tagId })
    return 'applied'
  }

  /**
   * Apply to the whole selection whatever the current state — the half of
   * `toggleTag` with no remove branch. The picker's Enter path uses this: the
   * input doubles as the list filter, so typing a name out in full must not be
   * a route into an unlogged batch untag. Re-applying a tag the selection
   * already carries costs one `INSERT OR IGNORE` that changes no row.
   */
  async function applyTag(tagId: string): Promise<void> {
    await addToCaptures.mutateAsync({ captureIds, tagId })
  }

  // Create-or-reuse, then apply. Reuse matters here and not only for #811's
  // constraint failure: the picker's input doubles as its filter, so a name
  // that matches an existing tag case-insensitively should attach that tag
  // rather than refuse.
  async function createAndApply(name: string, color: string): Promise<Tag> {
    const tag = await findOrCreate.mutateAsync({ name, color })
    await addToCaptures.mutateAsync({ captureIds, tagId: tag.id })
    return tag
  }

  return {
    rows,
    total,
    isLoading: tagsQuery.isLoading || countsQuery.isLoading,
    toggleTag,
    applyTag,
    createAndApply,
    isWriting: addToCaptures.isPending || removeFromCaptures.isPending || findOrCreate.isPending
  }
}
