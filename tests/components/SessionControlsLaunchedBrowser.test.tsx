// @vitest-environment jsdom
// When the Capture Session switch shows (the revision assessment, S2: "while the extension is
// connected or a launched browser is open").
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserStatus } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' })
}))

import { SessionControls } from '@renderer/components/status/SessionControls'

const BROWSER = {
  family: 'chrome' as const,
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}

function mount(status: LaunchedBrowserStatus) {
  const stop = vi.fn(async () => ({
    sessionActive: false,
    activeCaseId: 'case-1',
    captureCount: 0
  }))
  fakeBridge({
    cases: { list: vi.fn(async () => []) },
    session: { stop },
    launchedBrowser: { status: vi.fn(async () => status) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.launchedBrowserStatus, status)
  render(
    <QueryClientProvider client={client}>
      <SessionControls />
    </QueryClientProvider>
  )
  return { stop }
}

afterEach(() => {
  cleanup()
  useAppStore.setState({
    connectedToExtension: false,
    sessionActive: false,
    stopConfirmOpen: false
  })
})

describe('the Capture Session switch and a launched browser', () => {
  // Starting or closing takes a moment, and a run of the built app showed the switch flash up
  // off for it while a launch started its Capture Session.
  it.each([
    ['none', { state: 'none' }],
    ['starting', { state: 'starting', browser: BROWSER, step: 'browser' }],
    ['closing', { state: 'closing', browser: BROWSER }]
  ] satisfies Array<[string, LaunchedBrowserStatus]>)(
    'stays hidden with no extension while the launched browser is %s',
    (_, status) => {
      mount(status)
      expect(screen.queryByRole('switch', { name: 'Capture Session' })).toBeNull()
    }
  )

  it.each([
    ['open', { state: 'open', browser: BROWSER }],
    // The browser closed, and the Capture Session it started runs on until stopped.
    ['closed', { state: 'closed', browser: BROWSER }]
  ] satisfies Array<[string, LaunchedBrowserStatus]>)(
    'shows with no extension while a launched browser is %s',
    (_, status) => {
      useAppStore.setState({ sessionActive: true })
      mount(status)
      expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
    }
  )

  it('shows while the extension is connected, as before', () => {
    useAppStore.setState({ connectedToExtension: true })
    mount({ state: 'none' })
    expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
  })
})

// `1i`: turning the switch off opens the stop confirmation while a launched browser is open,
// since stopping then closes it.
describe('turning the switch off', () => {
  it('asks first while a launched browser is open', () => {
    useAppStore.setState({ sessionActive: true })
    const { stop } = mount({ state: 'open', browser: BROWSER })
    fireEvent.click(screen.getByRole('switch', { name: 'Capture Session' }))
    expect(useAppStore.getState().stopConfirmOpen).toBe(true)
    expect(stop).not.toHaveBeenCalled()
  })

  it('stops at once once the browser has closed, as there is none to close', async () => {
    useAppStore.setState({ sessionActive: true })
    const { stop } = mount({ state: 'closed', browser: BROWSER })
    fireEvent.click(screen.getByRole('switch', { name: 'Capture Session' }))
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().stopConfirmOpen).toBe(false)
  })
})
