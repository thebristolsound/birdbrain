import { useMemo } from 'react'
import { renderToReactElement } from '@tiptap/static-renderer/pm/react'
import { noteExtensions } from '@shared/noteDoc'
import type { Note } from '@shared/types'

interface NoteBodyProps {
  note: Pick<Note, 'body' | 'bodyDoc'>
  className?: string
}

/**
 * Read-only rendering of a note body.
 *
 * Static rendering rather than a read-only editor: a list of notes would
 * otherwise mount one ProseMirror view per card, and none of them would ever
 * take a keystroke.
 */
export function NoteBody({ note, className = '' }: NoteBodyProps) {
  const rendered = useMemo(() => {
    if (!note.bodyDoc) return null
    try {
      return renderToReactElement({
        content: JSON.parse(note.bodyDoc),
        extensions: noteExtensions()
      })
    } catch {
      // Fall back to the derived plain text, which is always present.
      return null
    }
  }, [note.bodyDoc])

  if (rendered !== null) {
    return <div className={`note-prose ${className}`}>{rendered}</div>
  }

  if (!note.body) return null

  return (
    <p className={`whitespace-pre-wrap text-sm text-text-secondary ${className}`}>{note.body}</p>
  )
}
