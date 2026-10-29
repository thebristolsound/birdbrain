// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { useAppStore } from '@renderer/stores/appStore'
import { members, sync } from './sharingFixtures'
import type { Case, SharingMembers } from '@shared/types'

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

// A Case nobody has shared lists no members.
const LOCAL_ROSTER = members({ members: [], invites: [], pendingJoins: [] })

function caseRow(extra: Partial<Case> = {}): Case {
  return {
    id: 'case1',
    name: 'Operation Kestrel',
    isDemo: false,
    createdAt: '2026-09-19T10:00:00.000Z',
    updatedAt: '2026-09-19T10:00:00.000Z',
    archived: false,
    ...extra
  }
}

function bridge(row: Case, roster: SharingMembers = LOCAL_ROSTER) {
  fakeBridge({
    cases: {
      get: vi.fn(async () => row),
      list: vi.fn(async () => [row])
    },
    captures: { countsByCase: vi.fn(async () => ({})) },
    sharing: {
      getSyncState,
      getMembers: vi.fn(async () => roster),
      isAvailable: vi.fn(async () => true)
    }
  })
}

beforeEach(() => {
  stubMatchMedia(false)
  navigate.mockClear()
  getSyncState.mockClear()
  bridge(caseRow())
  useAppStore.setState({ sessionActive: false, commandPaletteOpen: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ commandPaletteOpen: false })
})

// The entry points to Case settings and the join flow (#1514, and the
// 2026-10-28 handoff): the top-bar pill on every Case, the Case card's menu
// (CaseCardMenu.test.tsx), and the palette's share and join actions. The
// sidebar stays without one.
describe('Case settings entry points', () => {
  it('is not in the sidebar', () => {
    render(<Sidebar />, { wrapper: Wrapper })
    expect(screen.queryByText(/members|settings/i)).toBeNull()
    for (const button of screen.getAllByRole('button')) fireEvent.click(button)
    expect(navigatedToCaseSettings()).toBe(false)
  })

  it('opens Members from the sync pill on a shared Case', async () => {
    bridge(caseRow({ sharedAt: '2026-09-19T14:00:00.000Z' }), members())
    render(<TopBar />, { wrapper: Wrapper })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('synced')
    fireEvent.click(pill)
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case1' }
    })
  })

  it('offers Share on an unshared Case without polling its sync state', async () => {
    render(<TopBar />, { wrapper: Wrapper })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('share')
    expect(pill.textContent).toBe('Share')
    fireEvent.click(pill)
    expect(navigatedToCaseSettings()).toBe(true)
    expect(getSyncState).not.toHaveBeenCalled()
  })

  it('offers Share this Case… in the command palette while a Case is open', async () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    const row = await screen.findByTestId('palette-share-case')
    expect(row.textContent).toBe('Share this Case…Operation Kestrel')
    const join = screen.getByTestId('palette-join-shared-case')
    expect(row.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(row)
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case1' }
    })
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })

  it('reads Members… in the palette once the Case is shared', async () => {
    bridge(caseRow({ sharedAt: '2026-09-19T14:00:00.000Z' }), members())
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    expect((await screen.findByTestId('palette-share-case')).textContent).toBe(
      'Members…Operation Kestrel'
    )
  })

  it('offers Join a shared Case in the command palette', () => {
    useAppStore.setState({ commandPaletteOpen: true })
    render(<CommandPalette />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Join a shared Case…' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/new', search: { join: true } })
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })
})
