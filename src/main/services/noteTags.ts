import { withTransaction } from '@main/services/db/core'
import * as noteRepo from '@main/services/db/noteRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import type { ApplyTagToNoteParams, ApplyTagToNoteResult } from '@shared/ipc'
import type { Note } from '@shared/types'

/** Thrown when the note a tag was aimed at is not in the database. */
export class NoteNotFoundError extends Error {
  constructor(noteId: string) {
    super(`Note ${noteId} not found`)
    this.name = 'NoteNotFoundError'
  }
}

/**
 * The capture a note's tag ALSO lands on, or undefined when the note names
 * none.
 *
 * Two ways a note reaches a capture and they are not the same thing: the
 * `capture_id` column (the note was written against that capture) and an
 * anchor (the note cites a passage or finding in one). The column wins when
 * both are present because it is the note's own binding rather than a citation
 * inside its body, and every anchor kind already carries a `captureId`.
 */
export function captureForNote(note: Note): string | undefined {
  return note.captureId ?? note.anchor?.captureId
}

/**
 * Apply a tag to a note by name (#391, ruling R15).
 *
 * The tag attaches to the note ALWAYS, and additionally to the note's capture
 * when it has one — so a tag raised from a passage of a note still reaches
 * capture-level filtering and the Signals coverage strip, which read
 * `capture_tags` and know nothing about notes.
 *
 * One transaction covers the lookup, the create and both attachments: a
 * half-applied tag would claim on one surface what it denies on the other.
 */
export function applyTagToNote(params: ApplyTagToNoteParams): ApplyTagToNoteResult {
  const name = params.name.trim()
  if (!name) throw new Error('Tag name is required')

  return withTransaction(() => {
    const note = noteRepo.getNote(params.noteId)
    if (!note) throw new NoteNotFoundError(params.noteId)

    const tag = tagRepo.findOrCreateTagByName(name)
    tagRepo.addTagToNote({ noteId: note.id, tagId: tag.id })

    const captureId = captureForNote(note)
    if (captureId) tagRepo.addTagToCapture({ captureId, tagId: tag.id })

    return { tag, captureId }
  })
}
