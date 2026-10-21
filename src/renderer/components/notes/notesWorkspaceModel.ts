import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
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

/**
 * The mentions in a live editor document, walked in place: the workspace's
 * context rail reads this on every transaction, so it must not serialize.
 */
export function editorMentions(doc: PMNode): NoteMention[] {
  const mentions: NoteMention[] = []
  doc.descendants((node) => {
    if (node.type.name !== 'mention') return true
    mentions.push({
      targetType: node.attrs.targetType as MentionTargetType,
      targetId: node.attrs.targetId as string,
      label: typeof node.attrs.label === 'string' ? node.attrs.label : ''
    })
    return false
  })
  return mentions
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

/**
 * What a note's link to its Capture points at: nothing, a Capture the Case
 * still lists, one it no longer does, or not known yet. A note keeps its link
 * to a Capture deleted from a Shared Case as its author signed it (#1877), so
 * the screens show that link as a deleted Capture. Read through the Mention
 * resolver, over the same cached Capture list a Mention chip reads.
 */
export type NoteCaptureLink = 'none' | 'loading' | 'live' | 'deleted'

export function noteCaptureLink(
  note: Pick<Note, 'captureId'>,
  resolve: (type: MentionTargetType, id: string) => { status: 'loading' | 'resolved' | 'missing' }
): NoteCaptureLink {
  if (!note.captureId) return 'none'
  const { status } = resolve('capture', note.captureId)
  return status === 'resolved' ? 'live' : status === 'missing' ? 'deleted' : 'loading'
}

export function noteSource(
  note: Note,
  link: NoteCaptureLink = note.captureId ? 'live' : 'none'
): string {
  if (link === 'deleted') return 'Deleted capture'
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
