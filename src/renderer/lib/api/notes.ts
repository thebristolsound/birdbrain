import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateNoteParams, UpdateNoteParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

// --- Notes ---

export const notesQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.notes(caseId),
    queryFn: () => window.birdbrain.notes.list(caseId),
    enabled: !!caseId
  })

export const noteCountQueryOptions = (caseId: string) =>
  queryOptions({
    queryKey: queryKeys.noteCount(caseId),
    queryFn: () => window.birdbrain.notes.count(caseId),
    enabled: !!caseId
  })

export const notesSearchQueryOptions = (caseId: string, query: string) =>
  queryOptions({
    queryKey: queryKeys.notesSearch(caseId, query),
    queryFn: () => window.birdbrain.notes.search(caseId, query),
    enabled: !!caseId && query.trim().length > 0
  })

export function useNotesMutations(caseId: string) {
  const queryClient = useQueryClient()

  const invalidateNoteQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.notes(caseId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.noteCount(caseId) })
    queryClient.invalidateQueries({ queryKey: ['notes', 'search', caseId] })
  }

  const create = useMutation({
    mutationFn: (params: CreateNoteParams) => window.birdbrain.notes.create(params),
    onSuccess: invalidateNoteQueries,
    meta: { action: 'create note' }
  })

  const update = useMutation({
    mutationFn: (params: UpdateNoteParams) => window.birdbrain.notes.update(params),
    onSuccess: invalidateNoteQueries,
    meta: { action: 'save note' }
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.birdbrain.notes.delete(id),
    onSuccess: invalidateNoteQueries,
    meta: { action: 'delete note' }
  })

  return { create, update, remove }
}
