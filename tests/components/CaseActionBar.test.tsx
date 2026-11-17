// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const routerState = vi.hoisted(() => ({ pathname: '/cases/case-1/notes' }))
vi.mock('@tanstack/react-router', () => ({
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

import { CaseActionBar } from '@renderer/components/layout/CaseActionBar'

const BROWSER: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}

function mount(status: LaunchedBrowserStatus = { state: 'none' }) {
  fakeBridge({ launchedBrowser: { status: vi.fn(async () => status) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.launchedBrowserStatus, status)
  render(
    <QueryClientProvider client={client}>
      <CaseActionBar />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useAppStore.setState({
    connectedToExtension: false,
    sessionActive: false,
    dismissedLaunchNotice: null
  })
})

// The row under the top bar (docs/design-handoff/2026-11-08-top-bar/, Option B).
describe("CaseActionBar as the Case's action row", () => {
  it('names the section on its left', () => {
    mount()
    expect(screen.getByTestId('case-action-bar-section').textContent).toBe('Notes')
  })

  it('shows the recording mark while a session runs, and not otherwise', () => {
    mount()
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
    cleanup()
    useAppStore.setState({ sessionActive: true })
    mount()
    const mark = screen.getByTestId('topbar-rec')
    expect(mark.textContent).toContain('Recording')
    expect(mark.textContent).not.toContain('REC')
  })

  // The Capture Session panel is on screen wherever this bar is, and names the launched browser.
  it.each([
    ['open', { state: 'open', browser: BROWSER }],
    ['closing', { state: 'closing', browser: BROWSER }],
    ['closed', { state: 'closed', browser: BROWSER }]
  ] satisfies Array<[string, LaunchedBrowserStatus]>)(
    'names no source in the mark while the panel shows a launched browser that is %s',
    (_, status) => {
      useAppStore.setState({ sessionActive: true, connectedToExtension: true })
      mount(status)
      expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording')
    }
  )

  it('names the extension in the mark for an extension-only session, which has no panel', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    mount()
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recordingextension')
  })

  // A notice names how the last browser closed, not what records now.
  it('names the extension in the mark while the panel shows a notice', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    mount({ state: 'none', notice: { code: 'EGRESS_CHANGED', message: 'The Egress changed.' } })
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recordingextension')
  })

  // The mark belongs to the switch that starts and stops the session, so nothing sits between
  // them, and the row holds no other control. Share and Export needed the Case to render, which
  // this row no longer loads, so e2e/topbar-layout.spec.ts checks on an open Case that they and
  // Launch browser are gone from it.
  it('holds only the section name, the recording mark and the switch', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    mount()
    const bar = screen.getByTestId('case-action-bar')
    // The second child is the spacer that pushes the mark and the switch to the right.
    expect(Array.from(bar.children, (el) => el.getAttribute('data-testid'))).toEqual([
      'case-action-bar-section',
      null,
      'topbar-rec',
      'session-controls'
    ])
  })
})
