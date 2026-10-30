// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Case } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ caseId: undefined })
}))

import { CommandPalette } from '@renderer/components/layout/CommandPalette'
import { useAppStore } from '@renderer/stores/appStore'
import { TOUR_EVENT } from '@renderer/components/onboarding/startTour'

const CASES: Case[] = []

function makeCase(id: string, name: string): Case {
  return {
    id,
    name,
    isDemo: false,
    createdAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:00:00.000Z',
    archived: false
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  stubMatchMedia()
  navigate.mockClear()
  fakeBridge({
    cases: { list: vi.fn(async () => CASES) },
    captures: { countsByCase: vi.fn(async () => ({})) }
  })
  useAppStore.setState({ commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ commandPaletteOpen: false })
})

describe('the command palette panel', () => {
  it('is a dialog with an accessible name and is marked modal', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    const panel = screen.getByRole('dialog', { name: 'Command palette' })
    expect(panel.getAttribute('aria-modal')).toBe('true')
  })

  // The role belongs to the panel, not the click-catching overlay: naming the
  // overlay would put the dimmed backdrop inside the dialog boundary. `contains`
  // cannot express that on its own, since the backdrop is an ancestor of
  // everything the panel holds and satisfies it identically. The dismiss
  // behaviour is what separates the two nodes.
  it('puts the role on the panel, not on the backdrop that dismisses it', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    const { container } = render(<CommandPalette />, { wrapper: Wrapper })
    const backdrop = container.firstElementChild
    if (!backdrop) throw new Error('the palette rendered no backdrop')
    const panel = screen.getByRole('dialog')

    expect(panel.parentElement).toBe(backdrop)
    expect(panel.contains(screen.getByPlaceholderText('Switch case...'))).toBe(true)

    fireEvent.click(panel)
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
    fireEvent.click(backdrop)
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })

  it('exposes no dialog at all while closed', () => {
    render(<CommandPalette />, { wrapper: Wrapper })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// The palette is hand-rolled, so the dialog primitive's focus half reaches it
// only through useModalFocus and trapTab (#1536).
describe('the command palette focus', () => {
  function renderWithOpener() {
    render(
      <>
        <button data-testid="opener">Notes</button>
        <CommandPalette />
      </>,
      { wrapper: Wrapper }
    )
    const opener = screen.getByTestId('opener')
    opener.focus()
    act(() => useAppStore.setState({ commandPaletteOpen: true }))
    return opener
  }

  it('moves focus into the search input when it opens', () => {
    renderWithOpener()

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Switch case...'))
  })

  it('hands focus back to whatever opened it when it closes', () => {
    const opener = renderWithOpener()

    act(() => useAppStore.setState({ commandPaletteOpen: false }))

    expect(document.activeElement).toBe(opener)
  })

  it('keeps Tab inside the palette, wrapping from the last action to the input', () => {
    renderWithOpener()
    const last = screen.getByText('Report a problem').closest('button') as HTMLButtonElement
    last.focus()

    fireEvent.keyDown(last, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Switch case...'))
  })

  // The tour records whatever holds focus as its opener. The Replay button
  // unmounts with the palette, so the palette's own opener is handed over.
  it('hands its opener to the tour it replays', () => {
    const opener = renderWithOpener()
    let focusedAtStart: Element | null = null
    const onTour = () => (focusedAtStart = document.activeElement)
    window.addEventListener(TOUR_EVENT, onTour)

    fireEvent.click(screen.getByTestId('palette-replay-tour'))

    window.removeEventListener(TOUR_EVENT, onTour)
    expect(focusedAtStart).toBe(opener)
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })

  it('wraps Shift-Tab from the input round to the last action', () => {
    renderWithOpener()

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab', shiftKey: true })

    expect(document.activeElement).toBe(screen.getByText('Report a problem').closest('button'))
  })
})

// The sharing row belongs to the open Case; CaseSettingsEntryPoints.test.tsx
// covers it. With none open there is nothing to share.
describe('the sharing row', () => {
  it('is absent while no Case is open', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    expect(screen.getByTestId('palette-join-shared-case')).toBeTruthy()
    expect(screen.queryByTestId('palette-share-case')).toBeNull()
  })
})

// The rows under the Case list share its highlight: ArrowDown walks past the
// last Case into them and Enter runs the highlighted one. Before, the arrow
// keys stopped at the last Case and only a click or Tab reached an action.
describe('the action rows', () => {
  function highlighted(): string | null {
    return document.querySelector('[role="dialog"] button.bg-accent-subtle')?.textContent ?? null
  }

  async function openWithCases() {
    fakeBridge({
      cases: { list: vi.fn(async () => [makeCase('a', 'Alpha'), makeCase('b', 'Bravo')]) },
      captures: { countsByCase: vi.fn(async () => ({})) }
    })
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    await screen.findByText('Bravo')
    return screen.getByPlaceholderText('Switch case...')
  }

  it('take the highlight after the last Case, and Enter runs the highlighted one', async () => {
    const input = await openWithCases()

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()).toContain('Bravo')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()).toBe('Create new case')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()).toBe('Join a shared Case…')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/new', search: { join: true } })
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })

  it('stop at the last row, and ArrowUp climbs back into the Cases', async () => {
    const input = await openWithCases()

    for (let i = 0; i < 10; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(highlighted()).toBe('Report a problem')
    for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(highlighted()).toContain('Bravo')
  })

  it('highlight Create new case when nothing matches, so Enter still creates', async () => {
    const input = await openWithCases()

    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(screen.getByText(/No cases match/)).toBeTruthy()
    expect(highlighted()).toBe('Create new case')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/new' })
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })

  it('follow the pointer like the Cases do', async () => {
    await openWithCases()

    fireEvent.mouseEnter(screen.getByTestId('palette-replay-tour'))
    expect(highlighted()).toBe('Replay walkthrough')
  })
})

describe('the case result row', () => {
  // getByText matches the whole normalized text of the node, so '1 capture'
  // does not match a row reading '1 captures' — which is what pins #471.
  it('pluralizes the capture count only above one', async () => {
    fakeBridge({
      cases: {
        list: vi.fn(async () => [
          makeCase('one', 'Single'),
          makeCase('many', 'Several'),
          makeCase('none', 'Empty')
        ])
      },
      captures: { countsByCase: vi.fn(async () => ({ one: 1, many: 2, none: 0 })) }
    })
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })

    expect(await screen.findByText('1 capture')).toBeTruthy()
    expect(screen.getByText('2 captures')).toBeTruthy()
    expect(screen.getByText('0 captures')).toBeTruthy()
  })

  // The palette reads the clock once a minute, so a Case created since the
  // last tick is newer than `now`. The age is the list view's ladder, which
  // floors anything under a minute to "now" rather than printing "-1m".
  it('reads "now" for a Case created after the clock last ticked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'))
    try {
      fakeBridge({
        cases: {
          list: vi.fn(async () => [
            { ...makeCase('fresh', 'Fresh'), createdAt: '2026-10-29T12:00:20.000Z' },
            { ...makeCase('older', 'Older'), createdAt: '2026-10-29T11:55:00.000Z' }
          ])
        },
        captures: { countsByCase: vi.fn(async () => ({})) }
      })
      useAppStore.setState({ commandPaletteOpen: true })
      render(<CommandPalette />, { wrapper: Wrapper })

      const fresh = (await screen.findByText('Fresh')).closest('button') as HTMLButtonElement
      const older = screen.getByText('Older').closest('button') as HTMLButtonElement
      expect(fresh.textContent).toContain('now')
      expect(fresh.textContent).not.toContain('-1m')
      expect(older.textContent).toContain('5m')
    } finally {
      vi.useRealTimers()
    }
  })
})
