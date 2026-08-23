// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
import { About } from '@renderer/components/settings/About'
import { ExtensionBanner } from '@renderer/components/dashboard/ExtensionBanner'
import { useAppStore } from '@renderer/stores/appStore'

const CASES: Case[] = []

/**
 * The three replay entry points the acceptance criteria name. Each one only has
 * to raise the right chapter — the tour itself is covered in OnboardingTour.
 */
function chapterFrom(run: () => void): string[] {
  const seen: string[] = []
  const listener = (e: Event) => seen.push((e as CustomEvent<{ chapter: string }>).detail.chapter)
  window.addEventListener('birdbrain:tour', listener)
  try {
    run()
  } finally {
    window.removeEventListener('birdbrain:tour', listener)
  }
  return seen
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
    captures: { countsByCase: vi.fn(async () => ({})) },
    app: { getVersion: vi.fn(async () => '2.0.0') },
    extension: { openFolder: vi.fn(async () => undefined) }
  })
  useAppStore.setState({ commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ commandPaletteOpen: false })
})

describe('the command palette', () => {
  it('offers Replay walkthrough between the two entries it already had', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    const labels = ['Create new investigation', 'Replay walkthrough', 'Report a problem']
    const rendered = labels.map((l) => screen.getByText(l))
    expect(rendered[0].compareDocumentPosition(rendered[1])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(rendered[1].compareDocumentPosition(rendered[2])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('closes itself before raising the intro chapter', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    const chapters = chapterFrom(() =>
      fireEvent.click(screen.getByTestId('palette-replay-tour'))
    )
    expect(chapters).toEqual(['intro'])
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })
})

describe('Settings, About', () => {
  it('replays the intro chapter', () => {
    render(<About />, { wrapper: Wrapper })
    const chapters = chapterFrom(() => fireEvent.click(screen.getByTestId('about-replay-tour')))
    expect(chapters).toEqual(['intro'])
  })
})

describe('the dashboard extension banner', () => {
  it('carries the browser anchor in both connected states', () => {
    const { container, rerender } = render(<ExtensionBanner connected={false} />, {
      wrapper: Wrapper
    })
    expect(container.querySelector('[data-tour="browser"]')).not.toBeNull()
    rerender(<ExtensionBanner connected />)
    expect(container.querySelector('[data-tour="browser"]')).not.toBeNull()
  })

  // Replaces the deleted /extension-setup route: the same button now replays
  // the tour's extension chapter, install steps expanded.
  it('replays the extension chapter from Setup Guide', () => {
    render(<ExtensionBanner connected={false} />, { wrapper: Wrapper })
    const chapters = chapterFrom(() =>
      fireEvent.click(screen.getByTestId('extension-banner-setup-guide'))
    )
    expect(chapters).toEqual(['ext'])
    expect(navigate).not.toHaveBeenCalled()
  })

  it('still opens the extension folder from Install Extension', () => {
    const mockBridge = fakeBridge({
      cases: { list: vi.fn(async () => CASES) },
      captures: { countsByCase: vi.fn(async () => ({})) },
      app: { getVersion: vi.fn(async () => '2.0.0') },
      extension: { openFolder: vi.fn(async () => undefined) }
    })
    render(<ExtensionBanner connected={false} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByText('Install Extension'))
    expect(mockBridge.extension.openFolder).toHaveBeenCalled()
  })
})
