// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  BirdbrainSettings,
  Case,
  EgressSetting,
  LaunchedBrowserOption,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary
} from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import type { VpnWarningAnswer, VpnWarningCheck, VpnWarningTarget } from '@shared/ipc'
import { useVpnWarningStore } from '@renderer/lib/vpnWarning'
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
  // The write of the settings, where a test needs it to fail or to stay in flight.
  saveSettings?: (partial: Partial<BirdbrainSettings>) => Promise<Partial<BirdbrainSettings>>
  egress?: EgressSetting
  launch?: (executablePath: string) => Promise<LaunchedBrowserStatus>
  cancelLaunch?: () => Promise<LaunchedBrowserStatus>
  vpnSeen?: boolean
  // Whether main has a VPN warning due for a Case not yet warned; by default it has none.
  warn?: boolean
  // Whether main read the network, so that it can stop warning on it.
  canMute?: boolean
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
    warn = false,
    canMute = true
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
  const saved = { operatorName, egress, lastActiveCaseId }
  const saveSettings = vi.fn(
    options.saveSettings ??
      (async (partial: Partial<BirdbrainSettings>) => ({ ...saved, ...partial }))
  )
  // Main's side of the warning, as `vpnWarning.ts` keeps it: a Case that was answered for is
  // warned, and is not warned again. A test changes `due` and `canMute` to move the network.
  const vpn = { due: warn, canMute, warned: new Set<string>() }
  const checkVpnWarning = vi.fn(async (target: VpnWarningTarget): Promise<VpnWarningCheck> => {
    const caseId = 'caseId' in target ? target.caseId : ''
    const due = vpn.due && !vpn.warned.has(caseId)
    return { caseId, warn: due, canMute: due && vpn.canMute }
  })
  const answerVpnWarning = vi.fn(async ({ caseId }: VpnWarningAnswer) => {
    vpn.warned.add(caseId)
  })
  fakeBridge({
    egress: { vpnStatus, checkVpnWarning, answerVpnWarning },
    cases: { list: vi.fn(options.listCases ?? (async () => cases)) },
    settings: { get: vi.fn(async () => saved), update: saveSettings },
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
  return {
    client,
    activateCase,
    launch,
    cancelLaunch,
    vpnStatus,
    vpn,
    checkVpnWarning,
    answerVpnWarning,
    saveSettings
  }
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

function muteBox(body: HTMLElement): HTMLInputElement | null {
  return within(body).queryByRole('checkbox', { name: 'Do not warn on this network' })
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

  it("asks main about the Case that is picked, and shows no other Case's warning", async () => {
    const { vpn, checkVpnWarning } = mount({
      cases: [FERRY, HARBOR],
      lastActiveCaseId: 'case-2',
      egress: DIRECT,
      warn: true
    })
    vpn.warned.add('case-1')
    openPicker()
    const body = await pickerDialog()
    const picker = await within(body).findByRole('combobox', { name: 'Case' })
    await within(body).findByRole('button', { name: 'Launch without VPN' })
    expect(checkVpnWarning).toHaveBeenLastCalledWith({ caseId: 'case-2' }, 'session')
    // The question for the newly picked Case is still open, so the other Case's answer is all
    // the dialog holds.
    checkVpnWarning.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.change(picker, { target: { value: 'case-1' } })
    expect(checkVpnWarning).toHaveBeenLastCalledWith({ caseId: 'case-1' }, 'session')
    expect(within(body).queryByRole('button', { name: 'Launch without VPN' })).toBeNull()
    expect(launchButton('Launch')).toBeDefined()
    fireEvent.change(picker, { target: { value: 'case-2' } })
    await within(body).findByRole('button', { name: 'Launch without VPN' })
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

  it('shows the browsers found, with the Egress and operator read-only', async () => {
    mount()
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Google Chrome' })
    expect(within(body).getByRole('option', { name: 'Brave' })).toBeDefined()
    await waitFor(() => expect(body.textContent).toContain('Proxy · Harbor relay'))
    expect(body.textContent).toContain('A. Marsh')
    // The Egress is shown, never edited, from the dialog.
    expect(within(body).queryByRole('textbox')).toBeNull()
    expect(within(body).queryByRole('radio')).toBeNull()
    expect(launchButton('Launch').disabled).toBe(false)
    expect(launchButton('Launch').className).toContain('text-accent-foreground')
  })

  it('says on its button that it joins a running Capture Session', async () => {
    mount()
    useAppStore.setState({ sessionActive: true })
    open()
    const body = await dialog()
    expect(within(body).getByRole('button', { name: 'Launch and join' })).toBeDefined()
    expect(within(body).queryByRole('button', { name: 'Launch' })).toBeNull()
  })

  // The copy cut of 2026-11-16: the dialog keeps the one consequence, in view, and holds no tip.
  it.each([
    [
      'joining a session through a Proxy',
      PROXY,
      true,
      'EgressProxy · Harbor relay',
      'Launch and join'
    ],
    ['starting one on a Direct Egress', DIRECT, false, 'EgressDirect', 'Launch']
  ])('says only what a site can tell and how long the profile lasts, %s', async (...row) => {
    const [, egress, sessionActive, egressRow, button] = row
    mount({ egress })
    useAppStore.setState({ sessionActive })
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    await waitFor(() => expect(body.textContent).toContain(egressRow))
    await waitFor(() => expect(body.textContent).toContain('OperatorA. Marsh'))
    expect(body.textContent).toBe(
      'Launch a browser for Ferry Line' +
        'Sites can tell that software drives this browser.' +
        'BrowserGoogle ChromeBrave149.0.7827.55from its last launch' +
        'ProfileNew profile, deleted on close' +
        egressRow +
        'OperatorA. Marsh' +
        'Cancel' +
        button
    )
    expect(within(body).queryByRole('img')).toBeNull()
  })

  it('shows a Direct Egress with no label', async () => {
    mount({ egress: { kind: 'direct' } })
    open()
    const body = await dialog()
    await waitFor(() => expect(body.textContent).toContain('Direct'))
    expect(body.textContent).not.toContain('Harbor relay')
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

  describe('with no operator name saved', () => {
    async function nameField(): Promise<HTMLInputElement> {
      const body = await dialog()
      return (await within(body).findByRole('textbox', {
        name: 'Operator Name'
      })) as HTMLInputElement
    }

    async function ready(): Promise<HTMLElement> {
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      await waitFor(() => expect(body.textContent).toContain('Proxy · Harbor relay'))
      return body
    }

    it('asks for the name in its row, and holds the launch while it is blank', async () => {
      const { saveSettings } = mount({ operatorName: '  ' })
      open()
      const field = await nameField()
      const body = await ready()
      expect(field.value).toBe('')
      expect(field.placeholder).toBe('e.g. Alex Smith')
      expect(body.textContent).toContain('Every Capture carries an operator name.')
      expect(within(body).queryByRole('button', { name: 'Set operator name' })).toBeNull()
      expect(launchButton('Launch').disabled).toBe(true)
      fireEvent.change(field, { target: { value: '   ' } })
      expect(launchButton('Launch').disabled).toBe(true)
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      expect(launchButton('Launch').disabled).toBe(false)
      fireEvent.change(field, { target: { value: '' } })
      expect(launchButton('Launch').disabled).toBe(true)
      expect(saveSettings).not.toHaveBeenCalled()
      expect(navigate).not.toHaveBeenCalled()
    })

    it('saves the name as typed before it activates the Case, then launches', async () => {
      const { saveSettings, activateCase, launch } = mount({ operatorName: '' })
      open()
      const field = await nameField()
      await ready()
      fireEvent.change(field, { target: { value: ' A. Marsh ' } })
      fireEvent.click(launchButton('Launch'))
      await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
      expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ operatorName: ' A. Marsh ' })
      expect(saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
        activateCase.mock.invocationCallOrder[0]
      )
      expect(activateCase.mock.invocationCallOrder[0]).toBeLessThan(
        launch.mock.invocationCallOrder[0]
      )
      await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
    })

    it('activates no Case while the name is still being saved', async () => {
      let finishSave: () => void = () => {}
      const { activateCase, launch } = mount({
        operatorName: '',
        saveSettings: (partial) =>
          new Promise((resolve) => {
            finishSave = () => resolve({ ...partial, egress: PROXY })
          })
      })
      open()
      const field = await nameField()
      await ready()
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      fireEvent.click(launchButton('Launch'))
      // Long enough for the Case to have been activated, were the launch not waiting.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(activateCase).not.toHaveBeenCalled()
      act(() => finishSave())
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(activateCase).toHaveBeenCalledWith('case-1')
    })

    it('says so in the row when the save fails, and launches nothing', async () => {
      const { activateCase, launch, saveSettings } = mount({
        operatorName: '',
        saveSettings: async () => Promise.reject(new Error('disk full'))
      })
      open()
      const field = await nameField()
      const body = await ready()
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      fireEvent.click(launchButton('Launch'))
      const alert = await within(body).findByRole('alert')
      expect(alert.textContent).toBe('The name could not be saved.')
      expect(saveSettings).toHaveBeenCalledOnce()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
      // The form is back with what was typed, and the name can be saved again.
      const again = await nameField()
      expect(again.value).toBe('A. Marsh')
      expect(again.getAttribute('aria-invalid')).toBe('true')
      expect(within(body).queryByRole('list', { name: 'Launch checks' })).toBeNull()
      expect(launchButton('Launch').disabled).toBe(false)
      fireEvent.change(again, { target: { value: 'A. Marsh.' } })
      expect(within(body).queryByRole('alert')).toBeNull()
    })

    it('closes, and launches nothing, when cancelled while a save that fails is in flight', async () => {
      let failSave: () => void = () => {}
      const { activateCase, launch, cancelLaunch } = mount({
        operatorName: '',
        saveSettings: () =>
          new Promise((_, reject) => {
            failSave = () => reject(new Error('disk full'))
          })
      })
      open()
      const field = await nameField()
      const body = await ready()
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      fireEvent.click(launchButton('Launch'))
      fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
      act(() => failSave())
      await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      // The next opening starts clean: no name typed, no error, and the form on screen.
      open()
      expect((await nameField()).value).toBe('')
      expect(within(await dialog()).queryByRole('alert')).toBeNull()
    })

    it('shows the saved name as text once a launch that saved it fails', async () => {
      mount({
        operatorName: '',
        launch: async () => Promise.reject({ message: 'gone', code: 'BROWSER_SPAWN_FAILED' })
      })
      open()
      const field = await nameField()
      const body = await ready()
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      fireEvent.click(launchButton('Launch'))
      expect((await within(body).findByRole('status')).textContent).toContain('The launch failed')
      await waitFor(() => expect(within(body).queryByRole('textbox')).toBeNull())
      expect(body.textContent).toContain('A. Marsh')
      expect(launchButton('Launch').disabled).toBe(false)
    })

    it('puts the focus on the name when one browser leaves no choice to make', async () => {
      mount({ operatorName: '', browsers: [CHROME] })
      open()
      const field = await nameField()
      await within(await dialog()).findByTestId('launch-browser-only')
      await waitFor(() => expect(document.activeElement).toBe(field))
      // Typing a name makes Launch pressable, and the focus stays where the Operator types.
      fireEvent.change(field, { target: { value: 'A. Marsh' } })
      expect(launchButton('Launch').disabled).toBe(false)
      expect(document.activeElement).toBe(field)
    })

    it('forgets a name typed and not saved when it closes', async () => {
      mount({ operatorName: '' })
      open()
      fireEvent.change(await nameField(), { target: { value: 'A. Marsh' } })
      fireEvent.click(within(await dialog()).getByRole('button', { name: 'Cancel' }))
      expect(useAppStore.getState().startDialogCaseId).toBeNull()
      open()
      expect((await nameField()).value).toBe('')
    })
  })

  it('asks for no name, and saves none, when one is saved', async () => {
    const { saveSettings, launch } = mount()
    open()
    const body = await dialog()
    await within(body).findByRole('option', { name: 'Brave' })
    await waitFor(() => expect(body.textContent).toContain('A. Marsh'))
    expect(within(body).queryByRole('textbox')).toBeNull()
    expect(body.textContent).not.toContain('Every Capture carries an operator name.')
    fireEvent.click(launchButton('Launch'))
    await waitFor(() => expect(launch).toHaveBeenCalled())
    expect(saveSettings).not.toHaveBeenCalled()
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

  // ADR-0032 VPN rule 3, as amended: a session that starts here is warned in this dialog, and
  // no second dialog follows.
  describe('with a VPN warning due', () => {
    async function warned(options: MountOptions = {}) {
      const mounted = mount({ egress: DIRECT, vpnSeen: false, warn: true, ...options })
      open()
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      await within(body).findByRole('button', { name: 'Launch without VPN' })
      return { ...mounted, body }
    }

    it('carries the warning: its sentence, both offers, and a button that names it', async () => {
      const { body, checkVpnWarning, answerVpnWarning } = await warned()
      expect(within(body).getByTestId('launch-no-vpn').textContent).toBe(NO_VPN_LINE)
      expect(within(body).getByRole('button', { name: 'Set up a proxy' })).toBeDefined()
      expect(muteBox(body)?.checked).toBe(false)
      expect(within(body).queryByRole('button', { name: 'Launch' })).toBeNull()
      expect(launchButton('Launch without VPN').disabled).toBe(false)
      expect(checkVpnWarning).toHaveBeenCalledExactlyOnceWith({ caseId: 'case-1' }, 'session')
      expect(answerVpnWarning).not.toHaveBeenCalled()
    })

    it('asks main again on the press, answers that the Operator continued, then launches', async () => {
      const { checkVpnWarning, answerVpnWarning, activateCase, launch } = await warned()
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(checkVpnWarning).toHaveBeenLastCalledWith({ caseId: 'case-1' }, 'session')
      expect(answerVpnWarning).toHaveBeenCalledExactlyOnceWith({
        caseId: 'case-1',
        occasion: 'session',
        choice: 'continue'
      })
      expect(checkVpnWarning.mock.invocationCallOrder[1]).toBeLessThan(
        answerVpnWarning.mock.invocationCallOrder[0]
      )
      expect(answerVpnWarning.mock.invocationCallOrder[0]).toBeLessThan(
        activateCase.mock.invocationCallOrder[0]
      )
      expect(activateCase.mock.invocationCallOrder[0]).toBeLessThan(
        launch.mock.invocationCallOrder[0]
      )
      // The dialog was the warning: the one mounted at the root never opened.
      expect(useVpnWarningStore.getState()).toMatchObject({ open: false, request: null })
    })

    it('mutes the network when the box is ticked', async () => {
      const { body, answerVpnWarning, launch } = await warned()
      fireEvent.click(muteBox(body)!)
      expect(muteBox(body)?.checked).toBe(true)
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(answerVpnWarning).toHaveBeenCalledExactlyOnceWith({
        caseId: 'case-1',
        occasion: 'session',
        choice: 'mute-network'
      })
    })

    it('offers no mute where main could not read the network', async () => {
      const { body, answerVpnWarning, launch } = await warned({ canMute: false })
      expect(muteBox(body)).toBeNull()
      expect(within(body).getByRole('button', { name: 'Set up a proxy' })).toBeDefined()
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(answerVpnWarning.mock.calls[0][0].choice).toBe('continue')
    })

    it('mutes nothing when main can no longer read the network on the press', async () => {
      const { body, vpn, answerVpnWarning, launch } = await warned()
      fireEvent.click(muteBox(body)!)
      vpn.canMute = false
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(answerVpnWarning.mock.calls[0][0].choice).toBe('continue')
    })

    it('launches, and answers nothing, when no warning is due any more on the press', async () => {
      const { vpn, checkVpnWarning, answerVpnWarning, activateCase, launch } = await warned()
      vpn.due = false
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(activateCase).toHaveBeenCalledWith('case-1')
      expect(answerVpnWarning).not.toHaveBeenCalled()
    })

    it('opens the Egress setting from "Set up a proxy", and launches and answers nothing', async () => {
      const { body, answerVpnWarning, activateCase, launch } = await warned()
      fireEvent.click(within(body).getByRole('button', { name: 'Set up a proxy' }))
      expect(navigate).toHaveBeenCalledExactlyOnceWith({
        to: '/settings',
        search: { section: 'egress' }
      })
      expect(useAppStore.getState().startDialogCaseId).toBeNull()
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('reads "Launch" once main was answered, when the launch then fails', async () => {
      const { body, checkVpnWarning, answerVpnWarning, launch } = await warned({
        launch: async () => Promise.reject({ message: 'gone', code: 'BROWSER_SPAWN_FAILED' })
      })
      fireEvent.click(launchButton('Launch without VPN'))
      expect((await within(body).findByRole('status')).textContent).toContain('The launch failed')
      expect(answerVpnWarning).toHaveBeenCalledOnce()
      expect(launchButton('Launch').disabled).toBe(false)
      expect(within(body).queryByRole('button', { name: 'Launch without VPN' })).toBeNull()
      expect(within(body).queryByRole('button', { name: 'Set up a proxy' })).toBeNull()
      expect(muteBox(body)).toBeNull()
      // The line follows the VPN status, which has not changed.
      expect(within(body).getByTestId('launch-no-vpn').textContent).toBe(NO_VPN_LINE)
      fireEvent.click(launchButton('Launch'))
      await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
      expect(checkVpnWarning).toHaveBeenCalledTimes(3)
      expect(answerVpnWarning).toHaveBeenCalledOnce()
    })

    it('refuses, and launches nothing, when main cannot be told the Operator continued', async () => {
      const { body, answerVpnWarning, activateCase, launch } = await warned()
      answerVpnWarning.mockRejectedValueOnce(new Error('main is gone'))
      fireEvent.click(launchButton('Launch without VPN'))
      const card = await within(body).findByRole('status')
      expect(card.textContent).toBe('The launch failedmain is gone')
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
      // Main was not told, so the warning is still due.
      expect(launchButton('Launch without VPN').disabled).toBe(false)
    })

    // The warning and the line have different sources: main's check, and the polled VPN status.
    it('shows its sentence even where the VPN status has not said a VPN is missing', async () => {
      const { body } = await warned({ vpnSeen: true })
      expect(within(body).getByTestId('launch-no-vpn').textContent).toBe(NO_VPN_LINE)
    })

    it('names the condition on the button when the launch would join a session too', async () => {
      useAppStore.setState({ sessionActive: true })
      const { body } = await warned()
      expect(within(body).queryByRole('button', { name: 'Launch and join' })).toBeNull()
    })

    it('saves a typed name after asking main, and before answering it', async () => {
      const { body, checkVpnWarning, answerVpnWarning, saveSettings, activateCase, launch } =
        await warned({ operatorName: '' })
      fireEvent.change(within(body).getByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(launch).toHaveBeenCalled())
      expect(checkVpnWarning.mock.invocationCallOrder[1]).toBeLessThan(
        saveSettings.mock.invocationCallOrder[0]
      )
      expect(saveSettings.mock.invocationCallOrder[0]).toBeLessThan(
        answerVpnWarning.mock.invocationCallOrder[0]
      )
      expect(answerVpnWarning.mock.invocationCallOrder[0]).toBeLessThan(
        activateCase.mock.invocationCallOrder[0]
      )
    })

    it('leaves main unanswered when the name cannot be saved', async () => {
      const { body, answerVpnWarning, activateCase, launch } = await warned({
        operatorName: '',
        saveSettings: async () => Promise.reject(new Error('disk full'))
      })
      fireEvent.change(within(body).getByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      fireEvent.click(launchButton('Launch without VPN'))
      expect((await within(body).findByRole('alert')).textContent).toBe(
        'The name could not be saved.'
      )
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      expect(launchButton('Launch without VPN').disabled).toBe(false)
    })

    it('keeps the mute tick when the name cannot be saved', async () => {
      const { body } = await warned({
        operatorName: '',
        saveSettings: async () => Promise.reject(new Error('disk full'))
      })
      fireEvent.change(within(body).getByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      fireEvent.click(muteBox(body)!)
      fireEvent.click(launchButton('Launch without VPN'))
      await within(body).findByRole('alert')
      expect(muteBox(body)?.checked).toBe(true)
    })

    it('saves nothing, answers nothing and launches nothing when cancelled while main is asked on the press', async () => {
      const {
        body,
        checkVpnWarning,
        answerVpnWarning,
        saveSettings,
        activateCase,
        launch,
        cancelLaunch
      } = await warned({ operatorName: '' })
      fireEvent.change(within(body).getByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      let answerMain: (check: VpnWarningCheck) => void = () => {}
      checkVpnWarning.mockImplementationOnce(
        () =>
          new Promise<VpnWarningCheck>((resolve) => {
            answerMain = resolve
          })
      )
      fireEvent.click(launchButton('Launch without VPN'))
      fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
      act(() => answerMain({ caseId: 'case-1', warn: true, canMute: true }))
      await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
      expect(saveSettings).not.toHaveBeenCalled()
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('answers nothing and launches nothing when cancelled while the name is being saved', async () => {
      let finishSave: () => void = () => {}
      const { body, answerVpnWarning, saveSettings, activateCase, launch, cancelLaunch } =
        await warned({
          operatorName: '',
          saveSettings: (partial) =>
            new Promise((resolve) => {
              finishSave = () => resolve({ operatorName: '', ...partial } as BirdbrainSettings)
            })
        })
      fireEvent.change(within(body).getByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      fireEvent.click(launchButton('Launch without VPN'))
      await waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
      fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
      act(() => finishSave())
      await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('asks again each time it opens, and keeps nothing from the opening before', async () => {
      const { body, checkVpnWarning } = await warned()
      fireEvent.click(muteBox(body)!)
      fireEvent.click(within(body).getByRole('button', { name: 'Cancel' }))
      expect(useAppStore.getState().startDialogCaseId).toBeNull()
      // The next opening's question stays unanswered, so what shows is what the dialog kept.
      checkVpnWarning.mockImplementationOnce(() => new Promise(() => {}))
      open()
      const again = await dialog()
      await within(again).findByRole('option', { name: 'Brave' })
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(launchButton('Launch').disabled).toBe(false)
      expect(within(again).queryByRole('button', { name: 'Launch without VPN' })).toBeNull()
      expect(muteBox(again)).toBeNull()
    })

    it('drops an answer that arrives after the dialog closed', async () => {
      let answer: (check: VpnWarningCheck) => void = () => {}
      const { checkVpnWarning } = mount({ egress: DIRECT, vpnSeen: false, warn: true })
      checkVpnWarning.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve
          })
      )
      open()
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      fireEvent.click(within(body).getByRole('button', { name: 'Cancel' }))
      await act(async () => answer({ caseId: 'case-1', warn: true, canMute: true }))
      checkVpnWarning.mockImplementationOnce(() => new Promise(() => {}))
      open()
      const again = await dialog()
      await within(again).findByRole('option', { name: 'Brave' })
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(within(again).queryByRole('button', { name: 'Launch without VPN' })).toBeNull()
      expect(launchButton('Launch').disabled).toBe(false)
    })
  })

  describe('with no VPN warning due when it opens', () => {
    async function unwarned(options: MountOptions = {}) {
      const mounted = mount({ egress: DIRECT, ...options })
      open()
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      await within(body).findByText('Direct')
      await waitFor(() => expect(mounted.checkVpnWarning).toHaveBeenCalledOnce())
      return { ...mounted, body }
    }

    // A muted network, or a Case already warned: the line follows the VPN status, and the
    // button follows main's answer.
    it('reads "Launch", offers nothing and answers nothing, though no VPN is seen', async () => {
      const { body, checkVpnWarning, answerVpnWarning, launch } = await unwarned({
        vpnSeen: false
      })
      expect((await within(body).findByTestId('launch-no-vpn')).textContent).toBe(NO_VPN_LINE)
      expect(within(body).queryByRole('button', { name: 'Set up a proxy' })).toBeNull()
      expect(muteBox(body)).toBeNull()
      fireEvent.click(launchButton('Launch'))
      await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(answerVpnWarning).not.toHaveBeenCalled()
    })

    it('holds the launch when a warning comes due on the press, and shows it', async () => {
      const { body, vpn, answerVpnWarning, saveSettings, activateCase, launch } = await unwarned({
        operatorName: ''
      })
      fireEvent.change(await within(body).findByRole('textbox', { name: 'Operator Name' }), {
        target: { value: 'A. Marsh' }
      })
      expect(within(body).queryByTestId('launch-no-vpn')).toBeNull()
      // The network changes while the dialog is open.
      vpn.due = true
      fireEvent.click(launchButton('Launch'))
      const named = await within(body).findByRole('button', { name: 'Launch without VPN' })
      expect(within(body).getByTestId('launch-no-vpn').textContent).toBe(NO_VPN_LINE)
      expect(within(body).getByRole('button', { name: 'Set up a proxy' })).toBeDefined()
      expect(muteBox(body)?.checked).toBe(false)
      expect(within(body).queryByRole('list', { name: 'Launch checks' })).toBeNull()
      expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
      // Nothing was saved, answered or launched on a press that did not name the condition.
      expect(saveSettings).not.toHaveBeenCalled()
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()

      fireEvent.click(named)
      await waitFor(() => expect(launch).toHaveBeenCalledWith(CHROME.executablePath))
      expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ operatorName: 'A. Marsh' })
      expect(answerVpnWarning).toHaveBeenCalledExactlyOnceWith({
        caseId: 'case-1',
        occasion: 'session',
        choice: 'continue'
      })
    })

    it('closes, and launches nothing, when cancelled while main is asked and a warning comes due', async () => {
      let answer: (check: VpnWarningCheck) => void = () => {}
      const { body, checkVpnWarning, answerVpnWarning, activateCase, launch, cancelLaunch } =
        await unwarned()
      checkVpnWarning.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve
          })
      )
      fireEvent.click(launchButton('Launch'))
      fireEvent.click(await within(body).findByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(cancelLaunch).toHaveBeenCalledOnce())
      await act(async () => answer({ caseId: 'case-1', warn: true, canMute: true }))
      await waitFor(() => expect(useAppStore.getState().startDialogCaseId).toBeNull())
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })

    it('keeps the answer to the press when the answer to the opening arrives after it', async () => {
      let answerOpening: (check: VpnWarningCheck) => void = () => {}
      const { checkVpnWarning, launch } = mount({ egress: DIRECT, warn: true })
      checkVpnWarning.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerOpening = resolve
          })
      )
      open()
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      await within(body).findByText('Direct')
      await waitFor(() => expect(launchButton('Launch').disabled).toBe(false))
      fireEvent.click(launchButton('Launch'))
      await within(body).findByRole('button', { name: 'Launch without VPN' })
      await act(async () => answerOpening({ caseId: 'case-1', warn: false, canMute: false }))
      expect(within(body).getByRole('button', { name: 'Launch without VPN' })).toBeDefined()
      expect(launch).not.toHaveBeenCalled()
    })

    // The outcome `confirmContact` gave a failed check before the dialog asked for itself.
    it('refuses, and launches nothing, when main cannot be asked on the press', async () => {
      const { body, checkVpnWarning, activateCase, launch } = await unwarned()
      checkVpnWarning.mockRejectedValueOnce(new Error('main is gone'))
      fireEvent.click(launchButton('Launch'))
      const card = await within(body).findByRole('status')
      expect(card.textContent).toBe('The launch failedmain is gone')
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
      expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
      fireEvent.click(launchButton('Launch'))
      await waitFor(() => expect(launch).toHaveBeenCalledOnce())
      expect(checkVpnWarning).toHaveBeenCalledTimes(3)
    })

    it('shows no warning when main cannot be asked as it opens, and asks on the press', async () => {
      const { checkVpnWarning, answerVpnWarning, activateCase, launch } = mount({
        egress: DIRECT,
        warn: true
      })
      checkVpnWarning.mockRejectedValueOnce(new Error('main is not ready'))
      open()
      const body = await dialog()
      await within(body).findByRole('option', { name: 'Brave' })
      await within(body).findByText('Direct')
      await waitFor(() => expect(launchButton('Launch').disabled).toBe(false))
      expect(checkVpnWarning).toHaveBeenCalledOnce()
      expect(within(body).queryByRole('status')).toBeNull()
      fireEvent.click(launchButton('Launch'))
      await within(body).findByRole('button', { name: 'Launch without VPN' })
      expect(checkVpnWarning).toHaveBeenCalledTimes(2)
      expect(answerVpnWarning).not.toHaveBeenCalled()
      expect(activateCase).not.toHaveBeenCalled()
      expect(launch).not.toHaveBeenCalled()
    })
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
    expect(card.textContent).toBe('A launched browser is already openShow panel')
    // The title is the reason, so no line of detail is drawn under it.
    expect(card.firstElementChild?.childElementCount).toBe(1)
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
    expect(card.textContent).toBe(
      'Birdbrain could not read the Egress settingChoose an Egress in Settings → Network.'
    )
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
