import { useQuery } from '@tanstack/react-query'
import {
  tagsQueryOptions,
  tagsForCaptureQueryOptions,
  useTagsMutations
} from '@renderer/lib/api/tags'

export function useCaptureTagEditor(captureId: string) {
  const tagsQuery = useQuery(tagsQueryOptions)
  const captureTagsQuery = useQuery(tagsForCaptureQueryOptions(captureId))
  const { addToCapture, removeFromCapture, create } = useTagsMutations()

  const allTags = tagsQuery.data ?? []
  const tags = captureTagsQuery.data ?? []
  const isLoading = tagsQuery.isLoading || captureTagsQuery.isLoading

  async function toggleTag(tagId: string) {
    const has = tags.some((t) => t.id === tagId)
    if (has) {
      await removeFromCapture.mutateAsync({ captureId, tagId })
    } else {
      await addToCapture.mutateAsync({ captureId, tagId })
    }
  }

  async function removeTag(tagId: string) {
    if (tags.some((t) => t.id === tagId)) {
      await removeFromCapture.mutateAsync({ captureId, tagId })
    }
  }

  async function createTag(name: string, color: string) {
    const tag = await create.mutateAsync({ name, color })
    if (tag?.id) {
      await addToCapture.mutateAsync({ captureId, tagId: tag.id })
    }
    return tag
  }

  return {
    tags,
    allTags,
    isLoading,
    toggleTag,
    removeTag,
    createTag,
    isToggling: addToCapture.isPending || removeFromCapture.isPending,
    isCreating: create.isPending
  }
}
