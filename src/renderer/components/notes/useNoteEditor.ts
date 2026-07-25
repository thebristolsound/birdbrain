import { useEditor, type Editor } from '@tiptap/react'
import { noteExtensions, EMPTY_NOTE_DOC, plainTextToNoteDoc } from '@shared/noteDoc'
import type { JSONContent } from '@tiptap/core'

export interface UseNoteEditorArgs {
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

export function useNoteEditor({
  bodyDoc,
  plainText,
  editable = true,
  onChange,
  testId
}: UseNoteEditorArgs): Editor | null {
  return useEditor({
    extensions: noteExtensions(),
    content: initialNoteDoc(bodyDoc, plainText),
    editable,
    editorProps: {
      attributes: {
        class: 'outline-none',
        ...(testId ? { 'data-testid': testId } : {})
      }
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
