import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Note } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), blocker: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' }),
  useNavigate: () => mocks.navigate,
  useBlocker: mocks.blocker
}))
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))
import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { NOTE_COMPOSER_EVENT, openNoteComposer } from '@renderer/components/onboarding/tourEffects'
import { fakeBridge } from '../renderer/fakeBridge'

const makeNote = (id: string, title: string, extra: Partial<Note> = {}): Note => ({
  id,
  caseId: 'case-1',
  title,
  body: `${title} body`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra
})
let notes: Note[]
let update: ReturnType<typeof vi.fn>
let create: ReturnType<typeof vi.fn>
let list: ReturnType<typeof vi.fn>
let search: ReturnType<typeof vi.fn>
function renderNotes() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(
    <QueryClientProvider client={client}>
      <NotesOverview />
    </QueryClientProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  notes = []
  useAppStore.getState().setSelectedNoteId(null)
  list = vi.fn(async () => [...notes])
  search = vi.fn(async (_caseId, query: string) =>
    notes.filter((n) => `${n.title} ${n.body}`.includes(query))
  )
  update = vi.fn(async ({ id, ...draft }) => {
    const note = { ...notes.find((n) => n.id === id)!, ...draft }
    notes = notes.map((n) => (n.id === id ? note : n))
    return note
  })
  create = vi.fn(async (params) => {
    const note = makeNote(`new-${notes.length}`, params.title, params)
    notes = [...notes, note]
    return note
  })
  fakeBridge({
    notes: {
      list,
      search,
      update,
      create,
      delete: vi.fn(async (id) => {
        notes = notes.filter((n) => n.id !== id)
        return true
      })
    },
    captures: { list: vi.fn(async () => []), getThumbnail: vi.fn(async () => 'thumb') },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
    tags: { list: vi.fn(async () => []), usageCountsForCase: vi.fn(async () => ({})) }
  })
})
afterEach(cleanup)

async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), {
    button: 0,
    ctrlKey: false,
    pointerType: 'mouse'
  })
  await screen.findByRole('menu')
}

describe('Notes workspace', () => {
  it('creates from the compact plus control and keeps one live editor with a saved title', async () => {
    renderNotes()
    expect(await screen.findByText('No notes yet')).toBeTruthy()
    expect(screen.getByText(/Start one and reference captures with @/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New note' }))
    const title = await screen.findByLabelText('Note title')
    fireEvent.change(title, { target: { value: 'Field observations' } })
    fireEvent.blur(title)
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Field observations' }))
    )
    expect(screen.getAllByTestId('note-body-input')).toHaveLength(1)
    expect(await screen.findByText('1 note in this case')).toBeTruthy()
    expect(await screen.findByText('Saved just now')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New note' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle note context' }))
    expect(screen.queryByLabelText('Note context')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle note context' }))
    expect(screen.getByLabelText('Note context')).toBeTruthy()
  })

  it('opens the composer for the tour and unregisters the same listener', async () => {
    const added = vi.spyOn(window, 'addEventListener')
    const removed = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderNotes()
    await screen.findByTestId('notes-new-button')
    act(() => openNoteComposer())
    await waitFor(() => expect(document.querySelector('[data-tour="noteeditor"]')).toBeTruthy())
    const registration = added.mock.calls.find(([type]) => type === NOTE_COMPOSER_EVENT)!
    unmount()
    expect(
      removed.mock.calls.some(([type, fn]) => type === registration[0] && fn === registration[1])
    ).toBe(true)
  })

  it('sorts, filters actual body tags and dates, switches row layouts, and clears narrowed empty states', async () => {
    const bodyDoc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { targetType: 'tag', targetId: 'tag-1', label: 'research' } }
          ]
        }
      ]
    })
    notes = [
      makeNote('a', 'Zulu'),
      makeNote('b', 'Alpha', { bodyDoc, createdAt: '2020-01-01T00:00:00Z' })
    ]
    renderNotes()
    await screen.findByTestId('note-row-a')
    expect(screen.getAllByText('No linked capture')).toHaveLength(2)
    await openMenu('Sort notes')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Title A–Z' }))
    expect(
      within(screen.getByTestId('notes-list')).getAllByRole('button')[0].getAttribute('data-testid')
    ).toBe('note-row-b')
    await openMenu('Sort notes')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Oldest first' }))
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(screen.queryByText('No linked capture')).toBeNull()
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Detailed view' }))
    await openMenu('Filter notes')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '#research' }))
    expect(screen.getByText('1 of 2 notes shown')).toBeTruthy()
    await openMenu('Filter notes')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Last 24 hours' }))
    expect(screen.getByText('No notes match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('2 notes in this case')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'absent' } })
    await screen.findByText('No notes match')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('2 notes in this case')).toBeTruthy()
  })

  it('flushes before switching and keeps failed drafts visible for retry', async () => {
    notes = [makeNote('a', 'First'), makeNote('b', 'Second')]
    renderNotes()
    const title = await screen.findByLabelText('Note title')
    fireEvent.change(title, { target: { value: 'Unsaved first' } })
    update.mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByTestId('note-row-b'))
    await screen.findByText('Could not save')
    expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Unsaved first')
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }))
    await screen.findByText('Saved just now')
    fireEvent.click(screen.getByTestId('note-row-b'))
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Second')
    )
    expect(screen.getAllByTestId('note-body-input')).toHaveLength(1)
    act(() => useAppStore.getState().setSelectedNoteId('a'))
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Unsaved first')
    )
  })

  it('opens the archived linked capture, then deletes a note only after confirmation', async () => {
    notes = [
      makeNote('a', 'Linked', { captureId: 'capture-1', sourceUrl: 'https://example.com/page' })
    ]
    renderNotes()
    fireEvent.click(await screen.findByTitle('Open linked capture'))
    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/cases/$caseId/captures',
        params: { caseId: 'case-1' }
      })
    )
    expect(useAppStore.getState().selectedCaptureId).toBe('capture-1')
    fireEvent.click(screen.getByTestId('note-delete'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByTestId('note-confirm-delete')).toBeNull()
    fireEvent.click(screen.getByTestId('note-delete'))
    fireEvent.click(screen.getByTestId('note-confirm-delete'))
    await screen.findByText('No notes yet')
  })

  it('keeps note-row menus, keyboard selection and context links connected to the real targets', async () => {
    const bodyDoc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { targetType: 'note', targetId: 'b', label: 'Second' } },
            { type: 'mention', attrs: { targetType: 'tag', targetId: 'missing', label: 'Old tag' } }
          ]
        }
      ]
    })
    notes = [
      makeNote('a', 'First', { bodyDoc, sourceUrl: 'https://example.com' }),
      makeNote('b', 'Second')
    ]
    renderNotes()
    await screen.findByTestId('note-row-a')
    const rail = screen.getByLabelText('Note context')
    expect(
      within(rail)
        .getByText(/Old tag/)
        .closest('button')?.disabled
    ).toBe(true)
    fireEvent.click(within(rail).getByRole('button', { name: /Second/ }))
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Second')
    )
    fireEvent.click(
      within(screen.getByLabelText('Note context')).getByRole('button', { name: /First/ })
    )
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('First')
    )
    fireEvent.keyDown(screen.getByTestId('note-row-b'), { key: 'Enter' })
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('Second')
    )
    fireEvent.contextMenu(screen.getByTestId('note-row-a'))
    fireEvent.click(await screen.findByTestId('context-menu-item-note-edit'))
    await waitFor(() =>
      expect((screen.getByLabelText('Note title') as HTMLInputElement).value).toBe('First')
    )
    fireEvent.contextMenu(screen.getByTestId('note-row-a'))
    fireEvent.click(await screen.findByTestId('context-menu-item-note-delete'))
    await screen.findByTestId('note-confirm-delete')
    fireEvent.click(screen.getByText('Cancel'))
    const blocker = mocks.blocker.mock.calls.at(-1)![0]
    expect(await blocker.shouldBlockFn()).toBe(false)
  })

  it('shows retry controls for list and search failures', async () => {
    list.mockRejectedValueOnce(new Error('Read error'))
    renderNotes()
    await screen.findByText('Failed to load notes: Read error')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('No notes yet')
    search.mockRejectedValueOnce(new Error('Search unavailable'))
    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'x' } })
    await screen.findByText('Failed to search notes.')
    fireEvent.click(screen.getByText('Retry search'))
    await screen.findByText('No notes match')
  })
})

describe('NotesOverview density', () => {
  // The list gap was a literal, so the list measured the same on every step
  // (#1540).
  it('spaces the note list with the density list gap', async () => {
    fakeBridge({
      notes: {
        list: vi.fn(async () => [
          {
            id: 'n1',
            caseId: 'case-1',
            title: 'A note',
            body: 'body text',
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z'
          }
        ]),
        search: vi.fn(async () => [])
      },
      captures: { list: vi.fn(async () => []) },
      selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
      tags: { list: vi.fn(async () => []), usageCountsForCase: vi.fn(async () => ({})) }
    })
    renderNotes()

    const list = await screen.findByTestId('notes-list')
    expect(list.className).toContain('gap-[var(--d-listgap)]')
    expect(list.className).not.toContain('space-y-3')
  })
})
