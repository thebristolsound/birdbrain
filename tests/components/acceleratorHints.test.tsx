// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { MAC_PLATFORM, restorePlatform, stubPlatform } from '../renderer/platformStub'

// The bar's own hint and the search chip it mounts are what is under test; the
// session, connection, health and export controls carry no accelerator and each
// drag in their own data graph.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouter: () => ({ history: { back: vi.fn() } }),
  useMatchRoute: () => (opts: { to: string }) =>
    opts.to === '/cases/$caseId' ? { caseId: 'case1' } : false
}))
vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() })
}))
vi.mock('@renderer/hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => ({ status: null })
}))
vi.mock('@renderer/hooks/useSearch', () => ({
  useSearch: () => ({
    results: [],
    noteResults: [],
    searching: false,
    search: vi.fn(),
    clear: vi.fn()
  })
}))
vi.mock('@renderer/components/status/SessionControls', () => ({ SessionControls: () => null }))
vi.mock('@renderer/components/status/ConnectionStatus', () => ({ ConnectionStatus: () => null }))
vi.mock('@renderer/components/status/CaptureHealth', () => ({ CaptureHealth: () => null }))
vi.mock('@renderer/components/export/ExportMenu', () => ({ ExportMenu: () => null }))

import { TopBar } from '@renderer/components/layout/TopBar'
import { HeroSection } from '@renderer/components/dashboard/HeroSection'
import { WelcomeCard } from '@renderer/components/onboarding/WelcomeCard'

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function renderTopBar() {
  return render(<TopBar />, { wrapper: Wrapper })
}

function renderHero() {
  return render(
    <HeroSection onNewInvestigation={vi.fn()} onOpenRecent={vi.fn()} onImportCase={vi.fn()} />
  )
}

function kbdText(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('kbd')).map((k) => k.textContent)
}

/** The hero's hint line as rendered: the key caps and the text between them. */
function heroHint(container: HTMLElement): string {
  const paragraphs = container.querySelectorAll('p')
  return paragraphs[paragraphs.length - 1].textContent ?? ''
}

beforeEach(() => {
  stubMatchMedia(false)
  fakeBridge({
    cases: { get: vi.fn(async () => ({ id: 'case1', name: 'Operation Kestrel' })) }
  })
})

afterEach(() => {
  cleanup()
  restorePlatform()
})

describe('the top bar case switcher', () => {
  it('names Ctrl off macOS', async () => {
    renderTopBar()
    const button = await screen.findByTestId('topbar-case-name')
    expect(button.title).toBe('Switch case (Ctrl+K)')
  })

  it('names the Command glyph on macOS', async () => {
    stubPlatform(MAC_PLATFORM)
    renderTopBar()
    const button = await screen.findByTestId('topbar-case-name')
    expect(button.title).toBe('Switch case (⌘K)')
  })
})

describe('the search chip', () => {
  it('names Ctrl off macOS, keeping the chip’s own spacing', async () => {
    renderTopBar()
    expect(await screen.findByText('Ctrl F')).toBeTruthy()
  })

  it('names the Command glyph on macOS, which sets flush against the key', async () => {
    stubPlatform(MAC_PLATFORM)
    renderTopBar()
    expect(await screen.findByText('⌘F')).toBeTruthy()
    expect(screen.queryByText('Ctrl F')).toBeNull()
  })
})

// Two key caps rather than one label, so the hero keeps its ` + ` on both
// platforms — the flush convention is for a modifier inside a single label
// (accelerator.ts). Reading the caps alone would leave that separator unasserted.
describe('the dashboard hero shortcuts', () => {
  it('names Ctrl off macOS', () => {
    const { container } = renderHero()
    expect(kbdText(container)).toEqual(['Ctrl', 'N', 'Ctrl', 'K'])
    expect(heroHint(container)).toContain('Ctrl + N')
    expect(heroHint(container)).toContain('Ctrl + K')
  })

  it('names the Command glyph on macOS, keeping the separator between the caps', () => {
    stubPlatform(MAC_PLATFORM)
    const { container } = renderHero()
    expect(kbdText(container)).toEqual(['⌘', 'N', '⌘', 'K'])
    expect(heroHint(container)).toContain('⌘ + N')
    expect(heroHint(container)).toContain('⌘ + K')
    expect(heroHint(container)).not.toContain('⌘N')
  })
})

describe('the welcome card replay hint', () => {
  it('names Ctrl off macOS', () => {
    render(<WelcomeCard onStart={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.getByText('Ctrl K')).toBeTruthy()
  })

  it('names the Command glyph on macOS', () => {
    stubPlatform(MAC_PLATFORM)
    render(<WelcomeCard onStart={vi.fn()} onSkip={vi.fn()} />)
    expect(screen.getByText('⌘K')).toBeTruthy()
    expect(screen.queryByText('Ctrl K')).toBeNull()
  })
})
