// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { useAppStore } from '@renderer/stores/appStore'

const routerState = vi.hoisted(() => ({ pathname: '/cases/case1/overview' }))
const navigate = vi.hoisted(() => vi.fn())

function matchRoute({ to, fuzzy }: { to: string; fuzzy?: boolean }) {
  const { pathname } = routerState
  if (to === '/cases/$caseId') {
    const match = pathname.match(fuzzy ? /^\/cases\/([^/]+)/ : /^\/cases\/([^/]+)$/)
    return match ? { caseId: match[1] } : false
  }
  const pattern = new RegExp(`^${to.replace('$caseId', '([^/]+)')}${fuzzy ? '' : '$'}`)
  return pattern.test(pathname) ? {} : false
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back: vi.fn() } }),
  useMatchRoute: () => matchRoute,
  useParams: () => ({ caseId: 'case1' })
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

import { Sidebar } from '@renderer/components/layout/Sidebar'
import { TopBar } from '@renderer/components/layout/TopBar'
import { CommandPalette } from '@renderer/components/layout/CommandPalette'

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const SETTINGS_TARGET = /\/cases\/\$caseId\/settings|\/cases\/[^/]+\/settings/

function navigatedToCaseSettings(): boolean {
  return navigate.mock.calls.some(([arg]) => {
    const to = typeof arg === 'string' ? arg : (arg as { to?: unknown })?.to
    return typeof to === 'string' && SETTINGS_TARGET.test(to)
  })
}

beforeEach(() => {
  stubMatchMedia(false)
  navigate.mockClear()
  fakeBridge({
    cases: {
      get: vi.fn(async () => ({ id: 'case1', name: 'Operation Kestrel' })),
      list: vi.fn(async () => [])
    },
    captures: { countsByCase: vi.fn(async () => ({})) }
  })
  useAppStore.setState({ sessionActive: false, commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ commandPaletteOpen: false })
})

// The entry points to Case settings are deferred (#1514, maintainer's
// correction of 2026-10-23) until the sync defects #1951 and #1955 merge. A
// mounted one is a finding; this file is what would catch it.
describe('Case settings has no entry point yet', () => {
  it('is not in the sidebar', () => {
    render(<Sidebar />, { wrapper: Wrapper })
    expect(screen.queryByText(/members|settings/i)).toBeNull()
    for (const button of screen.getAllByRole('button')) fireEvent.click(button)
    expect(navigatedToCaseSettings()).toBe(false)
  })

  it('is not in the top bar', async () => {
    render(<TopBar />, { wrapper: Wrapper })
    const controls = await screen.findByTestId('topbar-controls')
    expect(controls.textContent).not.toMatch(/members/i)
    for (const button of controls.querySelectorAll('button')) fireEvent.click(button)
    expect(navigatedToCaseSettings()).toBe(false)
  })

  it('is not in the command palette', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    const panel = screen.getByRole('dialog', { name: 'Command palette' })
    expect(panel.textContent).not.toMatch(/case settings|members|join a shared case/i)
    for (const button of panel.querySelectorAll('button')) fireEvent.click(button)
    expect(navigatedToCaseSettings()).toBe(false)
  })
})
