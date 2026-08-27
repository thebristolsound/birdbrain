// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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

const CASES: Case[] = []

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
    expect(panel.contains(screen.getByPlaceholderText('Switch investigation...'))).toBe(true)

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
