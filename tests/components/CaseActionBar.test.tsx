// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserStatus } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const routerState = vi.hoisted(() => ({ pathname: '/cases/case-1/notes' }))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useMatchRoute:
    () =>
    ({ to }: { to: string; fuzzy?: boolean }) => {
      const prefix = to.replace('$caseId', 'case-1')
      return routerState.pathname.startsWith(prefix) ? {} : false
    }
}))
vi.mock('@renderer/components/status/SessionControls', () => ({
  SessionControls: () => <div data-testid="session-controls" />
}))
vi.mock('@renderer/components/status/SharePill', () => ({
  SharePill: ({ caseId }: { caseId: string }) => <div data-testid="share-pill">{caseId}</div>
}))
vi.mock('@renderer/components/export/ExportMenu', () => ({
  ExportMenu: ({ caseId, caseName }: { caseId: string; caseName: string }) => (
    <div data-testid="export-menu">{`${caseId}:${caseName}`}</div>
  )
}))

import { CaseActionBar } from '@renderer/components/layout/CaseActionBar'

const BROWSER = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}

function mount(status: LaunchedBrowserStatus = { state: 'none' }) {
  fakeBridge({
    launchedBrowser: { status: vi.fn(async () => status) },
    cases: { get: vi.fn(async () => ({ id: 'case-1', name: 'Operation Kestrel' })) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Main's status, as useServerStatus keeps it from the pushed events.
  client.setQueryData(queryKeys.launchedBrowserStatus, status)
  render(
    <QueryClientProvider client={client}>
      <CaseActionBar caseId="case-1" />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useAppStore.setState({
    connectedToExtension: false,
    startDialogCaseId: null,
    sessionActive: false
  })
})

// What you can do to this Case, in one row (docs/design-handoff/2026-11-08-top-bar/, Option B).
describe("CaseActionBar as the Case's action row", () => {
  it('names the section on its left', () => {
    mount()
    expect(screen.getByTestId('case-action-bar-section').textContent).toBe('Notes')
  })

  it('carries Share and Export for the open Case', async () => {
    mount()
    const bar = screen.getByTestId('case-action-bar')
    expect((await within(bar).findByTestId('share-pill')).textContent).toBe('case-1')
    expect((await within(bar).findByTestId('export-menu')).textContent).toBe(
      'case-1:Operation Kestrel'
    )
  })

  it('shows the recording mark beside the switch while a session runs, and not otherwise', () => {
    mount()
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
    cleanup()
    useAppStore.setState({ sessionActive: true })
    mount()
    const mark = screen.getByTestId('topbar-rec')
    expect(mark.textContent).toContain('Recording')
    expect(mark.textContent).not.toContain('REC')
  })
})

describe('CaseActionBar', () => {
  it('carries the session switch while the extension is connected', () => {
    useAppStore.setState({ connectedToExtension: true })
    mount()
    const bar = screen.getByTestId('case-action-bar')
    expect(within(bar).getByTestId('session-controls')).toBeTruthy()
  })

  // `2b`: the bar renders whenever a Case is open, so Launch browser needs no extension.
  it('renders with no extension connected, holding Launch browser', () => {
    mount()
    const bar = screen.getByTestId('case-action-bar')
    const launch = within(bar).getByRole('button', { name: 'Launch browser' }) as HTMLButtonElement
    expect(launch.disabled).toBe(false)
    // C1: the 28 pixel control, outlined without the accent.
    expect(launch.className).toContain('h-7')
    expect(launch.className).not.toContain('border-accent')
  })

  it('opens the start dialog for its Case', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Launch browser' }))
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
  })

  it.each([
    ['open', { state: 'open', browser: BROWSER }, 'A launched browser is already open'],
    [
      'starting',
      { state: 'starting', browser: BROWSER, step: 'browser' },
      'A launched browser is starting'
    ],
    ['closing', { state: 'closing', browser: BROWSER }, 'A launched browser is closing']
  ] satisfies Array<[string, LaunchedBrowserStatus, string]>)(
    'holds Launch browser while one is %s, and says why',
    (_, status, why) => {
      mount(status)
      const holder = screen.getByTitle(why)
      const launch = within(holder).getByRole('button', { name: 'Launch browser' })
      expect((launch as HTMLButtonElement).disabled).toBe(true)
    }
  )

  // A closed browser leaves its Capture Session running; a launch joins it.
  it('offers Launch browser again once the launched browser has closed', () => {
    mount({ state: 'closed', browser: BROWSER })
    expect(
      (screen.getByRole('button', { name: 'Launch browser' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })
})
