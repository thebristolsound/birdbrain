import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Editor } from '@tiptap/react'
import type { ReactNode } from 'react'
import { NoteEditor } from '@renderer/components/notes/NoteEditor'
import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { fakeBridge } from '../renderer/fakeBridge'

const PLACEHOLDER = 'Write here'
const BOLD_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' plain' }
      ]
    }
  ]
})

let editor: Editor | null = null

// A host like the real ones: the editor is null on its first render and arrives
// after mount, and nothing re-renders the host while the user types.
function Host({ bodyDoc }: { bodyDoc?: string }) {
  editor = useNoteEditor({ caseId: 'case-1', bodyDoc })
  return <NoteEditor editor={editor} placeholder={PLACEHOLDER} />
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function mount(bodyDoc?: string) {
  render(<Host bodyDoc={bodyDoc} />, { wrapper })
  await waitFor(() => expect(screen.queryByRole('toolbar')).not.toBeNull())
  return editor!
}

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed')
const disabled = (name: string) => screen.getByRole('button', { name }).hasAttribute('disabled')

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
  cleanup()
  editor?.destroy()
})

describe('NoteEditor with an editor that arrives after mount', () => {
  it('does not show the placeholder over a note that opens with content', async () => {
    await mount(BOLD_DOC)
    expect(screen.queryByText(PLACEHOLDER)).toBeNull()
  })

  it('hides and restores the placeholder as the note is written and cleared', async () => {
    const editor = await mount()
    expect(screen.queryByText(PLACEHOLDER)).not.toBeNull()
    act(() => {
      editor.commands.insertContent('Observed')
    })
    expect(screen.queryByText(PLACEHOLDER)).toBeNull()
    act(() => {
      editor.commands.clearContent(true)
    })
    expect(screen.queryByText(PLACEHOLDER)).not.toBeNull()
  })

  it('keeps the toolbar following the cursor and history', async () => {
    const editor = await mount(BOLD_DOC)
    act(() => {
      editor.commands.setTextSelection(2)
    })
    expect(pressed('Bold')).toBe('true')
    act(() => {
      editor.commands.setTextSelection(8)
    })
    expect(pressed('Bold')).toBe('false')
    expect(disabled('Undo')).toBe(true)
    act(() => {
      editor.commands.insertContent('more')
    })
    expect(disabled('Undo')).toBe(false)
  })
})
