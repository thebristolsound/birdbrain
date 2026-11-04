// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  Case,
  EgressSetting,
  LaunchedBrowserOption,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary
} from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import { StartDialog } from '@renderer/components/launchedBrowser/StartDialog'

const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}
const CHROME: LaunchedBrowserOption = {
  family: 'chrome',
  label: 'Google Chrome',
  executablePath: '/opt/google/chrome/chrome',
  chosen: false,
  lastVersion: '149.0.7827.55'
}
const BRAVE: LaunchedBrowserOption = {
  family: 'brave',
  label: 'Brave',
  executablePath: '/opt/brave.com/brave/brave',
  chosen: false,
  lastVersion: null
}
const PROXY: EgressSetting = {
  kind: 'proxy',
  proxyUrl: 'socks5://127.0.0.1:1080',
  label: 'Harbor relay'
}
const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: null,
  extensionWarnings: []
}

interface MountOptions {
  browsers?: LaunchedBrowserOption[]
  status?: LaunchedBrowserStatus
  operatorName?: string
  egress?: EgressSetting
  launch?: (executablePath: string) => Promise<LaunchedBrowserStatus>
  cancelLaunch?: () => Promise<LaunchedBrowserStatus>
}

function mount(options: MountOptions = {}) {
  const {
    browsers = [CHROME, BRAVE],
    status = { state: 'none' },
    operatorName = 'A. Marsh',
    egress = PROXY
  } = options
  const activateCase = vi.fn(async (caseId: string) => ({
    activeCaseId: caseId,
    sessionActive: false,
    captureCount: 0
  }))
  const launch = vi.fn(
    options.launch ??
      (async (): Promise<LaunchedBrowserStatus> => ({
        state: 'open',
        browser: { ...SUMMARY, version: '149.0.7827.55' }
      }))
  )
  const cancelLaunch = vi.fn(options.cancelLaunch ?? (async () => status))
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: { get: vi.fn(async () => ({ operatorName, egress })) },
    session: { activateCase },
    launchedBrowser: {
      list: vi.fn(async () => browsers),
      status: vi.fn(async () => status),
      launch,
      cancelLaunch
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StartDialog />
    </QueryClientProvider>
  )
  return { client, activateCase, launch, cancelLaunch }
}

function open(caseId = 'case-1') {
  act(() => useAppStore.getState().openStartDialog(caseId))
}

async function dialog() {
  return screen.findByRole('dialog', { name: 'Launch a browser for Ferry Line' })
}

function launchButton(name: RegExp | string = /^Launch/): HTMLButtonElement {
  return screen.getByRole('button', { name }) as HTMLButtonElement
}

beforeEach(() => {
  navigate.mockClear()
  useAppStore.setState({ startDialogCaseId: null, sessionActive: false })
})

afterEach(() => {
  cleanup()
  useAppStore.setState({ startDialogCaseId: null, sessionActive: false })
})

describe('StartDialog (S2)', () => {
  it('opens only when asked, for a Case', async () => {
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    expect(await dialog()).toBeDefined()
  })

  it('starts a Capture Session in the Case, with the Egress and operator shown read-only', async () => {
    mount()
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Google Chrome' })
    expect(within(body).getByRole('option', { name: 'Brave' })).toBeDefined()
    expect(body.textContent).toContain('Starts a Capture Session in Ferry Line.')
    await waitFor(() => expect(body.textContent).toContain('Proxy · Harbor relay'))
    expect(body.textContent).toContain('A. Marsh')
    // The Egress is shown, never edited, from the dialog.
    expect(within(body).queryByRole('textbox')).toBeNull()
    expect(within(body).queryByRole('radio')).toBeNull()
    expect(launchButton('Launch').disabled).toBe(false)
    expect(launchButton('Launch').className).toContain('text-accent-foreground')
  })

  it('says it joins a running Capture Session', async () => {
    mount()
    useAppStore.setState({ sessionActive: true })
    open()
    const body = await dialog()
    expect(body.textContent).toContain('Joins the running Capture Session in Ferry Line.')
    expect(launchButton('Launch and join')).toBeDefined()
  })

  it('shows a Direct Egress with no label', async () => {
    mount({ egress: { kind: 'direct' } })
    open()
    const body = await dialog()
    await waitFor(() => expect(body.textContent).toContain('Direct'))
    expect(body.textContent).not.toContain('Harbor relay')
    expect(within(body).queryByRole('img', { name: /hides where you are/ })).toBeNull()
  })

  it('shows the version from the last launch, or none', async () => {
    const chosen: LaunchedBrowserOption = {
      ...BRAVE,
      executablePath: '/opt/brave-origin-bin/brave',
      label: 'Brave Origin',
      chosen: true
    }
    mount({ browsers: [CHROME, BRAVE, chosen] })
    open()
    const body = await dialog()
    expect(await within(body).findByText('from its last launch')).toBeDefined()
    expect(within(body).getByText('149.0.7827.55')).toBeDefined()
    expect(
      within(body).getByRole('option', { name: 'Brave Origin · /opt/brave-origin-bin/brave' })
    ).toBeDefined()
    fireEvent.change(within(body).getByRole('combobox', { name: 'Browser' }), {
      target: { value: BRAVE.executablePath }
    })
    expect(within(body).getByText('not launched yet')).toBeDefined()
  })

  // `1d`: the gate the launch would refuse at, shown before the browser starts.
  it('holds the launch until an operator name is set', async () => {
    mount({ operatorName: '  ' })
    open()
    const body = await dialog()
    expect(await within(body).findByText('Not set')).toBeDefined()
    expect(body.textContent).toContain('Set your name before launching.')
    expect(launchButton('Launch').disabled).toBe(true)
    fireEvent.click(within(body).getByRole('button', { name: 'Set operator name' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
  })

  it('refuses with state 1 when Birdbrain found no browser', async () => {
    mount({ browsers: [] })
    open()
    const body = await dialog()
    const card = await within(body).findByRole('status')
    expect(card.className).toContain('border-l-danger-fg')
    expect(card.textContent).toContain('No supported browser found')
    expect(card.textContent).toContain('Choose one in Settings → Capture.')
    expect(launchButton('Launch').disabled).toBe(true)
  })

  it('refuses with state 4 while a launched browser is open, and shows its Case', async () => {
    mount({ status: { state: 'open', browser: { ...SUMMARY, caseId: 'case-9' } } })
    open()
    const body = await dialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain('A launched browser is already open')
    expect(card.textContent).toContain('Only one can be open at a time.')
    // The canvas numbers its states for its catalogue; the app shows no number, and state 4
    // refuses nothing that went wrong, so it has no danger rule.
    expect(card.textContent).not.toMatch(/^\d/)
    expect(card.className).not.toContain('border-l-danger-fg')
    expect(launchButton('Launch').disabled).toBe(true)
    fireEvent.click(within(card).getByRole('button', { name: 'Show panel' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-9' }
    })
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
  })

  it('refuses before the launch when the Egress could not be read', async () => {
    mount({ egress: { kind: 'unavailable' } })
    open()
    const body = await dialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain('Birdbrain could not read the Egress setting')
    expect(launchButton('Launch').disabled).toBe(true)
  })

  it('activates the Case, launches the chosen browser, and closes once it is open', async () => {
    const { activateCase, launch } = mount()
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.change(within(body).getByRole('combobox', { name: 'Browser' }), {
      target: { value: BRAVE.executablePath }
    })
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(launch).toHaveBeenCalledWith(BRAVE.executablePath))
    expect(activateCase).toHaveBeenCalledWith('case-1')
    expect(activateCase.mock.invocationCallOrder[0]).toBeLessThan(
      launch.mock.invocationCallOrder[0]
    )
    await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
  })

  // `1e`: the checklist follows the steps main reports.
  it('shows the launch checklist while the browser starts', async () => {
    let finish: (status: LaunchedBrowserStatus) => void = () => {}
    const { client } = mount({
      launch: () =>
        new Promise((resolve) => {
          finish = resolve
        })
    })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    const checks = await within(body).findByRole('list', { name: 'Launch checks' })
    expect(body.textContent).toContain('Launching Google Chrome…')
    expect(checks.textContent).toContain('Reaching Proxy · Harbor relay')

    act(() =>
      client.setQueryData(queryKeys.launchedBrowserStatus, {
        state: 'starting',
        browser: SUMMARY,
        step: 'first-tab'
      })
    )
    // The query notifies its readers on a later tick.
    await waitFor(() =>
      expect(
        within(checks)
          .getAllByRole('listitem')
          .map((item) => item.textContent)
      ).toEqual([
        '✓Proxy · Harbor relay is reachable',
        '✓Browser started',
        '◌Checking the connection on the first tab'
      ])
    )
    // A launch is ended by Cancel, not by Escape or a click outside.
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(document.querySelector('.fixed.inset-0.bg-black\\/50')!)
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')

    act(() => finish({ state: 'open', browser: SUMMARY }))
    await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
  })

  it('cancels the launch, and closes once main reports it cancelled', async () => {
    let fail: (error: unknown) => void = () => {}
    const { cancelLaunch } = mount({
      launch: () =>
        new Promise((_, reject) => {
          fail = reject
        })
    })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
    act(() => fail({ message: 'The launch was cancelled.', code: 'BROWSER_LAUNCH_CANCELLED' }))
    await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
  })

  it('shows a refusal from main as a card, and can launch again', async () => {
    const message =
      'The Egress proxy socks5://127.0.0.1:1080 did not accept a connection (connect ' +
      'ECONNREFUSED), so the browser was not started.'
    const launch = vi
      .fn<(path: string) => Promise<LaunchedBrowserStatus>>()
      .mockRejectedValueOnce({ message, code: 'EGRESS_PROXY_UNREACHABLE' })
      .mockResolvedValueOnce({ state: 'open', browser: SUMMARY })
    mount({ launch })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain("Can't reach Proxy · Harbor relay")
    expect(card.textContent).toContain(message)
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')

    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
    expect(launch).toHaveBeenCalledTimes(2)
  })

  it('names a browser that did not answer on its debugging connection', async () => {
    const message =
      'Google Chrome did not open its debugging connection within 20 seconds, so Birdbrain ' +
      'closed it.'
    mount({ launch: async () => Promise.reject({ message, code: 'BROWSER_NO_CONNECTION' }) })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain("Google Chrome didn't respond")
    expect(card.textContent).toContain(message)
  })

  it('says so when the cancel itself fails, and offers it again', async () => {
    mount({
      launch: () => new Promise(() => {}),
      cancelLaunch: async () => Promise.reject(new Error('IPC result is missing its envelope'))
    })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
    expect((await within(body).findByRole('alert')).textContent).toBe(
      'IPC result is missing its envelope'
    )
    const cancel = within(body).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
  })

  it('opens again without the refusal it closed on', async () => {
    mount({
      launch: async () => Promise.reject({ message: 'gone', code: 'BROWSER_SPAWN_FAILED' })
    })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    expect((await within(body).findByRole('status')).textContent).toContain('The launch failed')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
    open()
    const again = await dialog()
    await within(again).findByRole('option', { name: 'Brave' })
    expect(within(again).queryByRole('status')).toBeNull()
  })

  it('closes on a click outside before a launch', async () => {
    mount()
    open()
    await dialog()
    fireEvent.click(document.querySelector('.fixed.inset-0.bg-black\\/50')!)
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
  })

  it('closes with Cancel before a launch, and starts nothing', async () => {
    const { launch, activateCase } = mount()
    open()
    const body = await dialog()
    fireEvent.click(within(body).getByRole('button', { name: 'Cancel' }))
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
    expect(launch).not.toHaveBeenCalled()
    expect(activateCase).not.toHaveBeenCalled()
  })
})
