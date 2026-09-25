// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Note } from '@shared/types'

// Hoisted: the factory runs while NoteCard's import graph is still loading,
// which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { NoteCard } from '@renderer/components/notes/NoteCard'
import { fakeBridge } from '../renderer/fakeBridge'

const note: Note = {
  id: 'note1',
  caseId: 'case1',
  captureId: undefined,
  title: 'A note',
  body: 'body text',
  bodyDoc: undefined,
  sourceUrl: 'https://example.com/thread/42',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

let openExternal: ReturnType<typeof vi.fn>
// Held so the assertion can be on identity: the handler must pass the original
// rejection through as `cause`, not a rewrapped stand-in.
let cause: Error

function renderCard(selected = false, override: Note = note) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<NoteCard note={override} caseId="case1" selected={selected} />, {
    wrapper: Wrapper
  })
}

async function openCardMenu() {
  fireEvent.contextMenu(screen.getByTestId('note-card-note1'))
  return screen.findByRole('menu')
}

beforeEach(() => {
  cause = new Error('EACCES')
  openExternal = vi.fn(async () => {
    throw cause
  })
  fakeBridge({ captures: { openExternal } })
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
})

describe('NoteCard', () => {
  it("reports a failed shell launch when the note's source URL cannot be opened", async () => {
    renderCard()

    fireEvent.click(screen.getByText(note.sourceUrl!))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(openExternal).toHaveBeenCalledWith('https://example.com/thread/42')
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the note's source URL is operator-supplied
    // content, and a fixed literal with nothing interpolated into it is what
    // keeps it out of the durable log. A message that grew the URL would fail
    // here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  // The dashboard activity feed (#403) navigates here with one note selected;
  // aria-current is how the arrived-at note is marked.
  it('marks itself as current only when selected', () => {
    renderCard()
    expect(screen.getByTestId('note-card-note1').getAttribute('aria-current')).toBeNull()

    cleanup()
    renderCard(true)
    expect(screen.getByTestId('note-card-note1').getAttribute('aria-current')).toBe('true')
  })

  // The mock's list row scales only its horizontal inset; the vertical one is a
  // fixed 9px at every step (#1540).
  it('takes its horizontal inset from the density item step', () => {
    renderCard()
    const { className } = screen.getByTestId('note-card-note1')
    expect(className).toContain('px-[var(--d-itemx)]')
    expect(className).toContain('py-[9px]')
    expect(className).not.toContain('p-4')
  })

  it('says nothing when the source URL opens successfully', async () => {
    openExternal.mockResolvedValue(undefined)
    renderCard()

    fireEvent.click(screen.getByText(note.sourceUrl!))

    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    expect(notifyError).not.toHaveBeenCalled()
  })
})

// #701. The card is its own adoption point, so every menu item lands on the
// control beside it rather than on a second implementation.
describe('NoteCard context menu', () => {
  it('names the note and offers its actions with menu customisation', async () => {
    renderCard()
    const menu = await openCardMenu()

    expect(menu.getAttribute('aria-label')).toBe('Note actions: A note')
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Edit note',
      'Open source URL',
      'Delete note…',
      'Customise this menu…'
    ])
  })

  it('opens the same editor the pencil does', async () => {
    renderCard()
    await openCardMenu()

    fireEvent.click(screen.getByTestId('context-menu-item-note-edit'))

    expect(await screen.findByTestId('note-title-input')).toBeTruthy()
  })

  // Delete goes through the card's own confirm step, not straight to the
  // mutation: a right-click is easy to land on the wrong row.
  it('arms the delete confirmation rather than deleting', async () => {
    renderCard()
    await openCardMenu()

    fireEvent.click(screen.getByTestId('context-menu-item-note-delete'))

    expect(await screen.findByTestId('note-confirm-delete')).toBeTruthy()
  })

  it('opens the source URL through the card’s own handler', async () => {
    openExternal.mockResolvedValue(undefined)
    renderCard()
    await openCardMenu()

    fireEvent.click(screen.getByTestId('context-menu-item-note-open-source'))

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://example.com/thread/42'))
  })

  it('leaves the item out for a note written against no page', async () => {
    renderCard(false, { ...note, sourceUrl: undefined })
    await openCardMenu()

    expect(screen.queryByTestId('context-menu-item-note-open-source')).toBeNull()
  })
})
