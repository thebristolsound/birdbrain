import { useMemo } from 'react'
import { useEditor, type Editor } from '@tiptap/react'
import { EMPTY_NOTE_DOC, plainTextToNoteDoc } from '@shared/noteDoc'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import {
  isMentionTargetType,
  mentionPlainText
} from '@renderer/components/notes/mention/mentionModel'
import { rendererNoteExtensions } from '@renderer/components/notes/mention/rendererNoteExtensions'
import { useMentionSources } from '@renderer/components/notes/mention/useMentionSources'

export interface UseNoteEditorArgs {
  /** Which case's entities the @/# autocompletes offer. */
  caseId: string
  /** Serialized ProseMirror JSON, or null for a note that predates rich text. */
  bodyDoc?: string | null
  /** Plain text of a legacy note, wrapped into paragraphs when bodyDoc is absent. */
  plainText?: string
  editable?: boolean
  onChange?: (bodyDoc: string) => void
  /**
   * Lands on the contenteditable element itself, not a wrapper — Playwright's
   * fill() needs the element that actually accepts text.
   */
  testId?: string
  /** The note being edited, so it is not offered as a target of itself. */
  noteId?: string
}

/**
 * Resolve what the editor opens with. A legacy note is lifted into document
 * form here rather than at write time: nothing is rewritten in the database
 * until the investigator actually edits the note.
 */
export function initialNoteDoc(bodyDoc?: string | null, plainText?: string): JSONContent {
  if (bodyDoc) {
    try {
      return JSON.parse(bodyDoc) as JSONContent
    } catch {
      // A body_doc that will not parse is a bug, but losing the note over it
      // would be worse — fall through to the plain text we still have.
    }
  }
  if (plainText) return plainTextToNoteDoc(plainText)
  return EMPTY_NOTE_DOC
}

/** What a Mention contributes to a leaf-aware plain-text walk. */
function mentionLeafText(node: PMNode): string {
  if (node.type.name !== 'mention') return ''
  const { targetType, label } = node.attrs
  if (!isMentionTargetType(targetType)) return ''
  return mentionPlainText(targetType, typeof label === 'string' && label ? label : targetType)
}

export function useNoteEditor({
  caseId,
  bodyDoc,
  plainText,
  editable = true,
  onChange,
  testId,
  noteId
}: UseNoteEditorArgs): Editor | null {
  const { ref: sourcesRef } = useMentionSources(caseId)

  // Rebuilding this list rebuilds the editor, so it is keyed on the case
  // alone. The autocompletes read live data through the getter, not from here.
  const extensions = useMemo(
    () =>
      rendererNoteExtensions({
        caseId,
        getSources: () => sourcesRef.current,
        excludeNoteId: noteId
      }),
    [caseId, sourcesRef, noteId]
  )

  return useEditor({
    extensions,
    content: initialNoteDoc(bodyDoc, plainText),
    editable,
    editorProps: {
      attributes: {
        class: 'outline-none',
        ...(testId ? { 'data-testid': testId } : {})
      },
      /**
       * Without this a copied Mention contributes the empty string.
       *
       * Tiptap's `renderText` writes `schema.spec.toText`, which only
       * `generateText` reads; ProseMirror's clipboard falls back to
       * `textBetween`, which reads `spec.leafText` — a field Tiptap never
       * sets. So the atom serializes to nothing and a copied paragraph loses
       * the entity it was about.
       */
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, '\n\n', mentionLeafText)
    },
    // React 19 StrictMode double-invokes effects; deferring the first render
    // keeps the editor from mounting twice into the same element.
    immediatelyRender: false,
    // Off by default in v3, which leaves toolbar active states stale until the
    // document changes — a cursor moved into bold text would not light Bold.
    // Notes are short enough that re-rendering per transaction is free.
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => onChange?.(JSON.stringify(editor.getJSON()))
  })
}
