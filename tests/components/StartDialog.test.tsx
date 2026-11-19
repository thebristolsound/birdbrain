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
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'
import { fakeBridge, quietVpnWarning } from '../renderer/fakeBridge'

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
const DIRECT: EgressSetting = { kind: 'direct' }
const NO_VPN_LINE =
  'VPN not seen. Birdbrain sees this computer’s network path, not your browser’s. A VPN set up ' +
  'only in your browser is not seen.'
const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: null,
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}

const HARBOR: Case = { ...FERRY, id: 'case-2', name: 'Harbor Desk' }

interface MountOptions {
  browsers?: LaunchedBrowserOption[]
  cases?: Case[]
  // The read of the Case list, where a test needs it to fail or to stay in flight.
  listCases?: () => Promise<Case[]>
  lastActiveCaseId?: string | null
  status?: LaunchedBrowserStatus
  operatorName?: string
  egress?: EgressSetting
  launch?: (executablePath: string) => Promise<LaunchedBrowserStatus>
  cancelLaunch?: () => Promise<LaunchedBrowserStatus>
  vpnSeen?: boolean
  // Main's answer to the VPN warning check; by default no warning is due.
  warn?: boolean
}

function mount(options: MountOptions = {}) {
  const {
    browsers = [CHROME, BRAVE],
    cases = [FERRY],
    lastActiveCaseId = null,
    status = { state: 'none' },
    operatorName = 'A. Marsh',
    egress = PROXY,
    vpnSeen = true,
    warn = false
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
  const vpnStatus = vi.fn(async () => ({ vpnSeen }))
  const checkVpnWarning = warn
    ? vi.fn(async () => ({ caseId: 'case-1', warn: true, canMute: true }))
    : quietVpnWarning().checkVpnWarning
  fakeBridge({
    egress: { vpnStatus, checkVpnWarning, answerVpnWarning: vi.fn(async () => undefined) },
    cases: { list: vi.fn(options.listCases ?? (async () => cases)) },
    settings: { get: vi.fn(async () => ({ operatorName, egress, lastActiveCaseId })) },
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
  return { client, activateCase, launch, cancelLaunch, vpnStatus, checkVpnWarning }
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

function resetStore() {
  useAppStore.setState({ startDialogCaseId: null, startDialogPicking: false, sessionActive: false })
}

beforeEach(() => {
  navigate.mockClear()
  resetStore()
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
})

afterEach(() => {
  cleanup()
  resetStore()
})

// Decision 7 of the consolidation plan, answer 1: opened where no Case is on screen, the dialog
// asks which Case, preset to the last one opened.
describe('StartDialog with no Case named', () => {
  function openPicker() {
    act(() => useAppStore.getState().openStartDialogPicker())
  }

  async function pickerDialog() {
    return screen.findByRole('dialog', { name: 'Launch a browser' })
  }

  it('asks which Case, preset to the last one opened, and launches into it', async () => {
    const { activateCase, launch } = mount({ cases: [FERRY, HARBOR], lastActiveCaseId: 'case-2' })
    openPicker()
    const body = await pickerDialog()
    const picker = (await within(body).findByRole('combobox', {
      name: 'Case'
    })) as HTMLSelectElement
    await waitFor(() => expect(picker.value).toBe('case-2'))
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Ferry Line', 'Harbor Desk'])
    expect(body.textContent).toContain('Starts a Capture Session in Harbor Desk.')
    // The Case comes first, so it keeps the focus once the Browser field, which takes it
    // otherwise, has rendered.
    await within(body).findByRole('option', { name: 'Google Chrome' })
    expect(document.activeElement).toBe(picker)

    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(launch).toHaveBeenCalled())
    expect(activateCase).toHaveBeenCalledWith('case-2')
    await waitFor(() => expect(useAppStore.getState().startDialogPicking).toBe(false))
  })

  it('launches into the Case the Operator picks', async () => {
    const { activateCase, launch } = mount({ cases: [FERRY, HARBOR], lastActiveCaseId: 'case-2' })
    openPicker()
    const body = await pickerDialog()
    const picker = await within(body).findByRole('combobox', { name: 'Case' })
    fireEvent.change(picker, { target: { value: 'case-1' } })
    expect(body.textContent).toContain('Starts a Capture Session in Ferry Line.')
    await within(body).findByRole('option', { name: 'Google Chrome' })
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(launch).toHaveBeenCalled())
    expect(activateCase).toHaveBeenCalledWith('case-1')
  })

  it.each([
    ['is gone', 'missing'],
    ['was never recorded', null]
  ])('falls back to the first Case when the last one opened %s', async (_, lastActiveCaseId) => {
    mount({ cases: [FERRY, HARBOR], lastActiveCaseId })
    openPicker()
    const picker = (await within(await pickerDialog()).findByRole('combobox', {
      name: 'Case'
    })) as HTMLSelectElement
    expect(picker.value).toBe('case-1')
  })

  it('leaves an archived Case out, as the Case list does', async () => {
    mount({ cases: [{ ...FERRY, archived: true }, HARBOR], lastActiveCaseId: 'case-1' })
    openPicker()
    const picker = (await within(await pickerDialog()).findByRole('combobox', {
      name: 'Case'
    })) as HTMLSelectElement
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Harbor Desk'])
    expect(picker.value).toBe('case-2')
  })

  // A list that could not be read is not an installation with no Case.
  it('says the Cases could not be read, and does not say to create one', async () => {
    const { launch } = mount({
      listCases: async () => {
        throw new Error('database is locked')
      }
    })
    openPicker()
    const body = await pickerDialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toBe('The Cases could not be readClose this dialog and open it again.')
    expect(body.textContent).not.toContain('Create a Case first')
    // The Case row does not read as an installation with no Case either.
    expect(body.textContent).toContain('Not read')
    expect(body.textContent).not.toContain('None yet')
    expect(launchButton('Launch').disabled).toBe(true)
    expect(launch).not.toHaveBeenCalled()
  })

  // A read that keeps failing is tried again once for each opening, and no more than that.
  it('reads the Cases again once per opening while the read keeps failing', async () => {
    const listCases = vi.fn(async (): Promise<Case[]> => {
      throw new Error('database is locked')
    })
    mount({ listCases })
    await waitFor(() => expect(listCases).toHaveBeenCalledTimes(1))
    openPicker()
    await within(await pickerDialog()).findByRole('status')
    await waitFor(() => expect(listCases).toHaveBeenCalledTimes(2))
    // Long enough for a third read to have started, were one coming.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(listCases).toHaveBeenCalledTimes(2)
    expect((await within(await pickerDialog()).findByRole('status')).textContent).toContain(
      'The Cases could not be read'
    )
  })

  // The refusal says to close the dialog and open it again, so opening it reads the Cases again.
  it('reads the Cases again when it is opened after a failed read', async () => {
    let fail = true
    mount({
      listCases: async () => {
        if (fail) throw new Error('database is locked')
        return [FERRY]
      }
    })
    openPicker()
    await within(await pickerDialog()).findByRole('status')
    act(() => useAppStore.getState().closeStartDialog())
    fail = false
    openPicker()
    const picker = await within(await pickerDialog()).findByRole('combobox', { name: 'Case' })
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Ferry Line'])
  })

  it('holds the launch, with no refusal, while the Cases are still being read', async () => {
    mount({ listCases: () => new Promise<Case[]>(() => {}) })
    openPicker()
    const body = await pickerDialog()
    // Once the browsers and the settings are in, only the missing Case holds Launch.
    await within(body).findByRole('option', { name: 'Google Chrome' })
    await waitFor(() => expect(body.textContent).toContain('A. Marsh'))
    expect(launchButton('Launch').disabled).toBe(true)
    expect(body.textContent).toContain('Reading…')
    expect(body.textContent).not.toContain('None yet')
    expect(body.textContent).not.toContain('No Case to capture into')
    expect(body.textContent).not.toContain('could not be read')
  })

  it('refuses, and holds the launch, where there is no Case', async () => {
    const { launch } = mount({ cases: [] })
    openPicker()
    const body = await pickerDialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toBe('No Case to capture intoCreate a Case first.')
    expect(within(body).queryByRole('combobox', { name: 'Case' })).toBeNull()
    // A list that was read and holds no Case says so, where an unread one says it is not read.
    expect(body.textContent).toContain('None yet')
    expect(body.textContent).not.toContain('Reading…')
    expect(body.textContent).not.toContain('Not read')
    expect(launchButton('Launch').disabled).toBe(true)
    expect(body.textContent).not.toContain('Starts a Capture Session')
    expect(launch).not.toHaveBeenCalled()
  })

  it('forgets the pick when it closes, and opens on the preset again', async () => {
    mount({ cases: [FERRY, HARBOR], lastActiveCaseId: 'case-2' })
    openPicker()
    let body = await pickerDialog()
    fireEvent.change(await within(body).findByRole('combobox', { name: 'Case' }), {
      target: { value: 'case-1' }
    })
    fireEvent.click(within(body).getByRole('button', { name: 'Cancel' }))
    expect(useAppStore.getState().startDialogPicking).toBe(false)
    openPicker()
    body = await pickerDialog()
    const picker = (await within(body).findByRole('combobox', {
      name: 'Case'
    })) as HTMLSelectElement
    expect(picker.value).toBe('case-2')
  })

  it('shows no Case row when it is opened for a Case', async () => {
    mount({ cases: [FERRY, HARBOR] })
    open()
    const body = await dialog()
    expect(within(body).queryByRole('combobox', { name: 'Case' })).toBeNull()
  })
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

  it('shows the one browser found as text, with its version, and launches it', async () => {
    const { launch } = mount({ browsers: [CHROME] })
    open()
    const body = await dialog()
    const only = await within(body).findByTestId('launch-browser-only')
    expect(only.textContent).toBe('Google Chrome')
    expect(within(body).queryByRole('combobox')).toBeNull()
    expect(within(body).getByText('149.0.7827.55')).toBeDefined()
    expect(within(body).getByText('from its last launch')).toBeDefined()
    await waitFor(() => expect(launchButton('Launch').disabled).toBe(false))
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
  })

  it('offers a choice between two browsers, and the choice takes the focus', async () => {
    mount({ browsers: [CHROME, BRAVE] })
    open()
    const body = await dialog()
    const select = await within(body).findByRole('combobox', { name: 'Browser' })
    expect(within(body).queryByTestId('launch-browser-only')).toBeNull()
    await waitFor(() => expect(launchButton('Launch').disabled).toBe(false))
    expect(document.activeElement).toBe(select)
  })

  it('puts the focus on Launch when one browser leaves no choice to make', async () => {
    mount({ browsers: [CHROME] })
    open()
    await within(await dialog()).findByTestId('launch-browser-only')
    await waitFor(() => expect(document.activeElement).toBe(launchButton('Launch')))
  })

  it('leaves the focus on the Case when it asks which Case and one browser was found', async () => {
    mount({ browsers: [CHROME], cases: [FERRY, HARBOR] })
    act(() => useAppStore.getState().openStartDialogPicker())
    const body = await screen.findByRole('dialog', { name: 'Launch a browser' })
    const picker = await within(body).findByRole('combobox', { name: 'Case' })
    await within(body).findByTestId('launch-browser-only')
    await waitFor(() => expect(launchButton('Launch').disabled).toBe(false))
    expect(document.activeElement).toBe(picker)
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
    expect(navigate).toHaveBeenCalledWith({ to: '/settings', search: { section: 'operator' } })
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
  })

  // `1b`'s no-VPN line, in the words of the warning #2037 shipped (ADR-0032).
  it('shows the no-VPN line under a Direct Egress when no VPN is seen', async () => {
    mount({ egress: DIRECT, vpnSeen: false })
    open()
    const body = await dialog()
    const line = await within(body).findByTestId('launch-no-vpn')
    expect(line.textContent).toBe(NO_VPN_LINE)
  })

  it('shows no such line while a VPN is seen, and asks nothing under a proxy', async () => {
    const seen = mount({ egress: DIRECT, vpnSeen: true })
    open()
    let body = await dialog()
    await within(body).findByText('Direct')
    await waitFor(() => expect(seen.vpnStatus).toHaveBeenCalled())
    expect(within(body).queryByTestId('launch-no-vpn')).toBeNull()
    cleanup()
    useAppStore.setState({ startDialogCaseId: null })
    const proxied = mount({ egress: PROXY, vpnSeen: false })
    open()
    body = await dialog()
    await within(body).findByText('Harbor relay', { exact: false })
    expect(within(body).queryByTestId('launch-no-vpn')).toBeNull()
    expect(proxied.vpnStatus).not.toHaveBeenCalled()
  })

  it('passes the VPN warning as a session warning, and launches once continued', async () => {
    const { activateCase, launch, checkVpnWarning } = mount({ egress: DIRECT, warn: true })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    expect(useVpnWarningStore.getState().request?.occasion).toBe('session')
    expect(checkVpnWarning).toHaveBeenCalledWith({ caseId: 'case-1' }, 'session')
    expect(activateCase).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    act(() => settleVpnWarning('continue'))
    await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
    expect(activateCase).toHaveBeenCalledWith('case-1')
  })

  it('launches nothing when the Operator stops at the VPN warning, and offers it again', async () => {
    const { activateCase, launch } = mount({ egress: DIRECT, warn: true })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    act(() => settleVpnWarning('dismiss'))
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(false))
    expect(activateCase).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
    expect(within(body).queryByRole('list', { name: 'Launch checks' })).toBeNull()
    expect(launchButton('Launch').disabled).toBe(false)
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

  it('refuses before the launch where main offers none, and says why', async () => {
    const reason = 'The launched browser is not available on macOS yet.'
    mount({ status: { state: 'none', launchUnavailable: reason } })
    open()
    const body = await dialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain(reason)
    expect(launchButton('Launch').disabled).toBe(true)
  })

  it('gives that reason, not state 1, when it also found no browser', async () => {
    const reason = 'The launched browser is not available on macOS yet.'
    mount({ browsers: [], status: { state: 'none', launchUnavailable: reason } })
    open()
    const body = await dialog()
    const card = await within(body).findByRole('status')
    expect(card.textContent).toContain(reason)
    expect(card.textContent).not.toContain('No supported browser found')
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
    // The top bar's mark can have hidden the panel, and Show panel has to bring it back.
    act(() => useAppStore.getState().setCaptureSessionPanelHidden(true))
    fireEvent.click(within(card).getByRole('button', { name: 'Show panel' }))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-9' }
    })
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(false)
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

  it('launches nothing when cancelled while the Case is still being activated', async () => {
    let activated: () => void = () => {}
    const { activateCase, launch, cancelLaunch } = mount()
    activateCase.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          activated = () =>
            resolve({ activeCaseId: 'case-1', sessionActive: false, captureCount: 0 })
        })
    )
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    fireEvent.click(launchButton('Launch'))
    fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
    expect(activateCase).toHaveBeenCalledOnce()
    act(() => activated())
    await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
    expect(launch).not.toHaveBeenCalled()
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
