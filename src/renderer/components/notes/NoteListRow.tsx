import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { StickyNote } from 'lucide-react'
import type { Note } from '@shared/types'
import { captureThumbnailQueryOptions } from '@renderer/lib/api/captures'
import { noteAge, noteSource, noteSnippet } from '@renderer/components/notes/notesWorkspaceModel'
import type { MentionResolver } from '@renderer/components/notes/mention/useMentionSources'

export function NoteListRow({
  note,
  selected,
  view,
  onSelect,
  resolve
}: {
  note: Note
  selected: boolean
  view: 'detailed' | 'list'
  onSelect: () => void
  resolve: MentionResolver
}) {
  const { data: thumbnail } = useQuery({
    ...captureThumbnailQueryOptions(note.captureId ?? ''),
    enabled: !!note.captureId && view === 'detailed'
  })
  // A save refetches the whole list; only the edited note's snippet needs reparsing.
  const snippet = useMemo(() => noteSnippet(note, resolve), [note, resolve])
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      data-testid={`note-row-${note.id}`}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full shrink-0 gap-2 rounded-md border px-[var(--d-itemx)] py-[9px] text-left ${selected ? 'border-accent/35 bg-accent/10' : 'border-transparent hover:bg-elevated'}`}
    >
      <span
        className={
          view === 'detailed'
            ? 'flex h-8 w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-elevated'
            : 'flex items-center'
        }
      >
        {view === 'detailed' && thumbnail ? (
          <img
            src={`data:image/jpeg;base64,${thumbnail}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <StickyNote className="h-3 w-3 text-text-faint" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-text-primary">
          {note.title || 'Untitled note'}
        </div>
        {view === 'detailed' ? (
          <>
            <div className="flex gap-1 text-[10px] text-text-muted">
              <span className="truncate">{noteSource(note)}</span>
              <span className="shrink-0 text-text-faint">· {noteAge(note.createdAt)}</span>
            </div>
            <p className="mt-1 h-8 overflow-hidden line-clamp-2 text-[11px] leading-4 text-text-muted">
              {snippet}
            </p>
          </>
        ) : null}
      </div>
      {view === 'list' ? (
        <span className="shrink-0 text-[11px] text-text-faint">{noteAge(note.createdAt)}</span>
      ) : null}
    </div>
  )
}
