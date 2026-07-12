import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SaveAnnotationsParams, UpsertAnnotationPinParams } from '@shared/ipc'
import { queryKeys } from '@renderer/lib/api/keys'

export const annotationsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.annotations(captureId),
    queryFn: () => window.birdbrain.annotations.get(captureId)
  })

export function useAnnotationsMutations(captureId: string) {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations(captureId) })
  }

  const save = useMutation({
    mutationFn: (params: SaveAnnotationsParams) => window.birdbrain.annotations.save(params),
    onSuccess: invalidate
  })
  const upsertPin = useMutation({
    mutationFn: (params: UpsertAnnotationPinParams) =>
      window.birdbrain.annotations.upsertPin(params),
    onSuccess: invalidate
  })
  const deletePin = useMutation({
    mutationFn: (pinId: string) => window.birdbrain.annotations.deletePin(pinId),
    onSuccess: invalidate
  })
  const deleteAll = useMutation({
    mutationFn: (id: string) => window.birdbrain.annotations.delete(id),
    onSuccess: invalidate
  })

  return { save, upsertPin, deletePin, deleteAll }
}
