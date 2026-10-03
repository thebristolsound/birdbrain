import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/server'
import * as noteRepo from '@main/services/db/noteRepo'
import * as noteReferenceRepo from '@main/services/db/noteReferenceRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { MENTION_TARGET_TYPES } from '@shared/noteDoc'
import type { Note } from '@shared/types'
import { READ_ONLY, failure, json } from '../results'

// `bodyDoc` is the editor's ProseMirror JSON; `body` is the same text, plain.
// get_note returns the mentions inside it as structured references.
function plain(note: Note) {
  const { id, caseId, captureId, title, body, anchor, sourceUrl, createdAt, updatedAt } = note
  return { id, caseId, captureId, title, body, anchor, sourceUrl, createdAt, updatedAt }
}

export function registerNoteTools(server: McpServer): void {
  server.registerTool(
    'list_notes',
    {
      description:
        "A Case's investigator Notes: title, plain-text body, the Capture or text span it " +
        'is anchored to, and its source URL.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => json(noteRepo.listNotes(caseId).map(plain))
  )

  server.registerTool(
    'get_note',
    {
      description: 'One Note with its Tags and every Capture, selector, Tag or Note it mentions.',
      inputSchema: z.object({ noteId: z.string() }),
      annotations: READ_ONLY
    },
    ({ noteId }) => {
      const note = noteRepo.getNote(noteId)
      if (!note) return failure(`No Note with id ${noteId}`)
      return json({
        ...plain(note),
        tags: tagRepo.getTagsForNote(noteId),
        references: noteReferenceRepo.referencesForNote(noteId)
      })
    }
  )

  server.registerTool(
    'search_notes',
    {
      description: "Full-text search over a Case's Notes. Uses SQLite FTS5 syntax.",
      inputSchema: z.object({ caseId: z.string(), query: z.string().min(1) }),
      annotations: READ_ONLY
    },
    ({ caseId, query }) => json(noteRepo.searchNotes(caseId, query).map(plain))
  )

  server.registerTool(
    'note_backlinks',
    {
      description: 'Every Note in a Case that mentions the given Capture, selector, Tag or Note.',
      inputSchema: z.object({
        caseId: z.string(),
        targetType: z.enum(MENTION_TARGET_TYPES),
        targetId: z.string()
      }),
      annotations: READ_ONLY
    },
    (params) => json(noteReferenceRepo.backlinksForTarget(params))
  )

  server.registerTool(
    'note_graph',
    {
      description:
        'Every mention edge in a Case: which Note mentions which Capture, selector, Tag or ' +
        'Note, and how often.',
      inputSchema: z.object({ caseId: z.string() }),
      annotations: READ_ONLY
    },
    ({ caseId }) => json(noteReferenceRepo.referenceEdgesForCase(caseId))
  )
}
