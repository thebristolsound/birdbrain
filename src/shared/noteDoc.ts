/**
 * The single schema definition for note rich text.
 *
 * Both processes import from here on purpose. The renderer's editor and the
 * main process's text derivation must agree on which nodes exist: a node the
 * editor can produce but this list omits is dropped silently — it would vanish
 * from the FTS index and, later, from an exported report. One list, imported
 * twice, makes that disagreement impossible rather than merely unlikely.
 *
 * Keep this module free of React and of node views. Main loads it too.
 */
import { generateText, type Extensions, type JSONContent } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'

/**
 * Notes are prose, not documents: no headings above h3, no code blocks.
 *
 * StarterKit's view-layer plugins (dropcursor, gapcursor, trailing node) stay
 * enabled. They contribute nothing to the schema and load without a DOM, so
 * excluding them from main's copy would buy nothing and give the two processes
 * two different lists to keep in step.
 */
export function noteExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      horizontalRule: false
    })
  ]
}

export const EMPTY_NOTE_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

/**
 * Derive the plain text that FTS indexes. Blocks are separated by newlines so
 * a phrase cannot be assembled across a paragraph boundary and match text the
 * note never contained.
 */
export function noteDocToText(doc: JSONContent): string {
  return generateText(doc, noteExtensions(), { blockSeparator: '\n' }).trim()
}

/**
 * Parse and validate a serialized document. Throws rather than coercing: an
 * unparseable or off-schema body arriving from the renderer is a bug, and
 * storing it would mean a note whose text and rich body disagree forever.
 */
export function parseNoteDoc(json: string): JSONContent {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Note body is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as JSONContent).type !== 'doc') {
    throw new Error('Note body is not a ProseMirror document')
  }
  const doc = parsed as JSONContent
  // Round-trips the document through the schema; unknown nodes or marks throw.
  noteDocToText(doc)
  return doc
}

/** Wrap legacy plain text so a pre-Tiptap note opens in the editor unchanged. */
export function plainTextToNoteDoc(text: string): JSONContent {
  const paragraphs = text.split(/\r?\n/)
  return {
    type: 'doc',
    content: paragraphs.map((line) =>
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' }
    )
  }
}

export function isEmptyNoteDoc(doc: JSONContent): boolean {
  return noteDocToText(doc).length === 0
}

/**
 * The serialized document a note should open with. Rich notes give theirs
 * back verbatim; a legacy note is lifted from its plain text. Serializations
 * produced here round-trip through the editor unchanged, which is what lets
 * autosave tell a real edit from a note merely being opened.
 */
export function noteDocString(note?: { body?: string; bodyDoc?: string } | null): string {
  if (note?.bodyDoc) return note.bodyDoc
  if (note?.body) return JSON.stringify(plainTextToNoteDoc(note.body))
  return JSON.stringify(EMPTY_NOTE_DOC)
}

/** True when a serialized document holds no text. Unparseable input is not empty. */
export function isEmptyNoteDocString(json: string): boolean {
  if (!json) return true
  try {
    return isEmptyNoteDoc(JSON.parse(json) as JSONContent)
  } catch {
    return false
  }
}
