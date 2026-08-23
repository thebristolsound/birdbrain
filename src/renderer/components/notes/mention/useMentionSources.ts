import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useQuery } from '@tanstack/react-query'
import { capturesQueryOptions } from '@renderer/lib/api/captures'
import { notesQueryOptions } from '@renderer/lib/api/notes'
import { selectorMatchCountsQueryOptions, selectorsQueryOptions } from '@renderer/lib/api/selectors'
import { tagUsageCountsForCaseQueryOptions, tagsQueryOptions } from '@renderer/lib/api/tags'
import type { MentionTargetType } from '@shared/noteDoc'
import {
  resolveMention,
  type MentionResolution,
  type MentionSources,
  type MentionSourcesLoaded
} from '@renderer/components/notes/mention/mentionModel'

export interface UseMentionSourcesResult {
  sources: MentionSources
  loaded: MentionSourcesLoaded
  /**
   * The same data behind a ref.
   *
   * Not an optimisation. The suggestion plugin's `items()` closure is built
   * once, when the editor is constructed, and setting editor options does not
   * rebuild the plugins — a closure over the first render's data would offer
   * whatever was cached at mount for the life of the editor.
   */
  ref: RefObject<MentionSources>
}

/**
 * Everything the Mention popup and the chips read, from the list queries the
 * app already caches.
 *
 * Deliberately no dedicated mention-search channel: filtering client-side over
 * the lists a case screen has loaded anyway keeps the query layer untouched
 * and makes a rename land on the chips through the invalidation that already
 * follows every rename.
 */
export function useMentionSources(caseId: string): UseMentionSourcesResult {
  const captures = useQuery(capturesQueryOptions(caseId))
  const notes = useQuery(notesQueryOptions(caseId))
  const selectors = useQuery(selectorsQueryOptions(caseId))
  const selectorMatchCounts = useQuery(selectorMatchCountsQueryOptions(caseId))
  const tags = useQuery(tagsQueryOptions)
  const tagUsage = useQuery(tagUsageCountsForCaseQueryOptions(caseId))

  const sources = useMemo<MentionSources>(
    () => ({
      captures: captures.data ?? [],
      notes: notes.data ?? [],
      selectors: selectors.data ?? [],
      tags: tags.data ?? [],
      tagUsage: tagUsage.data ?? {},
      selectorMatchCounts: selectorMatchCounts.data ?? {}
    }),
    [captures.data, notes.data, selectors.data, tags.data, tagUsage.data, selectorMatchCounts.data]
  )

  const loaded = useMemo<MentionSourcesLoaded>(
    () => ({
      capture: captures.isSuccess,
      note: notes.isSuccess,
      selector: selectors.isSuccess,
      tag: tags.isSuccess
    }),
    [captures.isSuccess, notes.isSuccess, selectors.isSuccess, tags.isSuccess]
  )

  // Updated after commit, not during render. A render can be thrown away, and
  // a ref written from a discarded one would leave the plugin reading data no
  // committed tree ever showed. The plugin only reads this on a keystroke,
  // which is always after a commit.
  const ref = useRef(sources)
  useEffect(() => {
    ref.current = sources
  }, [sources])

  return { sources, loaded, ref }
}

export type MentionResolver = (targetType: MentionTargetType, targetId: string) => MentionResolution

/**
 * Current label and existence for a Mention target, for chips and for the
 * masked snippets in note list rows.
 */
export function useMentionResolver(caseId: string): MentionResolver {
  const { sources, loaded } = useMentionSources(caseId)
  return useMemo(
    () => (targetType, targetId) => resolveMention(targetType, targetId, sources, loaded),
    [sources, loaded]
  )
}
