import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { classifySelection } from '@shared/selectionKind'
import { notesQueryOptions, useNotesMutations } from '@renderer/lib/api/notes'
import { selectorsQueryOptions, useSelectorsMutations } from '@renderer/lib/api/selectors'
import { notify } from '@renderer/lib/notify'
import type { MentionCreate } from '@renderer/components/notes/mention/mentionSuggestion'

/**
 * The popup's create row, written through the same mutations the rest of the
 * app uses: a selector the way the note selection bar creates one, a note the
 * way the Notes screen does. No channel of its own.
 *
 * The returned function keeps one identity for the life of the case, because
 * the editor's plugins are built once and never see a newer closure.
 */
export function useMentionCreate(caseId: string): MentionCreate {
  const queryClient = useQueryClient()
  const { create: createNote } = useNotesMutations(caseId)
  const { create: createSelector } = useSelectorsMutations(caseId)
  const latest = useRef({ createNote, createSelector })
  useEffect(() => {
    latest.current = { createNote, createSelector }
  })

  return useCallback<MentionCreate>(
    async (targetType, query) => {
      if (targetType === 'selector') {
        const { value } = classifySelection(query)
        const selector = await latest.current.createSelector.mutateAsync({
          caseId,
          pattern: value,
          isRegex: false,
          label: value,
          origin: 'note',
          enabled: true
        })
        // Seeded ahead of the refetch the mutation started, so the chip that
        // is about to be inserted resolves at once rather than reading as a
        // deleted target until the list comes back.
        queryClient.setQueryData(selectorsQueryOptions(caseId).queryKey, (list) =>
          list && !list.some((s) => s.id === selector.id) ? [...list, selector] : list
        )
        notify.success(`Selector created — ${value}`)
        return { targetId: selector.id, label: selector.label || selector.pattern }
      }
      const note = await latest.current.createNote.mutateAsync({ caseId, title: query })
      queryClient.setQueryData(notesQueryOptions(caseId).queryKey, (list) =>
        list && !list.some((n) => n.id === note.id) ? [...list, note] : list
      )
      notify.success(`Note created — ${query}`)
      return { targetId: note.id, label: note.title || query }
    },
    [caseId, queryClient]
  )
}
