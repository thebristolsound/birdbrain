// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditorContent, type Editor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { parseNoteDoc } from '@shared/noteDoc'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { fakeBridge } from '../renderer/fakeBridge'

const MENTION_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Seen on ' },
        {
          type: 'mention',
          attrs: { targetType: 'selector', targetId: 's1', label: 'nightjar' }
        },
        { type: 'text', text: ' twice.' }
      ]
    }
  ]
})

let editor: Editor | null = null

function Harness({ bodyDoc }: { bodyDoc: string }) {
  const instance = useNoteEditor({ caseId: 'case1', bodyDoc })
  editor = instance
  return <EditorContent editor={instance} />
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function mountEditor(bodyDoc = MENTION_DOC): Promise<Editor> {
  render(<Harness bodyDoc={bodyDoc} />, { wrapper: Wrapper })
  await waitFor(() => expect(editor).not.toBeNull())
  return editor!
}

/** What the clipboard would receive for the whole document. */
function copyAll(instance: Editor): string {
  const serialize = instance.view.someProp('clipboardTextSerializer')
  return serialize!(instance.state.doc.slice(0), instance.view)
}

beforeEach(() => {
  editor = null
  fakeBridge({
    captures: { list: vi.fn(async () => []) },
    notes: { list: vi.fn(async () => []) },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
    tags: { list: vi.fn(async () => []), usageCountsForCase: vi.fn(async () => ({})) }
  })
})

afterEach(() => {
  editor?.destroy()
  cleanup()
})

describe('copying a note out of the editor', () => {
  it('renders a Mention as its sigil plus label rather than as nothing', async () => {
    // Without an explicit serializer ProseMirror falls back to textBetween,
    // which reads a leafText spec Tiptap never sets — an atom copies as the
    // empty string and the sentence loses the entity it was about.
    const instance = await mountEditor()

    expect(copyAll(instance)).toBe('Seen on #nightjar twice.')
  })

  it('does not elide a long label on the way to the clipboard', async () => {
    const long = 'x'.repeat(40)
    const instance = await mountEditor(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'mention', attrs: { targetType: 'capture', targetId: 'c1', label: long } }
            ]
          }
        ]
      })
    )

    expect(copyAll(instance)).toBe(`@${long}`)
  })

  it('falls back to the target type when a Mention was written without a label', async () => {
    const instance = await mountEditor(
      JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'mention', attrs: { targetType: 'tag', targetId: 't1', label: '' } }]
          }
        ]
      })
    )

    expect(copyAll(instance)).toBe('#tag')
  })
})

describe('pasting a Mention back as HTML', () => {
  it('restores both identity attributes and the label', async () => {
    const instance = await mountEditor()
    instance.commands.setContent(
      '<p><span data-mention data-target-type="capture" data-target-id="cap1">@Nightjar thread</span></p>'
    )

    const [mention] = instance.getJSON().content![0].content! as { attrs?: unknown }[]
    expect(mention.attrs).toEqual({
      targetType: 'capture',
      targetId: 'cap1',
      label: 'Nightjar thread'
    })
  })

  it('degrades markup with no identity to text rather than to a note that cannot save', async () => {
    // The failure this replaces: the span parsed to a Mention with null attrs,
    // and the next save of the note threw out of the shared validator — losing
    // the whole note, not just the chip.
    const instance = await mountEditor()
    instance.commands.setContent('<p><span data-mention>@Nightjar thread</span></p>')

    const json = JSON.stringify(instance.getJSON())
    expect(json).not.toContain('mention')
    expect(instance.getText()).toBe('@Nightjar thread')
    expect(() => parseNoteDoc(json)).not.toThrow()
  })

  // 'null' covers a value that is simply not on the allowlist. 'constructor'
  // covers the other half: a key that `in` would have found on the prototype
  // chain, which is what isMentionTargetType's Object.hasOwn is there to stop.
  it.each(['null', 'constructor'])(
    'degrades a target type the model does not define: %j',
    async (rawType) => {
      const instance = await mountEditor()
      instance.commands.setContent(
        `<p><span data-mention data-target-type="${rawType}" data-target-id="x1">@capture</span></p>`
      )

      expect(() => parseNoteDoc(JSON.stringify(instance.getJSON()))).not.toThrow()
      expect(JSON.stringify(instance.getJSON())).not.toContain('mention')
    }
  )
})
