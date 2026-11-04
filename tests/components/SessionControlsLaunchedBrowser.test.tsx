// @vitest-environment jsdom
// When the Capture Session switch shows (the revision assessment, S2: "while the extension is
// connected or a launched browser is open").
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
  extensionWarnings: []
}

function mount(status: LaunchedBrowserStatus) {
  fakeBridge({
    cases: { list: vi.fn(async () => []) },
    launchedBrowser: { status: vi.fn(async () => status) }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.launchedBrowserStatus, status)
  render(
    <QueryClientProvider client={client}>
      <SessionControls />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useAppStore.setState({ connectedToExtension: false, sessionActive: false })
})

describe('the Capture Session switch and a launched browser', () => {
  it('stays hidden with no extension and no launched browser', () => {
    mount({ state: 'none' })
    expect(screen.queryByRole('switch', { name: 'Capture Session' })).toBeNull()
  })

  it.each([
    ['open', { state: 'open', browser: BROWSER }],
    ['starting', { state: 'starting', browser: BROWSER, step: 'browser' }],
    ['closing', { state: 'closing', browser: BROWSER }],
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
