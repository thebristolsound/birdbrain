import type { JSONContent } from '@tiptap/core'
import type { Note } from '@shared/types'
import {
  extractNoteMentions,
  noteDocToText,
  MENTION_TARGET_TYPES,
  type NoteMention,
  type MentionTargetType
} from '@shared/noteDoc'

export type NoteSort = 'newest' | 'oldest' | 'title'
export type NoteDateFilter = 'all' | 'today' | '7days'

export function noteMentions(bodyDoc?: string): NoteMention[] {
  if (!bodyDoc) return []
  try {
    return extractNoteMentions(bodyDoc)
  } catch {
    return []
  }
}

export function usedNoteTags(notes: Note[]): NoteMention[] {
  const tags = new Map<string, NoteMention>()
  notes.forEach((note) =>
    noteMentions(note.bodyDoc).forEach((mention) => {
      if (mention.targetType === 'tag') tags.set(mention.targetId, mention)
    })
  )
  return [...tags.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export function filterNotes(
  notes: Note[],
  sort: NoteSort,
  tagId: string,
  date: NoteDateFilter,
  now = Date.now()
): Note[] {
  const maxAge = date === 'today' ? 86400000 : date === '7days' ? 604800000 : Infinity
  return notes
    .filter(
      (note) =>
        now - Date.parse(note.createdAt) < maxAge &&
        (!tagId ||
          noteMentions(note.bodyDoc).some((m) => m.targetType === 'tag' && m.targetId === tagId))
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : (sort === 'oldest' ? 1 : -1) * a.createdAt.localeCompare(b.createdAt)
    )
}

export function noteSource(note: Note): string {
  if (!note.captureId || !note.sourceUrl) return 'No linked capture'
  try {
    return new URL(note.sourceUrl).host
  } catch {
    return note.sourceUrl
  }
}

export function noteAge(timestamp: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** List snippets are text, so rich formatting cannot change their two-line height. */
export function noteSnippet(
  note: Note,
  resolve: (type: MentionTargetType, id: string) => { label: string | null }
): string {
  if (!note.bodyDoc) return note.body
  try {
    const doc = JSON.parse(note.bodyDoc) as JSONContent
    const visit = (node: JSONContent) => {
      if (
        node.type === 'mention' &&
        node.attrs &&
        MENTION_TARGET_TYPES.includes(node.attrs.targetType)
      ) {
        node.attrs.label =
          resolve(node.attrs.targetType, node.attrs.targetId).label || node.attrs.label
      }
      node.content?.forEach(visit)
    }
    visit(doc)
    return noteDocToText(doc)
  } catch {
    return note.body
  }
}
