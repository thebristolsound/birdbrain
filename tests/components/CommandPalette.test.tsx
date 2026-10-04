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
})
