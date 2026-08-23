import { useState, type FormEvent } from 'react'
import type { Note } from '@shared/types'
import { EMPTY_NOTE_DOC } from '@shared/noteDoc'
import { useNotesMutations } from '@renderer/lib/api/notes'
import { formatRelativeTime } from '@renderer/lib/formatRelativeTime'

interface QuickNotesBlockProps {
  caseId: string
  /** The case's notes, most recent first; only the top two are shown. */
  notes: Note[]
}

/**
 * A one-line note capture and the two most recent notes. The input writes the
 * same shape CreateNoteCard does — a title with an empty body document — so a
 * quick note is an ordinary note, not a second kind of record.
 */
export function QuickNotesBlock({ caseId, notes }: QuickNotesBlockProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || create.isPending) return
    try {
      await create.mutateAsync({ caseId, title: trimmed, bodyDoc: JSON.stringify(EMPTY_NOTE_DOC) })
      setTitle('')
    } catch {
      // Preserve the title on failure so the user can retry
    }
  }

  return (
    <div data-testid="overview-quick-notes">
      <form onSubmit={handleSubmit}>
        <input
          data-testid="overview-quick-note-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Jot a quick note for this case…"
          aria-label="Jot a quick note for this case"
          className="w-full rounded-md border border-border bg-canvas px-2.5 py-[7px] font-body text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-accent"
        />
      </form>
      {notes.length === 0 ? (
        <p className="mt-2.5 font-body text-xs text-text-faint">No notes yet.</p>
      ) : (
        <div className="mt-2.5 flex flex-col gap-2">
          {notes.slice(0, 2).map((note) => (
            <div
              key={note.id}
              data-testid="overview-quick-note-row"
              className="rounded-md border border-border bg-elevated px-3 py-2.5"
            >
              <div className="flex items-baseline gap-2">
                <span className="flex-1 truncate font-display text-xs font-semibold text-text-primary">
                  {note.title || '(Untitled note)'}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-text-faint">
                  {formatRelativeTime(note.createdAt)}
                </span>
              </div>
              {note.body ? (
                <p className="mt-1 line-clamp-2 font-body text-[11px] leading-[1.5] text-text-muted">
                  {note.body}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
