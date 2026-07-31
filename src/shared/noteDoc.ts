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
import { generateText, getSchema, type Extensions, type JSONContent } from '@tiptap/core'
import { Node, type Schema } from '@tiptap/pm/model'
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

// Building the schema walks every extension. Validation runs per note, and an
// archive import runs it per row, so build it once.
let schemaCache: Schema | null = null

function noteSchema(): Schema {
  if (!schemaCache) schemaCache = getSchema(noteExtensions())
  return schemaCache
}

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
  try {
    // fromJSON rejects unknown node and mark types but builds whatever
    // structure it is handed — a text node directly under the document
    // survives it, and so would have survived deriving text from it. check()
    // is what enforces the schema's content expressions.
    Node.fromJSON(noteSchema(), doc).check()
  } catch (e) {
    throw new Error(`Note body does not fit the note schema: ${(e as Error).message}`)
  }
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
