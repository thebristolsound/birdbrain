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

// The Case on screen.
const route = vi.hoisted(() => ({ caseId: 'case-1' }))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: route.caseId })
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

const FERRY = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}

const HARBOR = { ...FERRY, id: 'case-2', name: 'Harbor Desk' }

function mount(status: LaunchedBrowserStatus) {
  const stop = vi.fn(async () => ({
    sessionActive: false,
    activeCaseId: 'case-1',
    captureCount: 0
  }))
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY, HARBOR]) },
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
  route.caseId = 'case-1'
  useAppStore.setState({
    connectedToExtension: false,
    sessionActive: false,
    stopConfirmOpen: false,
    activeCaseId: null
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

// 1i, design review of 2026-11-04: the label after the switch keeps the Active Case, the Case
// Captures go into, and names the source after it.
describe('the source line after the switch', () => {
  async function line() {
    const el = await screen.findByTestId('session-source-line')
    return { text: el.textContent, title: el.getAttribute('title') }
  }

  it('appends the launched browser to the Active Case', async () => {
    useAppStore.setState({ sessionActive: true })
    mount({ state: 'open', browser: BROWSER })
    expect(await line()).toEqual({
      text: 'Ferry Line · Launched Google Chrome',
      title: 'Ferry Line · Launched Google Chrome'
    })
  })

  it('names the extension as well while it is connected', async () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    mount({ state: 'open', browser: BROWSER })
    expect((await line()).text).toBe('Ferry Line · Launched Google Chrome, and the extension')
  })

  it('keeps the Case alone for the extension, and once the browser has closed', async () => {
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    mount({ state: 'none' })
    expect(await line()).toEqual({ text: 'Ferry Line', title: 'Ferry Line' })
    cleanup()
    mount({ state: 'closed', browser: BROWSER })
    expect((await line()).text).toBe('Ferry Line')
  })
  // A launched browser pins the Case it started in, so opening another Case to read it does not
  // move where Captures go.
  it('names the Case the launched browser records into, not the Case on screen', async () => {
    route.caseId = 'case-2'
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    mount({ state: 'open', browser: BROWSER })
    expect(await line()).toEqual({
      text: 'Ferry Line · Launched Google Chrome, and the extension',
      title: 'Ferry Line · Launched Google Chrome, and the extension'
    })
  })

  it("names the extension's Active Case, not the Case on screen", async () => {
    route.caseId = 'case-2'
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    mount({ state: 'none' })
    expect((await line()).text).toBe('Ferry Line')
  })
})
