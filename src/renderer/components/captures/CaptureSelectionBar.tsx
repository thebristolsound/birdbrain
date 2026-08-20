import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, Download, RefreshCcw, Star, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { captureFavoritesQueryOptions, useCapturesMutations } from '@renderer/lib/api/captures'
import { casesQueryOptions } from '@renderer/lib/api/cases'
import { tagsQueryOptions, useTagsMutations } from '@renderer/lib/api/tags'
import { useRecaptureMutations } from '@renderer/lib/api/recapture'
import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { useReduceMotion } from '@renderer/hooks/useReduceMotion'
import { notify } from '@renderer/lib/notify'

interface CaptureSelectionBarProps {
  caseId: string
  // Visible selected ids, in display order. Hidden (filtered-out) selected
  // rows stay in the store but are outside this bar's count and its actions.
  selectedIds: string[]
  allSelected: boolean
  onToggleSelectAll: () => void
  onClear: () => void
  onDeleteSelection: (ids: string[]) => void
}

const ICON_BTN =
  'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded hover:bg-elevated'

function pluralCaptures(n: number) {
  return `${n} capture${n === 1 ? '' : 's'}`
}

// Inline selection bar at the top of the captures list column (#396).
// Session-8 design: Birdbrain.dc.html "Selection actions" toolbar — the
// earlier floating bottom-center pill was replaced because it collided with
// the annotator toolbar. Entrance is the bbselbar 4px drop-in + fade, 150ms.
export function CaptureSelectionBar({
  caseId,
  selectedIds,
  allSelected,
  onToggleSelectAll,
  onClear,
  onDeleteSelection
}: CaptureSelectionBarProps) {
  const reduceMotion = useReduceMotion()
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const tagPickerRef = useRef<HTMLDivElement>(null)

  const { data: cases = [] } = useQuery(casesQueryOptions)
  const { data: allTags = [] } = useQuery(tagsQueryOptions)
  const { data: favoriteIds = [] } = useQuery(captureFavoritesQueryOptions(caseId))
  const { setFavoriteMany } = useCapturesMutations(caseId)
  const { addToCaptures } = useTagsMutations(caseId)
  const { enqueueCaptures } = useRecaptureMutations(caseId)

  const caseName = cases.find((c) => c.id === caseId)?.name ?? 'Case'

  useEffect(() => {
    if (!showTagPicker) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (tagPickerRef.current?.contains(target)) return
      if (tagButtonRef.current?.contains(target)) return
      setShowTagPicker(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowTagPicker(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [showTagPicker])

  function handleFavorite() {
    // setFavoriteMany takes an explicit boolean: favorite everything unless
    // the whole selection is already favorited, in which case unfavorite it.
    const favorite = !selectedIds.every((id) => favoriteIds.includes(id))
    setFavoriteMany.mutate(
      { captureIds: selectedIds, favorite },
      {
        onSuccess: ({ affected }) => {
          notify.success(
            favorite
              ? `Favorited ${pluralCaptures(affected)}`
              : `Unfavorited ${pluralCaptures(affected)}`
          )
        }
      }
    )
  }

  function handleApplyTag(tagId: string) {
    setShowTagPicker(false)
    addToCaptures.mutate(
      { captureIds: selectedIds, tagId },
      {
        onSuccess: () => notify.success(`Tag applied to ${pluralCaptures(selectedIds.length)}`)
      }
    )
  }

  function handleRecapture() {
    enqueueCaptures.mutate(selectedIds, {
      onSuccess: (result) => {
        if (result.rejected.length > 0) {
          notify.warn(
            `Recapture: ${result.accepted} queued, ${result.rejected.length} rejected (${result.rejected[0].reason})`
          )
        } else {
          notify.success(`Recapture queued — ${pluralCaptures(result.accepted)}`)
        }
      }
    })
  }

  return (
    <motion.div
      role="toolbar"
      aria-label="Selection actions"
      data-testid="capture-selection-bar"
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 0.84, 0.32, 1] }}
      className="flex shrink-0 items-center gap-0.5 border-b border-border bg-accent-subtle px-2 py-[5px]"
    >
      <button
        onClick={onToggleSelectAll}
        title={allSelected ? 'Clear all' : 'Select all'}
        className="flex h-[26px] min-w-0 items-center gap-[7px] rounded px-2 hover:bg-elevated"
      >
        <span
          aria-hidden="true"
          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border ${
            allSelected ? 'border-accent bg-accent' : 'border-border-strong'
          }`}
        >
          <Check
            className={`h-2.5 w-2.5 text-white ${allSelected ? 'opacity-100' : 'opacity-0'}`}
            strokeWidth={3}
          />
        </span>
        <span className="truncate text-[11px] font-semibold tabular-nums text-text-primary">
          {selectedIds.length} selected
        </span>
      </button>
      <span className="flex-1" />
      <button
        onClick={() => setShowExport(true)}
        title="Export selection"
        className={`${ICON_BTN} text-text-secondary`}
      >
        <Download className="h-[13px] w-[13px]" strokeWidth={1.9} />
      </button>
      <div className="relative">
        <button
          ref={tagButtonRef}
          onClick={() => setShowTagPicker((v) => !v)}
          title="Tag selection"
          className={`${ICON_BTN} text-text-secondary`}
        >
          <TagIcon className="h-[13px] w-[13px]" strokeWidth={1.9} />
        </button>
        {showTagPicker && (
          <div
            ref={tagPickerRef}
            data-selection-escape-guard=""
            className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border-strong bg-card py-1 shadow-xl"
          >
            {allTags.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-text-faint">
                No tags yet. Create one in the Tags tab first.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto">
                {allTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => handleApplyTag(tag.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-elevated"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color || '#f59e0b' }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <button
        onClick={handleFavorite}
        title="Favorite selection"
        className={`${ICON_BTN} text-text-secondary`}
      >
        <Star className="h-[13px] w-[13px]" strokeWidth={1.9} />
      </button>
      <button
        onClick={handleRecapture}
        title="Recapture selection"
        className={`${ICON_BTN} text-text-secondary`}
      >
        <RefreshCcw className="h-[13px] w-[13px]" strokeWidth={1.9} />
      </button>
      <button
        onClick={() => onDeleteSelection(selectedIds)}
        title="Delete selection"
        className={`${ICON_BTN} text-red-400`}
      >
        <Trash2 className="h-[13px] w-[13px]" strokeWidth={1.9} />
      </button>
      <span aria-hidden="true" className="mx-[3px] h-4 w-px shrink-0 bg-border-strong" />
      <button
        onClick={onClear}
        title="Clear selection (Esc)"
        className={`${ICON_BTN} text-text-muted`}
      >
        <X className="h-3 w-3" strokeWidth={2.2} />
      </button>
      {showExport && (
        // Case-scoped for now: selection scope arrives with the export ticket
        // (#396 issue body). The guard attribute keeps the list's Escape
        // handler from clearing the selection while the dialog is up.
        <div data-selection-escape-guard="">
          <ExportDialog caseId={caseId} caseName={caseName} onClose={() => setShowExport(false)} />
        </div>
      )}
    </motion.div>
  )
}
