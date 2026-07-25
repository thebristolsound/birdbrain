import { describe, it, expect } from 'vitest'
import {
  EMPTY_NOTE_DOC,
  isEmptyNoteDoc,
  noteDocToText,
  parseNoteDoc,
  plainTextToNoteDoc
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
