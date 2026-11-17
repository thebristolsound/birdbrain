// @vitest-environment jsdom
// When the Capture Session switch shows (the revision assessment, S2: "while the extension is
// connected or a launched browser is open").
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { LaunchedBrowserStatus } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

// The Case on screen.
const route = vi.hoisted(() => ({ caseId: 'case-1' as string | undefined }))

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
  const { container } = render(
    <QueryClientProvider client={client}>
      <SessionControls />
    </QueryClientProvider>
  )
  return { stop, client, container }
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

  // The Capture Session panel holds the stop control while a launched browser is open, and while
  // one has closed with its Capture Session still running. A second one here would be a second
  // way to stop the same session, so the switch leaves, with the extension connected or not.
  it.each([
    ['open', false, { state: 'open', browser: BROWSER }],
    ['open beside the extension', true, { state: 'open', browser: BROWSER }],
    ['closed', false, { state: 'closed', browser: BROWSER }],
    ['closed beside the extension', true, { state: 'closed', browser: BROWSER }]
  ] satisfies Array<[string, boolean, LaunchedBrowserStatus]>)(
    'leaves the stop to the panel while a launched browser is %s',
    (_, connectedToExtension, status) => {
      useAppStore.setState({ sessionActive: true, connectedToExtension })
      mount(status)
      expect(screen.queryByRole('switch', { name: 'Capture Session' })).toBeNull()
    }
  )

  it('shows while the extension is connected, as before', () => {
    useAppStore.setState({ connectedToExtension: true })
    mount({ state: 'none' })
    expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
  })

  // The panel holds its Stop while the browser closes, so the extension's switch stays.
  it('shows beside the extension while the launched browser is closing', () => {
    useAppStore.setState({ connectedToExtension: true, sessionActive: true })
    mount({ state: 'closing', browser: BROWSER })
    expect(screen.getByRole('switch', { name: 'Capture Session' })).toBeDefined()
  })

  it("stops the extension's session at once, with no confirmation", async () => {
    useAppStore.setState({ connectedToExtension: true, sessionActive: true })
    const { stop } = mount({ state: 'none' })
    fireEvent.click(screen.getByRole('switch', { name: 'Capture Session' }))
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().stopConfirmOpen).toBe(false)
  })
})

// The label shows only for what the breadcrumb and the recording mark do not say: an Active Case
// that is not the Case on screen, and the extension recording beside a launched browser. It
// follows the switch for the extension's session, and stands alone beside the panel.
describe('the label after the switch', () => {
  // The label reads the Case list, so each test asserts only once the list has loaded and the
  // component has rendered with it. React Query notifies its observers on a timer.
  async function mountWithCases(status: LaunchedBrowserStatus) {
    const { client, container } = mount(status)
    await waitFor(() => expect(client.getQueryData(queryKeys.cases)).toHaveLength(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return container
  }

  function line() {
    const el = screen.getByTestId('session-source-line')
    return { text: el.textContent, title: el.getAttribute('title') }
  }

  // With no label the extension's session shows its switch alone, and a launched browser's
  // session shows nothing here.
  function expectNoLabel(container: HTMLElement) {
    expect(screen.queryByTestId('session-source-line')).toBeNull()
    expect(['', 'Capture Session']).toContain(container.textContent)
  }

  it.each([
    ['a launched browser', false, { state: 'open', browser: BROWSER }],
    ['the extension', true, { state: 'none' }],
    // As on the recording mark, a closed browser is no longer a source.
    ['the extension, once the browser has closed', true, { state: 'closed', browser: BROWSER }]
  ] satisfies Array<[string, boolean, LaunchedBrowserStatus]>)(
    'shows no label while %s records into the Case on screen',
    async (_, connectedToExtension, status) => {
      useAppStore.setState({ sessionActive: true, connectedToExtension, activeCaseId: 'case-1' })
      expectNoLabel(await mountWithCases(status))
    }
  )

  // A launched browser pins the Case it started in, so opening another Case to read it does not
  // move where Captures go. The browser's own Case is Harbor Desk here, as the Case on screen is,
  // so only the Active Case gives "Ferry Line".
  it('names the Active Case when it is not the Case on screen', async () => {
    route.caseId = 'case-2'
    useAppStore.setState({ sessionActive: true, activeCaseId: 'case-1' })
    await mountWithCases({ state: 'open', browser: { ...BROWSER, caseId: 'case-2' } })
    expect(line()).toEqual({ text: 'Ferry Line', title: 'Ferry Line' })
  })

  it("names the extension's Active Case when it is not the Case on screen", async () => {
    route.caseId = 'case-2'
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    await mountWithCases({ state: 'none' })
    expect(line().text).toBe('Ferry Line')
  })

  it('names both sources while the extension is connected beside a launched browser', async () => {
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    await mountWithCases({ state: 'open', browser: BROWSER })
    expect(line()).toEqual({
      text: 'Launched Google Chrome, and the extension',
      title: 'Launched Google Chrome, and the extension'
    })
    // The label stands without the switch it used to follow.
    expect(screen.queryByRole('switch', { name: 'Capture Session' })).toBeNull()
  })

  it('names the Active Case, then both sources, when the window shows neither', async () => {
    route.caseId = 'case-2'
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    await mountWithCases({ state: 'open', browser: BROWSER })
    expect(line()).toEqual({
      text: 'Ferry Line · Launched Google Chrome, and the extension',
      title: 'Ferry Line · Launched Google Chrome, and the extension'
    })
  })

  // Settings has the switch and the recording mark beside it; the label shows on Case screens only.
  it('shows no label off a Case screen while a session runs', async () => {
    route.caseId = undefined
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-1'
    })
    expectNoLabel(await mountWithCases({ state: 'open', browser: BROWSER }))
  })
})
