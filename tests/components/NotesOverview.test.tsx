// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' })
}))

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { NotesOverview } from '@renderer/components/notes/NotesOverview'
import { openNoteComposer } from '@renderer/components/onboarding/tourEffects'
import { fakeBridge } from '../renderer/fakeBridge'

function stubBridge() {
  fakeBridge({
    notes: { list: vi.fn(async () => []), search: vi.fn(async () => []) },
    captures: { list: vi.fn(async () => []) },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
    tags: { list: vi.fn(async () => []), usageCountsForCase: vi.fn(async () => ({})) }
  })
}

function renderNotes() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<NotesOverview />, { wrapper: Wrapper })
}

beforeEach(stubBridge)
afterEach(cleanup)

/**
 * The receiving half of the case tour's note-editor step (#405, Q2).
 *
 * The sending half is asserted in OnboardingTour.test.tsx, and the e2e walk
 * asserts the mark is anchored end to end. Neither pins this listener on its
 * own, and without it the step degrades to the centred card the Q2 ruling
 * rejected — silently, because a missing anchor still renders a usable mark.
 */
describe('NotesOverview and the tour composer request', () => {
  it('opens the composer when the tour asks for one', async () => {
    renderNotes()
    expect(await screen.findByTestId('notes-new-button')).toBeTruthy()

    act(() => openNoteComposer())

    // The editor carrying the step's `noteeditor` anchor is mounted now.
    await waitFor(() => expect(document.querySelector('[data-tour="noteeditor"]')).toBeTruthy())
    expect(screen.queryByTestId('notes-new-button')).toBeNull()
  })

  it('stops listening once the screen is gone', async () => {
    const { unmount } = renderNotes()
    await screen.findByTestId('notes-new-button')

    unmount()

    // No listener, so nothing to open — and nothing to throw on a screen the
    // operator has already navigated away from.
    act(() => openNoteComposer())
    expect(document.querySelector('[data-tour="noteeditor"]')).toBeNull()
  })
})
