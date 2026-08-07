import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { noteExtensions, plainTextToNoteDoc, EMPTY_NOTE_DOC } from '@shared/noteDoc'

/**
 * The inline note editor decides whether it has unsaved work by comparing the
 * editor's serialized document against the serialization of what the server
 * holds. That comparison is only sound if loading a document into the editor
 * and serializing it back produces the same bytes — otherwise every legacy
 * note would look dirty the moment it was opened, and autosave would rewrite
 * notes nobody touched.
 */
describe('note document serialization fidelity', () => {
  const cases = ['hello', 'a\nb', 'a\n\nb', '', 'line with  spaces', 'trailing newline\n']

  it.each(cases)('round-trips lifted plain text byte-identically: %j', (text) => {
    const doc = plainTextToNoteDoc(text)
    const editor = new Editor({ extensions: noteExtensions(), content: doc })

    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(doc))

    editor.destroy()
  })

  it('round-trips the empty document', () => {
    const editor = new Editor({ extensions: noteExtensions(), content: EMPTY_NOTE_DOC })

    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(EMPTY_NOTE_DOC))

    editor.destroy()
  })

  it('round-trips a formatted document', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Finding' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'The handle ' },
            { type: 'text', marks: [{ type: 'italic' }], text: 'nightjar' },
            { type: 'text', text: ' recurs.' }
          ]
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two sites' }] }]
            }
          ]
        }
      ]
    }
    const editor = new Editor({ extensions: noteExtensions(), content: doc })

    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(doc))

    editor.destroy()
  })
})
