import { describe, it, expect } from 'vitest'
import { getSchema, type JSONContent } from '@tiptap/core'
import {
  EMPTY_NOTE_DOC,
  extractNoteMentions,
  isEmptyNoteDoc,
  noteDocToText,
  noteExtensions,
  parseNoteDoc,
  plainTextToNoteDoc,
  remapMentionTargetIds
} from '@shared/noteDoc'

const RICH_DOC = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Observation' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The account was ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'created' },
        { type: 'text', text: ' on 4 April.' }
      ]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Same handle' }] }]
        }
      ]
    }
  ]
}

describe('noteDoc', () => {
  it('derives plain text that carries every word of the document', () => {
    const text = noteDocToText(RICH_DOC)

    expect(text).toContain('Observation')
    expect(text).toContain('The account was created on 4 April.')
    expect(text).toContain('Same handle')
  })

  it('separates blocks by newline so a phrase cannot span two paragraphs', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'beta' }] }
      ]
    }

    // 'alphabeta' would be indexed as a token the note never contained.
    expect(noteDocToText(doc)).toBe('alpha\nbeta')
  })

  it('treats an empty document as empty text', () => {
    expect(noteDocToText(EMPTY_NOTE_DOC)).toBe('')
    expect(isEmptyNoteDoc(EMPTY_NOTE_DOC)).toBe(true)
    expect(isEmptyNoteDoc(RICH_DOC)).toBe(false)
  })

  it('round-trips legacy plain text through the document form', () => {
    const text = 'first line\n\nthird line'
    const doc = plainTextToNoteDoc(text)

    expect(noteDocToText(doc)).toBe(text)
  })

  it('parses a serialized document', () => {
    expect(parseNoteDoc(JSON.stringify(RICH_DOC))).toEqual(RICH_DOC)
  })

  it('rejects a body that is not JSON', () => {
    expect(() => parseNoteDoc('not json')).toThrow(/not valid JSON/)
  })

  it('rejects JSON that is not a ProseMirror document', () => {
    expect(() => parseNoteDoc('{"type":"paragraph"}')).toThrow(/not a ProseMirror document/)
    expect(() => parseNoteDoc('null')).toThrow(/not a ProseMirror document/)
  })

  it('rejects a document containing a node outside the shared schema', () => {
    // codeBlock is disabled in noteExtensions(); a renderer that added it
    // locally must not be able to persist content main cannot re-render.
    const rogue = JSON.stringify({
      type: 'doc',
      content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'rm -rf' }] }]
    })

    expect(() => parseNoteDoc(rogue)).toThrow(/does not fit the note schema/)
  })

  it('rejects a document whose nodes are known but arranged against the schema', () => {
    // Every node type here exists. Only the arrangement is illegal: doc holds
    // blocks, and this puts inline text directly inside it. Deriving text from
    // such a document succeeds, so text derivation alone is not validation —
    // the schema's content expressions have to be checked explicitly.
    const bareText = JSON.stringify({
      type: 'doc',
      content: [{ type: 'text', text: 'no paragraph around me' }]
    })

    expect(() => parseNoteDoc(bareText)).toThrow(/does not fit the note schema/)
  })

  it('rejects a mark applied where the schema does not allow it', () => {
    const markedParagraph = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', marks: [{ type: 'bold' }] }]
    })

    expect(() => parseNoteDoc(markedParagraph)).toThrow(/does not fit the note schema/)
  })

  it('accepts every document the editor can actually produce', () => {
    // Guards against the structural check being stricter than the editor.
    expect(() => parseNoteDoc(JSON.stringify(EMPTY_NOTE_DOC))).not.toThrow()
    expect(() => parseNoteDoc(JSON.stringify(RICH_DOC))).not.toThrow()
    expect(() => parseNoteDoc(JSON.stringify(plainTextToNoteDoc('a\n\nb')))).not.toThrow()
  })
})

// --- Mentions (#389) --------------------------------------------------------

function mention(targetType: unknown, targetId: unknown, label = ''): JSONContent {
  return { type: 'mention', attrs: { targetType, targetId, label } }
}

function docWith(...inline: JSONContent[]): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph', content: inline }] }
}

const text = (t: string): JSONContent => ({ type: 'text', text: t })

describe('noteDoc mentions', () => {
  it('accepts an inline Mention with valid attrs, for every target type', () => {
    for (const targetType of ['capture', 'selector', 'tag', 'note']) {
      const doc = docWith(text('see '), mention(targetType, 'id-1', 'Label'))
      expect(() => parseNoteDoc(JSON.stringify(doc))).not.toThrow()
    }
  })

  it('leaves documents without Mentions unaffected', () => {
    // The four real v27 bodies validated unchanged in the spike; the schema
    // addition must stay purely additive.
    expect(parseNoteDoc(JSON.stringify(RICH_DOC))).toEqual(RICH_DOC)
    expect(extractNoteMentions(RICH_DOC)).toEqual([])
  })

  it('rejects a Mention with no attrs — PM check() alone would accept it', () => {
    const doc = docWith({ type: 'mention' })
    expect(() => parseNoteDoc(JSON.stringify(doc))).toThrow(/Mention/)
  })

  it('rejects a Mention whose targetType is off the enum', () => {
    const doc = docWith(mention('bogus', 'id-1'))
    expect(() => parseNoteDoc(JSON.stringify(doc))).toThrow(/targetType/)
  })

  it('rejects a Mention whose targetId is not a non-empty string', () => {
    expect(() => parseNoteDoc(JSON.stringify(docWith(mention('capture', 42))))).toThrow(/targetId/)
    expect(() => parseNoteDoc(JSON.stringify(docWith(mention('capture', ''))))).toThrow(/targetId/)
  })

  it('rejects a Mention at block level', () => {
    const doc = { type: 'doc', content: [mention('tag', 't-1')] }
    expect(() => parseNoteDoc(JSON.stringify(doc))).toThrow(/does not fit the note schema/)
  })

  it('derives searchable text from the label, falling back to the target type', () => {
    // Each kind carries its own sigil, the one the chip shows. This read '@tag'
    // while the sigil map lived only in the renderer, so the indexed and
    // exported text disagreed with the '#tag' chip the note displayed.
    const doc = docWith(
      text('see '),
      mention('capture', 'c-1', 'Acme homepage'),
      text(' and '),
      mention('tag', 't-1')
    )
    expect(noteDocToText(doc)).toBe('see @Acme homepage and #tag')
  })

  it('extracts mentions in document order, duplicates preserved', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [mention('capture', 'c-1', 'A'), mention('tag', 't-1')] },
        { type: 'paragraph', content: [mention('capture', 'c-1', 'A again')] }
      ]
    }
    expect(extractNoteMentions(doc)).toEqual([
      { targetType: 'capture', targetId: 'c-1', label: 'A' },
      { targetType: 'tag', targetId: 't-1', label: '' },
      { targetType: 'capture', targetId: 'c-1', label: 'A again' }
    ])
  })

  it('extracts from a serialized string, inheriting full validation', () => {
    const doc = docWith(mention('note', 'n-1', 'other note'))
    expect(extractNoteMentions(JSON.stringify(doc))).toEqual([
      { targetType: 'note', targetId: 'n-1', label: 'other note' }
    ])
    expect(() => extractNoteMentions(JSON.stringify(docWith(mention('bogus', 'x'))))).toThrow(
      /targetType/
    )
    expect(() => extractNoteMentions('{oops')).toThrow(/not valid JSON/)
  })

  it('remaps target ids by type, leaving malformed mentions for the validator', () => {
    const doc = docWith(
      mention('capture', 'c-1'),
      mention('tag', 't-1'),
      mention('bogus', 'x-1'),
      mention('note', 42)
    )
    const remapped = JSON.parse(
      remapMentionTargetIds(JSON.stringify(doc), (targetType, targetId) =>
        targetType === 'tag' ? `tag:${targetId}` : `id:${targetId}`
      )
    ) as JSONContent
    const attrs = remapped.content![0].content!.map((n) => n.attrs)
    expect(attrs[0]!.targetId).toBe('id:c-1')
    expect(attrs[1]!.targetId).toBe('tag:t-1')
    // Off-enum and non-string ids pass through untouched so parseNoteDoc
    // rejects them with its normal message, not a remap-time one.
    expect(attrs[2]!.targetId).toBe('x-1')
    expect(attrs[3]!.targetId).toBe(42)
  })

  it('passes unparseable input through the remap unchanged', () => {
    expect(remapMentionTargetIds('{not json', () => 'x')).toBe('{not json')
  })

  it('serializes to a span carrying identity as data attributes', () => {
    // The DOM shape the renderer's editor (#390) will hydrate from. toDOM is
    // invoked directly because main-side tests have no DOM to serialize into.
    const schema = getSchema(noteExtensions())
    const node = schema.nodes.mention.create({
      targetType: 'capture',
      targetId: 'c-1',
      label: 'Acme'
    })
    expect(schema.nodes.mention.spec.toDOM!(node)).toEqual([
      'span',
      { 'data-mention': '', 'data-target-type': 'capture', 'data-target-id': 'c-1' },
      '@Acme'
    ])
  })
})
