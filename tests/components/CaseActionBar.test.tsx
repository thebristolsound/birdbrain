// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

function mount() {
  fakeBridge({ launchedBrowser: { status: vi.fn(async () => ({ state: 'none' as const })) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.launchedBrowserStatus, { state: 'none' })
  render(
    <QueryClientProvider client={client}>
      <CaseActionBar />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useAppStore.setState({ connectedToExtension: false, sessionActive: false })
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

  // The mark belongs to the switch that starts and stops the session, so nothing sits between
  // them. Share, Export and Launch browser moved up into the top bar.
  it('holds only the recording mark and the switch, side by side', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    mount()
    const bar = screen.getByTestId('case-action-bar')
    expect(within(bar).getByTestId('topbar-rec').nextElementSibling).toBe(
      within(bar).getByTestId('session-controls')
    )
    expect(within(bar).queryByRole('button', { name: 'Launch browser' })).toBeNull()
    expect(within(bar).queryByRole('button', { name: /Export/ })).toBeNull()
    expect(within(bar).queryByTestId('share-pill')).toBeNull()
  })
})
