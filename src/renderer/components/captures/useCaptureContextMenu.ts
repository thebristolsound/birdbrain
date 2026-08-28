import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import { useCapturesMutations } from '@renderer/lib/api/captures'
import { useRecaptureMutations } from '@renderer/lib/api/recapture'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/api/tags'
import { useAppStore } from '@renderer/stores/appStore'
import { notify } from '@renderer/lib/notify'
import { copyCaptureUrl } from '@renderer/components/captures/useCopyCaptureUrl'
import { copyCaptureHash } from '@renderer/components/captures/useCopyCaptureHash'
import { useDuplicateCaptureById } from '@renderer/components/captures/useDuplicateCapture'
import type { CaptureMenuTarget } from '@renderer/components/contextmenu/entityMenu'

interface CaptureContextMenuOptions {
  caseId: string
  /** Selected rows the current filter shows, in display order. */
  visibleSelectedIds: string[]
  favorites: Set<string>
  onToggleFavorite: (captureId: string) => void
  /** Opens the route's delete confirmation for these ids. */
  onDeleteSelection: (ids: string[]) => void
  onOpenExternal: (url: string) => void
  onQuoteIntoNote: (captureId: string) => void
}

function pluralCaptures(n: number): string {
  return `${n} capture${n === 1 ? '' : 's'}`
}

/**
 * Builds the context-menu target for a capture row (#701).
 *
 * The list column supplies what it already knows — the visible selection, the
 * favourites, the route's delete and note dialogs — and this assembles the rest
 * from the same mutations the inline routes use, so a menu item and the control
 * it accelerates cannot behave differently.
 *
 * Ruling R20 is decided here, in one place: a right-click inside the visible
 * multi-selection targets the whole selection, a right-click anywhere else
 * targets that row alone. Nothing about it is left to the registry, which only
 * counts `targetIds`.
 */
export function useCaptureContextMenu({
  caseId,
  visibleSelectedIds,
  favorites,
  onToggleFavorite,
  onDeleteSelection,
  onOpenExternal,
  onQuoteIntoNote
}: CaptureContextMenuOptions): (capture: Capture) => CaptureMenuTarget {
  const selectCapture = useAppStore((s) => s.selectCapture)
  const toggleCaptureSelection = useAppStore((s) => s.toggleCaptureSelection)
  const clearCaptureSelection = useAppStore((s) => s.clearCaptureSelection)
  const setSelectionAnchor = useAppStore((s) => s.setSelectionAnchor)

  const { data: tags = [] } = useQuery(tagsQueryOptions)
  const { addToCaptures } = useTagsMutations(caseId)
  const { enqueueCaptures } = useRecaptureMutations(caseId)
  const { setFavoriteMany } = useCapturesMutations(caseId)
  const { duplicate } = useDuplicateCaptureById(caseId)

  return useCallback(
    (capture: Capture): CaptureMenuTarget => {
      const inSelection = visibleSelectedIds.includes(capture.id)
      const targetIds = inSelection ? visibleSelectedIds : [capture.id]
      // The selection bar's rule, not a second one: favourite the lot unless
      // every row already is, in which case unfavourite them. Read once, so the
      // menu's label and the mutation it runs cannot disagree.
      const allFavorite = targetIds.every((id) => favorites.has(id))

      return {
        kind: 'capture',
        captureId: capture.id,
        title: capture.title || capture.url,
        targetIds,
        inSelection,
        isFavorite: favorites.has(capture.id),
        allFavorite,
        tags: tags.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color ?? null })),
        actions: {
          open: () => {
            selectCapture(capture.id)
            setSelectionAnchor(capture.id)
          },
          toggleSelection: () => {
            toggleCaptureSelection(capture.id)
            setSelectionAnchor(capture.id)
          },
          clearSelection: clearCaptureSelection,
          openSourceUrl: () => onOpenExternal(capture.url),
          copyUrl: () => void copyCaptureUrl(capture.url),
          copyHash: () => void copyCaptureHash(capture.hash),
          addTag: (tagId) =>
            addToCaptures.mutate(
              { captureIds: targetIds, tagId },
              {
                onSuccess: () =>
                  notify.success(`Tag applied to ${pluralCaptures(targetIds.length)}`)
              }
            ),
          quoteIntoNote: () => onQuoteIntoNote(capture.id),
          toggleFavorite: () => {
            if (targetIds.length === 1) {
              onToggleFavorite(capture.id)
              return
            }
            setFavoriteMany.mutate(
              { captureIds: targetIds, favorite: !allFavorite },
              {
                onSuccess: ({ affected }) =>
                  notify.success(
                    allFavorite
                      ? `Unfavorited ${pluralCaptures(affected)}`
                      : `Favorited ${pluralCaptures(affected)}`
                  )
              }
            )
          },
          duplicate: () => duplicate(capture.id),
          recapture: () =>
            enqueueCaptures.mutate(targetIds, {
              onSuccess: (result) => {
                if (result.rejected.length > 0) {
                  notify.warn(
                    `Recapture: ${result.accepted} queued, ${result.rejected.length} rejected (${result.rejected[0].reason})`
                  )
                } else {
                  notify.success(`Recapture queued — ${pluralCaptures(result.accepted)}`)
                }
              }
            }),
          remove: () => onDeleteSelection(targetIds)
        }
      }
    },
    [
      visibleSelectedIds,
      favorites,
      tags,
      selectCapture,
      setSelectionAnchor,
      toggleCaptureSelection,
      clearCaptureSelection,
      addToCaptures,
      setFavoriteMany,
      enqueueCaptures,
      duplicate,
      onToggleFavorite,
      onDeleteSelection,
      onOpenExternal,
      onQuoteIntoNote
    ]
  )
}
