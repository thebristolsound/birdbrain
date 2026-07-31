import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, Star, ExternalLink, Tag as TagIcon, StickyNote } from 'lucide-react'
import type { Capture } from '@shared/types'
import { notesQueryOptions, tagsForCaptureQueryOptions } from '@renderer/lib/queries'
import { useFavorites } from '@renderer/hooks/useFavorites'

interface Props {
  capture: Capture
  caseId: string
  forced: boolean
  onExpand: () => void
  onOpenExternal: () => void
}

export function CaptureDetailsRail({ capture, caseId, forced, onExpand, onOpenExternal }: Props) {
  const { data: tags = [] } = useQuery(tagsForCaptureQueryOptions(capture.id))
  const { data: notes = [] } = useQuery(notesQueryOptions(caseId))
  const { favorites, toggleFavorite } = useFavorites(caseId)
  const isFavorite = favorites.has(capture.id)
  const noteCount = notes.filter((n) => n.captureId === capture.id).length

  // When the viewport forces the collapse there's no room for a docked panel,
  // but custody/Wayback/tags/notes must stay reachable — onExpand then opens
  // the details as an overlay instead of re-docking.
  const expandTitle = forced ? 'Show details' : 'Expand details'

  return (
    <div className="flex h-full w-10 flex-col items-center gap-1 py-2">
      <button
        onClick={onExpand}
        title={expandTitle}
        data-testid="capture-details-rail-expand"
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => toggleFavorite(capture.id)}
        title={isFavorite ? 'Unfavorite' : 'Favorite'}
        className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-elevated"
      >
        <Star
          className={`h-3.5 w-3.5 ${
            isFavorite ? 'fill-amber-400 text-amber-400' : 'text-text-muted'
          }`}
        />
      </button>
      <button
        onClick={onOpenExternal}
        title="Open URL"
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={onExpand}
        title={`${tags.length} tags`}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
      >
        <TagIcon className="h-3.5 w-3.5" />
        {tags.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-subtle px-1 text-[9px] font-semibold leading-none text-accent">
            {tags.length}
          </span>
        )}
      </button>
      <button
        onClick={onExpand}
        title={`${noteCount} notes`}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-elevated hover:text-text-secondary"
      >
        <StickyNote className="h-3.5 w-3.5" />
        {noteCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-subtle px-1 text-[9px] font-semibold leading-none text-accent">
            {noteCount}
          </span>
        )}
      </button>
    </div>
  )
}
