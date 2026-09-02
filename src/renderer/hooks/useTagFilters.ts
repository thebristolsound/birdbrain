import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import { tagCapturesWithAnyQueryOptions, tagsQueryOptions } from '@renderer/lib/api/tags'

// The tag half of useSelectorFilters (#918): resolves the active tag ids to
// the capture ids they cover and publishes them for the capture list. Kept a
// separate hook writing a separate store slot, because this one and the
// selector one both null their slot when their own filter list empties.
//
// Resolved through React Query rather than a one-shot read so that every
// membership write — the tag editor, a batch apply, an extension attach, a
// delete or merge — refreshes the list through the same invalidation the
// count badges already use. A slot that only re-resolved on a tag-id change
// showed a stale list under a strip still claiming the filter was current.
export function useTagFilters(caseId: string | null) {
  const activeTagFilters = useAppStore((s) => s.activeTagFilters)
  const active = !!caseId && activeTagFilters.length > 0

  const { data, isError, isFetching, error } = useQuery(
    tagCapturesWithAnyQueryOptions(caseId ?? '', activeTagFilters)
  )
  // Watched only while a filter is active: a deleted or merged tag would
  // otherwise keep its filter with no menu row left to untick it.
  const { data: tags } = useQuery({ ...tagsQueryOptions, enabled: active })

  useEffect(() => {
    const store = useAppStore.getState()
    if (!active) {
      store.setTagFilteredCaptureIds(null)
      return
    }
    if (data) store.setTagFilteredCaptureIds(data)
  }, [active, data])

  // Fail closed. Neither an empty list ("no capture carries this tag") nor
  // null under a live label ("every capture carries it") is a claim a failed
  // lookup can make, so the filter is dropped and the operator told why. The
  // fetching guard keeps a cached failure from re-dropping the filter the
  // moment it is picked again, while the retry is still in flight.
  useEffect(() => {
    if (!active || !isError || isFetching) return
    notify.error("Couldn't apply the tag filter.", { code: 'query.failed', cause: error })
    useAppStore.getState().clearTagFilters()
  }, [active, isError, isFetching, error])

  useEffect(() => {
    if (!active || !tags) return
    const known = new Set(tags.map((t) => t.id))
    for (const id of activeTagFilters) {
      if (!known.has(id)) useAppStore.getState().removeTagFilter(id)
    }
  }, [active, tags, activeTagFilters])
}
