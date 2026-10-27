// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { useAppStore } from '@renderer/stores/appStore'
import { sync } from './sharingFixtures'

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

const getSyncState = vi.fn(async () => sync())

function bridge(caseRow: Record<string, unknown>) {
  fakeBridge({
    cases: {
      get: vi.fn(async () => caseRow),
      list: vi.fn(async () => [])
    },
    captures: { countsByCase: vi.fn(async () => ({})) },
    sharing: { getSyncState }
  })
}

beforeEach(() => {
  stubMatchMedia(false)
  navigate.mockClear()
  getSyncState.mockClear()
  bridge({ id: 'case1', name: 'Operation Kestrel' })
  useAppStore.setState({ sessionActive: false, commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ commandPaletteOpen: false })
})

// The entry points to Case settings and the join flow (#1514): the top-bar sync
// pill on a shared Case, the Case card's menu (CaseCardMenu.test.tsx), and the
// palette's join action. The sidebar stays without one.
describe('Case settings entry points', () => {
  it('is not in the sidebar', () => {
    render(<Sidebar />, { wrapper: Wrapper })
    expect(screen.queryByText(/members|settings/i)).toBeNull()
    for (const button of screen.getAllByRole('button')) fireEvent.click(button)
    expect(navigatedToCaseSettings()).toBe(false)
  })

  it('opens Members from the sync pill on a shared Case', async () => {
    bridge({ id: 'case1', name: 'Operation Kestrel', sharedAt: '2026-09-19T14:00:00.000Z' })
    render(<TopBar />, { wrapper: Wrapper })
    fireEvent.click(await screen.findByTestId('sync-pill'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case1' }
    })
  })

  it('leaves an unshared Case without a pill and without polling its sync state', async () => {
    render(<TopBar />, { wrapper: Wrapper })
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').textContent).toBe('Operation Kestrel')
    )
    expect(screen.queryByTestId('sync-pill')).toBeNull()
    expect(getSyncState).not.toHaveBeenCalled()
  })

  it('offers Join a shared Case in the command palette', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Join a shared Case…' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/new', search: { join: true } })
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })
})
