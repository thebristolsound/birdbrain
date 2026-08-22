import { describe, it, expect } from 'vitest'
import { Editor, getSchema } from '@tiptap/core'
import {
  EMPTY_NOTE_DOC,
  noteDocToText,
  noteExtensions,
  parseNoteDoc,
  plainTextToNoteDoc
} from '@shared/noteDoc'
import { EMPTY_MENTION_SOURCES } from '@renderer/components/notes/mention/mentionModel'
import { rendererNoteExtensions } from '@renderer/components/notes/mention/rendererNoteExtensions'

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

/**
 * The renderer adds a chip and two autocompletes on top of the shared note
 * schema. Main derives every note's indexed text — and every exported
 * report's — from that same schema, so the renderer's list has to describe
 * exactly the same document model. These are the known-answer checks that it
 * still does.
 */
describe('renderer note extensions leave the document model alone', () => {
  const rendererExtensions = () =>
    rendererNoteExtensions({ caseId: 'case1', getSources: () => EMPTY_MENTION_SOURCES })

  it('declares exactly the nodes and marks the shared list declares', () => {
    const shared = getSchema(noteExtensions())
    const renderer = getSchema(rendererExtensions())

    expect(Object.keys(renderer.nodes)).toEqual(Object.keys(shared.nodes))
    expect(Object.keys(renderer.marks)).toEqual(Object.keys(shared.marks))
  })

  it("leaves the Mention node's attributes and structure byte-identical", () => {
    const shared = getSchema(noteExtensions()).spec.nodes.get('mention')
    const renderer = getSchema(rendererExtensions()).spec.nodes.get('mention')

    expect(JSON.stringify(renderer?.attrs)).toBe(JSON.stringify(shared?.attrs))
    expect(renderer?.group).toBe(shared?.group)
    expect(renderer?.inline).toBe(shared?.inline)
    expect(renderer?.atom).toBe(shared?.atom)
    expect(renderer?.content).toBe(shared?.content)
  })

  it('round-trips a document containing a Mention byte-identically', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Seen on ' },
            {
              type: 'mention',
              attrs: { targetType: 'capture', targetId: 'cap1', label: 'Nightjar thread' }
            },
            { type: 'text', text: ' twice.' }
          ]
        }
      ]
    }
    const editor = new Editor({ extensions: rendererExtensions(), content: doc })

    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(doc))
    // And the document main would accept is the document the renderer produced.
    expect(() => parseNoteDoc(JSON.stringify(editor.getJSON()))).not.toThrow()

    editor.destroy()
  })

  it('derives the same indexed text from a Mention as it always did', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { targetType: 'selector', targetId: 's1', label: 'nightjar' }
            }
          ]
        }
      ]
    }
    const editor = new Editor({ extensions: rendererExtensions(), content: doc })

    expect(noteDocToText(editor.getJSON())).toBe('@nightjar')

    editor.destroy()
  })
})
