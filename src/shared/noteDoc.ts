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
import {
  generateText,
  getSchema,
  Node as TiptapNode,
  type Extensions,
  type JSONContent
} from '@tiptap/core'
import { Node, type Schema } from '@tiptap/pm/model'
import { StarterKit } from '@tiptap/starter-kit'

export const MENTION_TARGET_TYPES = ['capture', 'selector', 'tag', 'note'] as const
export type MentionTargetType = (typeof MENTION_TARGET_TYPES)[number]

export const MENTION_SIGILS = ['@', '#'] as const
export type MentionSigil = (typeof MENTION_SIGILS)[number]

/**
 * The prefix each kind reads with — the key that opens its popup in the editor,
 * and the character it carries everywhere text is derived from a Mention.
 *
 * Declared here rather than beside the popup because main derives every note's
 * indexed text, and every exported report's, from this module. While the map
 * lived only in the renderer a `#nightjar` selector chip indexed and exported as
 * `@nightjar`, so the text on screen and the text in the report disagreed.
 */
export const MENTION_SIGIL: Record<MentionTargetType, MentionSigil> = {
  capture: '@',
  note: '@',
  selector: '#',
  tag: '#'
}

/** A Mention as extracted from a validated document, in document order. */
export interface NoteMention {
  targetType: MentionTargetType
  targetId: string
  label: string
}

// The plain text a Mention contributes to derived `body` (and so to FTS) and
// to its DOM serialization. Label is a display cache; when a mention was
// written without one, the target type still reads sensibly ('@capture').
function mentionText(attrs: Record<string, unknown>): string {
  const { targetType, label } = attrs
  // Object.hasOwn, never a bare index: targetType arrives off a pasted
  // attribute, and eight Object.prototype names would otherwise resolve to a
  // function here.
  const sigil =
    typeof targetType === 'string' && Object.hasOwn(MENTION_SIGIL, targetType)
      ? MENTION_SIGIL[targetType as MentionTargetType]
      : ''
  const text = typeof label === 'string' && label.length > 0 ? label : String(targetType)
  return sigil + text
}

/**
 * A typed inline reference to a Capture, Selector, Tag, or another Note.
 * Identity is (targetType, targetId) — never the label, which is only a
 * display cache captured at insertion time; the referenced row may be renamed
 * or deleted without changing what the Mention points at.
 *
 * No node view here (main loads this module); the editor attaches its own in
 * the renderer (#390). parseHTML restores nothing attribute-wise on purpose —
 * attribute-level parseHTML callbacks need DOM types this module's node-side
 * consumers do not compile against.
 */
function mentionNode() {
  return TiptapNode.create({
    name: 'mention',
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes() {
      return {
        targetType: { default: null },
        targetId: { default: null },
        label: { default: '' }
      }
    },
    renderText({ node }) {
      return mentionText(node.attrs)
    },
    parseHTML() {
      return [{ tag: 'span[data-mention]' }]
    },
    renderHTML({ node }) {
      return [
        'span',
        {
          'data-mention': '',
          'data-target-type': String(node.attrs.targetType),
          'data-target-id': String(node.attrs.targetId)
        },
        mentionText(node.attrs)
      ]
    }
  })
}

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
    }),
    mentionNode()
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
 * Build the checked ProseMirror tree for a document, or throw.
 *
 * check() enforces the schema's content expressions only: an attribute
 * configured with a default passes as null, so a Mention with no attrs is a
 * schema-valid document to ProseMirror. Mention identity attrs are therefore
 * validated explicitly here, on the checked tree — which is also the tree
 * extraction walks, so the references index can never see a node the
 * validator rejected.
 */
function checkedNoteNode(doc: JSONContent): Node {
  let node: Node
  try {
    // fromJSON rejects unknown node and mark types but builds whatever
    // structure it is handed — a text node directly under the document
    // survives it, and so would have survived deriving text from it. check()
    // is what enforces the schema's content expressions.
    node = Node.fromJSON(noteSchema(), doc)
    node.check()
  } catch (e) {
    throw new Error(`Note body does not fit the note schema: ${(e as Error).message}`)
  }
  node.descendants((child) => {
    if (child.type.name !== 'mention') return true
    const { targetType, targetId } = child.attrs
    if (!(MENTION_TARGET_TYPES as readonly string[]).includes(targetType)) {
      throw new Error(
        `Note body contains a Mention whose targetType is not one of ${MENTION_TARGET_TYPES.join(', ')}`
      )
    }
    if (typeof targetId !== 'string' || targetId.length === 0) {
      throw new Error('Note body contains a Mention whose targetId is not a non-empty string')
    }
    return false
  })
  return node
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
  checkedNoteNode(doc)
  return doc
}

/**
 * Extract every Mention, in document order, duplicates preserved. Validates
 * as it goes — the walk is over the checked tree, not the raw JSON — so a
 * document that would not survive parseNoteDoc does not yield mentions.
 */
export function extractNoteMentions(doc: JSONContent | string): NoteMention[] {
  const parsed = typeof doc === 'string' ? parseNoteDoc(doc) : doc
  const mentions: NoteMention[] = []
  checkedNoteNode(parsed).descendants((node) => {
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

/**
 * Rewrite Mention target ids inside a serialized document — the archive
 * import's counterpart to remapAnchorIds, applied to `body_doc` before the
 * row is parsed and stored. Nothing is validated here: unparseable JSON and
 * malformed mentions pass through unchanged so the subsequent parseNoteDoc
 * rejects them with its normal message instead of a remap-time one.
 */
export function remapMentionTargetIds(
  json: string,
  map: (targetType: MentionTargetType, targetId: string) => string
): string {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return json
  }
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const node = value as JSONContent
    if (
      node.type === 'mention' &&
      node.attrs &&
      typeof node.attrs.targetId === 'string' &&
      (MENTION_TARGET_TYPES as readonly string[]).includes(node.attrs.targetType)
    ) {
      node.attrs.targetId = map(node.attrs.targetType as MentionTargetType, node.attrs.targetId)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc)
  return JSON.stringify(doc)
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
