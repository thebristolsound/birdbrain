// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { EditorContent, type Editor } from '@tiptap/react'
import type { ReactNode } from 'react'
import type { Capture, Selector, Tag } from '@shared/types'
import { parseNoteDoc } from '@shared/noteDoc'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { useMentionSources } from '@renderer/components/notes/mention/useMentionSources'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver } from './resizeObserverStub'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/thread',
  title: 'Nightjar thread',
  hash: 'h',
  timestamp: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  format: 'mhtml',
  method: 'extension'
}

const selector: Selector = {
  id: 's1',
  caseId: 'case1',
  pattern: 'nightjar',
  isRegex: false,
  enabled: true,
  label: 'Handle',
  createdAt: '2026-08-01T00:00:00.000Z'
}

const tag: Tag = { id: 't1', name: 'suspect', color: '#22c55e' }

// Seeded under a different case so the popup has something it must not offer.
// Both share the query word, so a fake that ignored its caseId argument would
// put them in the rows rather than merely fail to filter them out.
const otherCapture: Capture = { ...capture, id: 'cap9', caseId: 'case9', title: 'Nightjar decoy' }

const otherSelector: Selector = { ...selector, id: 's9', caseId: 'case9', label: 'Decoy handle' }

// Tags are installation-wide, so the list query returns this one whatever the
// case. What is per-case is the usage that decides whether the popup offers it.
const otherTag: Tag = { id: 't9', name: 'suspect-decoy', color: '#ef4444' }

function capturesFor(caseId: string): Capture[] {
  return [capture, otherCapture].filter((c) => c.caseId === caseId)
}

function selectorsFor(caseId: string): Selector[] {
  return [selector, otherSelector].filter((s) => s.caseId === caseId)
}

let editor: Editor | null = null
let loaded = false

// Held rather than reached for through window.birdbrain, which is typed as the
// real bridge and so carries no call history on its methods.
let listCaptures: ReturnType<typeof vi.fn>
let listNotes: ReturnType<typeof vi.fn>
let listSelectors: ReturnType<typeof vi.fn>
let matchCounts: ReturnType<typeof vi.fn>
let usageCounts: ReturnType<typeof vi.fn>

function Harness() {
  const instance = useNoteEditor({ caseId: 'case1', testId: 'body' })
  // Same query cache as the editor's own subscription, so this is the signal
  // that the popup would have something to offer.
  const sources = useMentionSources('case1')
  editor = instance
  loaded = sources.loaded.capture && sources.loaded.tag && sources.loaded.selector
  return <EditorContent editor={instance} />
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function mountEditor(): Promise<Editor> {
  render(<Harness />, { wrapper: Wrapper })
  await waitFor(() => expect(editor).not.toBeNull())
  // The autocompletes read the cached lists; wait for them before typing.
  await waitFor(() => expect(loaded).toBe(true))
  return editor!
}

/**
 * Type into the editor the way the plugin sees a keystroke: as a transaction.
 *
 * Awaited, because the popup reaches the DOM through a portal the editor's
 * content component publishes on a microtask.
 */
async function type(instance: Editor, text: string) {
  await act(async () => {
    instance.commands.insertContent(text)
  })
}

/** The suggestion plugin owns Escape, so it is reached through the DOM. */
async function pressInEditor(instance: Editor, key: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  await act(async () => {
    instance.view.dom.dispatchEvent(event)
  })
  return event
}

beforeEach(() => {
  stubResizeObserver()
  editor = null
  loaded = false
  listCaptures = vi.fn(async (caseId: string) => capturesFor(caseId))
  listNotes = vi.fn(async () => [])
  listSelectors = vi.fn(async (caseId: string) => selectorsFor(caseId))
  matchCounts = vi.fn(async (caseId: string) => (caseId === 'case1' ? { s1: 7 } : { s9: 99 }))
  usageCounts = vi.fn(async (caseId: string) => (caseId === 'case1' ? { t1: 4 } : {}))
  fakeBridge({
    captures: { list: listCaptures },
    notes: { list: listNotes },
    selectors: { list: listSelectors, matchCounts },
    tags: { list: vi.fn(async () => [tag, otherTag]), usageCountsForCase: usageCounts }
  })
})

afterEach(() => {
  editor?.destroy()
  cleanup()
})

describe('the @ and # autocompletes', () => {
  it('offers this case’s captures behind @', async () => {
    const instance = await mountEditor()

    await type(instance, '@night')

    expect(await screen.findByTestId('mention-popup')).toBeTruthy()
    expect(screen.getByText('captures · notes')).toBeTruthy()
    expect(screen.getByTestId('mention-option-capture-cap1')).toBeTruthy()
    // A capture in another case matching the same query, which the popup would
    // offer if the list query were asked for the wrong case or for none.
    expect(screen.queryByTestId('mention-option-capture-cap9')).toBeNull()
  })

  it('offers selectors and tags behind #', async () => {
    const instance = await mountEditor()

    await type(instance, '#')

    expect(await screen.findByText('selectors · tags')).toBeTruthy()
    expect(screen.getByTestId('mention-option-selector-s1')).toBeTruthy()
    expect(screen.getByTestId('mention-option-tag-t1')).toBeTruthy()
    expect(screen.queryByTestId('mention-option-selector-s9')).toBeNull()
    // The match count is this case's, not the other case's 99.
    expect(screen.getByText('7 hits')).toBeTruthy()
  })

  it('asks every list query for the case the editor was given', async () => {
    await mountEditor()

    expect(listCaptures).toHaveBeenCalledWith('case1')
    expect(listNotes).toHaveBeenCalledWith('case1')
    expect(listSelectors).toHaveBeenCalledWith('case1')
    expect(matchCounts).toHaveBeenCalledWith('case1')
    expect(usageCounts).toHaveBeenCalledWith('case1')
  })

  it('offers only the tags a capture in this case carries', async () => {
    const instance = await mountEditor()

    await type(instance, '#sus')

    await screen.findByTestId('mention-option-tag-t1')
    const rows = screen.getAllByTestId(/^mention-option-/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['mention-option-tag-t1'])
  })

  it('stays shut mid-word, so an email address is not read as a Mention', async () => {
    const instance = await mountEditor()

    await type(instance, 'alice@example')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('mention-popup')).toBeNull()
  })

  it('shows no popup when nothing matched', async () => {
    const instance = await mountEditor()

    await type(instance, '@zzzz')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByTestId('mention-popup')).toBeNull()
  })

  it('inserts a Mention the note can be saved with, and a space after it', async () => {
    const instance = await mountEditor()
    await type(instance, '@night')
    await screen.findByTestId('mention-popup')

    await pressInEditor(instance, 'Enter')

    await waitFor(() => expect(instance.getText()).toContain('@Nightjar thread'))
    const json = JSON.stringify(instance.getJSON())
    expect(json).toContain('"targetType":"capture"')
    expect(json).toContain('"targetId":"cap1"')
    expect(instance.getText().endsWith(' ')).toBe(true)
    expect(() => parseNoteDoc(json)).not.toThrow()
  })

  it('closes on Escape, marks the key handled, and leaves the note alone', async () => {
    const instance = await mountEditor()
    await type(instance, '@night')
    await screen.findByTestId('mention-popup')
    const before = JSON.stringify(instance.getJSON())

    const event = await pressInEditor(instance, 'Escape')

    // Handled means preventDefault, which is what the dialog and the inline
    // note editor read before deciding to close or revert.
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('mention-popup')).toBeNull())
    expect(JSON.stringify(instance.getJSON())).toBe(before)
  })

  it('narrows the rows as the query grows', async () => {
    const instance = await mountEditor()
    await type(instance, '#')
    await screen.findByTestId('mention-option-tag-t1')

    await type(instance, 'sus')

    await waitFor(() => expect(screen.queryByTestId('mention-option-selector-s1')).toBeNull())
    expect(screen.getByTestId('mention-option-tag-t1')).toBeTruthy()
  })
})
