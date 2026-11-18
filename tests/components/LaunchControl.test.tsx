// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { EgressSetting, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'

const navigate = vi.hoisted(() => vi.fn())
const route = vi.hoisted(() => ({ onSettings: false }))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useMatchRoute: () => () => route.onSettings
}))

// The panel and the paste dialog have tests of their own. Here they only have to open.
vi.mock('@renderer/components/launchedBrowser/CaptureSessionPanel', async (original) => ({
  ...(await original<typeof import('@renderer/components/launchedBrowser/CaptureSessionPanel')>()),
  CaptureSessionPanel: ({ form, showOpenCase }: { form: string; showOpenCase?: boolean }) => (
    <div data-testid="panel">{`${form}:${showOpenCase ? 'open-case' : 'no-open-case'}`}</div>
  )
}))
// The way each opening of the paste dialog reports that it should close, in the order opened,
// as a queue that finishes late would still hold it.
const pasteCloses = vi.hoisted(() => [] as Array<() => void>)
vi.mock('@renderer/components/captures/PasteUrlsDialog', () => ({
  PasteUrlsDialog: ({
    caseId,
    open,
    onOpenChange
  }: {
    caseId: string
    open: boolean
    onOpenChange: (open: boolean) => void
  }) => {
    if (!open) return null
    pasteCloses.push(() => onOpenChange(false))
    return (
      <div role="dialog" aria-label="Paste URLs to capture">
        {caseId}
      </div>
    )
  }
}))

import { LaunchControl } from '@renderer/components/status/LaunchControl'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { settleVpnWarning, useVpnWarningStore } from '@renderer/lib/vpnWarning'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubResizeObserver } from './resizeObserverStub'
import { isDisabledItem, press } from './menuKeys'

const BROWSER: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: null,
  tabs: []
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: BROWSER }
const NOTICE: LaunchedBrowserStatus = {
  state: 'none',
  notice: { code: 'EGRESS_CHANGED', message: 'The Egress changed while the browser was open.' }
}

const CASES = [
  { id: 'case-1', name: 'Ferry Line' },
  { id: 'case-2', name: 'Harbor Desk' }
]

interface Setup {
  caseId?: string | null
  showOpenCase?: boolean
  status?: LaunchedBrowserStatus
  egress?: EgressSetting
  vpnSeen?: boolean
  /** Whether main asks for the VPN warning before a session starts. */
  warn?: boolean
}

function setup({
  caseId = 'case-1',
  showOpenCase = false,
  status = { state: 'none' },
  egress = { kind: 'direct' },
  vpnSeen = false,
  warn = false
}: Setup = {}) {
  let current = status
  const calls: string[] = []
  const snapshot = (sessionActive: boolean) => ({ sessionActive, activeCaseId: caseId })
  const session = {
    activateCase: vi.fn(async (id: string) => {
      calls.push(`activate ${id}`)
      return snapshot(false)
    }),
    start: vi.fn(async () => {
      calls.push('start')
      return snapshot(true)
    }),
    stop: vi.fn(async () => {
      calls.push('stop')
      return snapshot(false)
    })
  }
  const checkVpnWarning = vi.fn(async () => ({ caseId, warn, canMute: true }))
  fakeBridge({
    launchedBrowser: { status: vi.fn(async () => current) },
    settings: { get: vi.fn(async () => ({ egress })) },
    cases: { list: vi.fn(async () => CASES) },
    session,
    egress: {
      vpnStatus: vi.fn(async () => ({ vpnSeen })),
      checkVpnWarning,
      answerVpnWarning: vi.fn(async () => undefined)
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.launchedBrowserStatus, status)
  client.setQueryData(queryKeys.cases, CASES)
  const view = render(
    <QueryClientProvider client={client}>
      <LaunchControl caseId={caseId} showOpenCase={showOpenCase} />
    </QueryClientProvider>
  )
  const setStatus = (next: LaunchedBrowserStatus) => {
    current = next
    act(() => {
      client.setQueryData(queryKeys.launchedBrowserStatus, next)
    })
  }
  return { client, setStatus, session, calls, checkVpnWarning, ...view }
}

function launchButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Launch browser/ })
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'More ways to capture' }))
  return screen.getByRole('menu')
}

beforeEach(() => {
  stubResizeObserver()
  pasteCloses.length = 0
  route.onSettings = false
  navigate.mockClear()
  useAppStore.setState({
    sessionActive: false,
    connectedToExtension: false,
    activeCaseId: null,
    stopConfirmOpen: false,
    startDialogCaseId: null,
    startDialogPicking: false,
    captureSessionPanelHidden: false,
    dismissedLaunchNotice: null
  })
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
})

afterEach(cleanup)

describe('the capture control at rest', () => {
  it('is one filled Launch browser button that opens the launch dialog for the Case on screen', () => {
    setup()
    const launch = launchButton()
    expect(launch.textContent).toBe('Launch browser')
    // The default variant is the filled one; the outline variant has no accent fill.
    expect(launch.className).toContain('bg-accent')
    expect(launch.className).not.toContain('border-border-strong')
    fireEvent.click(launch)
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
    expect(useAppStore.getState().startDialogPicking).toBe(false)
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
  })

  // Decision 7 of the consolidation plan, answer 1: with no Case open the dialog asks which.
  it('opens the launch dialog on its Case picker where no Case is on screen', () => {
    setup({ caseId: null })
    const launch = launchButton()
    expect(launch.textContent).toBe('Launch browser…')
    fireEvent.click(launch)
    expect(useAppStore.getState().startDialogPicking).toBe(true)
    expect(useAppStore.getState().startDialogCaseId).toBeNull()
  })

  it.each([
    ['starting', { state: 'starting', browser: BROWSER, step: 'browser' }, 'is starting']
  ] satisfies Array<[string, LaunchedBrowserStatus, string]>)(
    'holds the launch while a browser is %s, with a reason a keyboard can reach',
    (_, status, why) => {
      setup({ status })
      const launch = launchButton()
      // Held, not disabled: it keeps focus, and its description says why.
      expect((launch as HTMLButtonElement).disabled).toBe(false)
      expect(launch.getAttribute('aria-disabled')).toBe('true')
      const reason = document.getElementById(launch.getAttribute('aria-describedby')!)
      expect(reason?.textContent).toBe(`A launched browser ${why}`)
      expect(launch.getAttribute('title')).toBe(`A launched browser ${why}`)
      launch.focus()
      expect(document.activeElement).toBe(launch)

      fireEvent.click(launch)
      expect(useAppStore.getState().startDialogCaseId).toBeNull()
      expect(isDisabledItem(within(openMenu()).getByTestId('launch-control-launch'))).toBe(true)
    }
  )

  // A closing browser still has its panel, so the control stays the session's.
  it('stays the session control while the launched browser closes', () => {
    useAppStore.setState({ sessionActive: true })
    setup({ status: { state: 'closing', browser: BROWSER } })
    expect(screen.getByTestId('topbar-capture-session')).toBeTruthy()
    expect(screen.queryByTestId('launch-control')).toBeNull()
  })

  it('carries no description while nothing holds the launch', () => {
    setup()
    expect(launchButton().getAttribute('aria-disabled')).toBe('false')
    expect(launchButton().getAttribute('aria-describedby')).toBeNull()
  })
})

describe("the capture control's menu", () => {
  it('holds Launch browser, Paste URLs, the session start and the way to a proxy, in that order', async () => {
    setup()
    const menu = openMenu()
    // The proxy item joins once the VPN check has answered.
    await within(menu).findByTestId('launch-control-proxy')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.dataset.testid)
    ).toEqual([
      'launch-control-launch',
      'launch-control-paste',
      'launch-control-start-session',
      'launch-control-proxy'
    ])
    expect(menu.getAttribute('aria-label')).toBe('Capture')
  })

  it('opens on its first item from the keyboard', async () => {
    setup()
    const trigger = screen.getByRole('button', { name: 'More ways to capture' })
    trigger.focus()
    await press('Enter')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('launch-control-launch'))
    )
  })

  it('opens the launch dialog from its first item', () => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId('launch-control-launch'))
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
  })

  it('opens the paste dialog for the Case on screen', () => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId('launch-control-paste'))
    expect(screen.getByRole('dialog', { name: 'Paste URLs to capture' }).textContent).toBe('case-1')
  })

  // The palette can change the Case on screen while the dialog is up.
  it('keeps the paste dialog on the Case it was opened for', () => {
    const { rerender, client } = setup()
    fireEvent.click(within(openMenu()).getByTestId('launch-control-paste'))
    rerender(
      <QueryClientProvider client={client}>
        <LaunchControl caseId="case-2" showOpenCase={false} />
      </QueryClientProvider>
    )
    expect(screen.getByRole('dialog', { name: 'Paste URLs to capture' }).textContent).toBe('case-1')
  })

  // A queue for one opening can finish after that dialog has closed and another has opened.
  it('lets a late finish of an earlier paste close nothing that opened after it', () => {
    const { rerender, client } = setup()
    fireEvent.click(within(openMenu()).getByTestId('launch-control-paste'))
    const closeFirst = pasteCloses[pasteCloses.length - 1]
    act(() => closeFirst())
    expect(screen.queryByRole('dialog', { name: 'Paste URLs to capture' })).toBeNull()

    rerender(
      <QueryClientProvider client={client}>
        <LaunchControl caseId="case-2" showOpenCase={false} />
      </QueryClientProvider>
    )
    fireEvent.click(within(openMenu()).getByTestId('launch-control-paste'))
    expect(screen.getByRole('dialog', { name: 'Paste URLs to capture' }).textContent).toBe('case-2')
    act(() => closeFirst())
    expect(screen.getByRole('dialog', { name: 'Paste URLs to capture' }).textContent).toBe('case-2')
  })

  // Inside the bar the dialog's backdrop would lie in the window drag region.
  it('renders the paste dialog outside the bar', () => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId('launch-control-paste'))
    const dialog = screen.getByRole('dialog', { name: 'Paste URLs to capture' })
    expect(screen.getByTestId('launch-control').contains(dialog)).toBe(false)
    expect(dialog.parentElement).toBe(document.body)
  })

  it('holds Paste URLs where no Case is on screen, and says why', () => {
    setup({ caseId: null })
    const paste = within(openMenu()).getByTestId('launch-control-paste')
    expect(isDisabledItem(paste)).toBe(true)
    expect(paste.getAttribute('title')).toBe('Open a Case first')
    fireEvent.click(paste)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says whether the extension is connected', () => {
    setup()
    expect(within(openMenu()).getByTestId('launch-control-extension').textContent).toBe(
      'ExtensionNot connected'
    )
    cleanup()
    useAppStore.setState({ connectedToExtension: true })
    setup()
    expect(within(openMenu()).getByTestId('launch-control-extension').textContent).toBe(
      'ExtensionConnected'
    )
  })

  // ADR-0032 VPN rule 2: the words the top bar no longer prints are printed where a contact
  // starts.
  it('prints that no VPN is seen on a Direct Egress, and offers the way to a proxy', async () => {
    setup()
    const menu = openMenu()
    const row = within(menu).getByTestId('launch-control-egress')
    await waitFor(() => expect(row.textContent).toBe('EgressDirect · VPN not seen'))
    expect(within(row).getByText('Direct · VPN not seen').className).toContain('text-warning-fg')

    fireEvent.click(await within(menu).findByTestId('launch-control-proxy'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { section: 'egress' },
      replace: false
    })
  })

  it('replaces the history entry when Set up a proxy is used from Settings', async () => {
    route.onSettings = true
    setup({ caseId: null })
    fireEvent.click(await within(openMenu()).findByTestId('launch-control-proxy'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: { section: 'egress' },
      replace: true
    })
  })

  it('offers no proxy link while a VPN is seen', async () => {
    setup({ vpnSeen: true })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('launch-control-egress').textContent).toBe(
        'EgressDirect · VPN seen'
      )
    )
    expect(within(menu).queryByTestId('launch-control-proxy')).toBeNull()
  })

  it('names a proxy Egress by its label, with no warning', async () => {
    setup({ egress: { kind: 'proxy', label: 'Frankfurt VPN' } as EgressSetting })
    const row = within(openMenu()).getByTestId('launch-control-egress')
    await waitFor(() => expect(row.textContent).toBe('EgressProxy: Frankfurt VPN'))
    expect(within(row).getByText('Proxy: Frankfurt VPN').className).toContain('text-text-muted')
    expect(screen.queryByTestId('launch-control-proxy')).toBeNull()
  })

  it('shows an unknown Egress in the danger colour', async () => {
    setup({ egress: { kind: 'unavailable' } })
    const row = within(openMenu()).getByTestId('launch-control-egress')
    await waitFor(() => expect(row.textContent).toBe('EgressEgress unknown · nothing sent'))
    expect(within(row).getByText('Egress unknown · nothing sent').className).toContain(
      'text-danger-fg'
    )
  })

  // The two rows are facts, not actions: the arrow keys pass over them.
  it('gives the two status rows no menu item role', () => {
    setup()
    const menu = openMenu()
    expect(within(menu).getByTestId('launch-control-extension').getAttribute('role')).toBe('none')
    expect(within(menu).getByTestId('launch-control-egress').getAttribute('role')).toBe('none')
  })
})

describe('the capture control with a notice', () => {
  it('marks the button, names the notice to assistive technology, and shows it in the menu', () => {
    setup({ status: NOTICE })
    const launch = launchButton()
    expect(launch.querySelector('svg')).not.toBeNull()
    expect(launch.textContent).toBe('Launch browser. 1 notice: Browser closed: the Egress changed')
    const menu = openMenu()
    // The third line is main's own account of why the browser closed.
    expect(within(menu).getByTestId('launch-control-notice').textContent).toBe(
      'Browser closed: the Egress changedThe Capture Session ended.' +
        'The Egress changed while the browser was open.'
    )
    // The label is hidden from assistive technology, so the menu's name carries its words.
    expect(menu.getAttribute('aria-label')).toBe(
      'Capture. Browser closed: the Egress changed. The Capture Session ended. ' +
        'The Egress changed while the browser was open.'
    )
  })

  it('drops the notice when it is dismissed from the menu', () => {
    setup({ status: NOTICE })
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Dismiss notice' }))
    expect(launchButton().textContent).toBe('Launch browser')
    expect(launchButton().querySelector('svg')).toBeNull()
    expect(within(openMenu()).queryByTestId('launch-control-notice')).toBeNull()
  })

  it('shows no notice mark with none to show', () => {
    setup()
    expect(launchButton().querySelector('svg')).toBeNull()
  })
})

describe("the capture control while a launched browser's session runs", () => {
  it('becomes the recording mark, with no Launch browser beside it', () => {
    useAppStore.setState({ sessionActive: true })
    setup({ status: OPEN })
    const mark = screen.getByTestId('topbar-capture-session')
    expect(within(mark).getByTestId('topbar-rec')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Launch browser/ })).toBeNull()
    expect(screen.queryByTestId('launch-control')).toBeNull()
    expect(screen.getAllByTestId('topbar-rec')).toHaveLength(1)
  })

  // On a Case the panel is on screen and names the browser, so the mark is the dot and the time.
  it('names no source on a Case, and keeps the elapsed time in its accessible name', async () => {
    useAppStore.setState({ sessionActive: true })
    setup({
      status: { state: 'open', browser: { ...BROWSER, sessionStartedAt: Date.now() - 5_000 } }
    })
    const mark = screen.getByTestId('topbar-capture-session')
    await screen.findByRole('timer')
    expect(mark.getAttribute('aria-label')).toBeNull()
    expect(screen.getByRole('button', { name: /^Capture Session, ?Recording ?00:0\d$/ })).toBe(mark)
  })

  // The panel names an open browser, so the mark leaves the name out. With the panel hidden
  // nothing else on a Case screen names it, so the mark does.
  it('names the open browser on the mark while its panel is hidden', () => {
    useAppStore.setState({ sessionActive: true })
    setup({ status: OPEN })
    const mark = screen.getByTestId('topbar-capture-session')
    expect(mark.textContent).not.toContain('Google Chrome')
    fireEvent.click(mark)
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(true)
    expect(mark.textContent).toContain('Google Chrome')
  })

  it('hides and shows the Capture Session panel on a Case', () => {
    useAppStore.setState({ sessionActive: true })
    setup({ status: OPEN })
    const mark = screen.getByTestId('topbar-capture-session')
    expect(mark.getAttribute('aria-expanded')).toBe('true')
    expect(mark.getAttribute('title')).toBe('Hide the Capture Session panel')

    fireEvent.click(mark)
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(true)
    expect(mark.getAttribute('aria-expanded')).toBe('false')
    expect(mark.getAttribute('title')).toBe('Show the Capture Session panel')

    fireEvent.click(mark)
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(false)
    // No popover on a Case: the panel is the screen's own.
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('shows the panel again for the next launched browser', async () => {
    useAppStore.setState({ sessionActive: true })
    const { client, setStatus } = setup({ status: OPEN })
    fireEvent.click(screen.getByTestId('topbar-capture-session'))
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(true)
    // The read made at mount has to land first, or it would put the open browser back.
    await waitFor(() => expect(client.isFetching()).toBe(0))
    // The session ends with its browser. One still running would leave the extension's mark.
    act(() => useAppStore.setState({ sessionActive: false }))
    setStatus({ state: 'none' })
    await waitFor(() => expect(screen.queryByTestId('topbar-capture-session')).toBeNull())
    await waitFor(() => expect(useAppStore.getState().captureSessionPanelHidden).toBe(false))
  })

  it('says Recording, with no time, once the browser has closed with its session running', () => {
    useAppStore.setState({ sessionActive: true })
    setup({ status: { state: 'closed', browser: BROWSER } })
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording▾')
    expect(screen.queryByRole('timer')).toBeNull()
  })

  // A browser that is closing or has closed is no longer the source. After one has closed, the
  // session can keep running through the extension, and the panel says only that it closed.
  it.each([
    ['closing', { state: 'closing', browser: BROWSER }],
    ['closed', { state: 'closed', browser: BROWSER }]
  ] satisfies Array<[string, LaunchedBrowserStatus]>)(
    'names the extension on a Case once the launched browser is %s',
    (_, status) => {
      useAppStore.setState({ sessionActive: true, connectedToExtension: true })
      setup({ status })
      expect(screen.getByTestId('topbar-rec').textContent).toBe('Recordingextension▾')
    }
  )

  // The panel names the open browser, so the mark says only that the extension records too.
  it('leaves the browser out on a Case while it is open, and adds the extension', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    setup({ status: OPEN })
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording+ extension▾')
  })

  it('opens the panel as a popover where no Case is on screen, naming the browser in the mark', async () => {
    useAppStore.setState({ sessionActive: true })
    setup({ caseId: null, showOpenCase: true, status: OPEN })
    const mark = screen.getByTestId('topbar-capture-session')
    expect(mark.textContent).toContain('Launched Google Chrome')
    expect(mark.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(mark)
    const popover = await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(within(popover).getByTestId('panel').textContent).toBe('popover:open-case')
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(false)
  })

  it('passes on that Settings offers no link to the Case', async () => {
    useAppStore.setState({ sessionActive: true })
    setup({ caseId: null, showOpenCase: false, status: OPEN })
    fireEvent.click(screen.getByTestId('topbar-capture-session'))
    expect((await screen.findByTestId('panel')).textContent).toBe('popover:no-open-case')
  })

  // A browser open with nothing recording is not a recording.
  it('is an outline Capture Session button, not a recording mark, while no session records', async () => {
    setup({ caseId: null, status: OPEN })
    const button = screen.getByTestId('topbar-capture-session')
    expect(button.textContent).toBe('Capture Session')
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
    expect(button.className).not.toContain('bg-accent-subtle')
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(button.className).toContain('bg-accent-subtle')
  })

  it('takes the accent on a Case while its panel shows, with no session recording', () => {
    setup({ status: OPEN })
    const button = screen.getByTestId('topbar-capture-session')
    expect(button.textContent).toBe('Capture Session')
    expect(button.className).toContain('bg-accent-subtle')
    fireEvent.click(button)
    expect(button.className).not.toContain('bg-accent-subtle')
  })
})

// Decision 7 of the consolidation plan, answer 2: the extension's Capture Session starts from
// this menu and stops from the mark's, now that the row under the top bar is gone.
describe("starting the extension's session from the menu", () => {
  function startItem(): HTMLElement {
    return within(openMenu()).getByTestId('launch-control-start-session')
  }

  it('names Chrome and says the session uses the extension', () => {
    useAppStore.setState({ connectedToExtension: true })
    setup()
    const item = startItem()
    expect(item.textContent).toBe('Start Capture Session in ChromeUses the extension.')
    expect(isDisabledItem(item)).toBe(false)
    expect(item.getAttribute('title')).toBeNull()
  })

  it('holds the start while the extension is not connected, and says why', () => {
    const { session, checkVpnWarning } = setup()
    const item = startItem()
    expect(isDisabledItem(item)).toBe(true)
    expect(item.getAttribute('title')).toBe('The extension is not connected')
    fireEvent.click(item)
    expect(checkVpnWarning).not.toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()
  })

  // Main refuses a start with no Active Case, and only a Case screen gives one to activate.
  it('holds the start where no Case is on screen, and says why', () => {
    useAppStore.setState({ connectedToExtension: true })
    const { session } = setup({ caseId: null })
    const item = startItem()
    expect(isDisabledItem(item)).toBe(true)
    expect(item.getAttribute('title')).toBe('Open a Case first')
    fireEvent.click(item)
    expect(session.start).not.toHaveBeenCalled()
  })

  it('activates the Case on screen, then starts, and becomes the recording mark', async () => {
    useAppStore.setState({ connectedToExtension: true })
    const { calls } = setup()
    fireEvent.click(startItem())
    await waitFor(() => expect(useAppStore.getState().sessionActive).toBe(true))
    expect(calls).toEqual(['activate case-1', 'start'])
    expect(useVpnWarningStore.getState().open).toBe(false)
    const mark = await screen.findByTestId('topbar-capture-session')
    expect(within(mark).getByTestId('topbar-rec').textContent).toBe('Recordingextension▾')
    expect(screen.queryByRole('button', { name: /^Launch browser/ })).toBeNull()
  })

  // A session's Captures contact sites, so its start passes the VPN warning (ADR-0032 rule 3).
  it('warns before the session starts, as a session warning, and starts once continued', async () => {
    useAppStore.setState({ connectedToExtension: true })
    const { session, checkVpnWarning, calls } = setup({ warn: true })
    fireEvent.click(startItem())
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    expect(useVpnWarningStore.getState().request?.occasion).toBe('session')
    // Main keeps the session warning apart from a site warning already given in the Case.
    expect(checkVpnWarning).toHaveBeenCalledWith({ caseId: 'case-1' }, 'session')
    expect(session.activateCase).not.toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()

    settleVpnWarning('continue')
    await waitFor(() => expect(useAppStore.getState().sessionActive).toBe(true))
    expect(calls).toEqual(['activate case-1', 'start'])
  })

  it('starts nothing when the Operator stops at the warning, and offers the start again', async () => {
    useAppStore.setState({ connectedToExtension: true })
    const { session } = setup({ warn: true })
    fireEvent.click(startItem())
    await waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    settleVpnWarning('dismiss')
    await waitFor(() => expect(isDisabledItem(startItem())).toBe(false))
    expect(session.activateCase).not.toHaveBeenCalled()
    expect(session.start).not.toHaveBeenCalled()
    expect(useAppStore.getState().sessionActive).toBe(false)
    expect(launchButton()).toBeTruthy()
  })

  // The buttons the start replaces held focus, so it moves to the mark, not to the page.
  it('moves focus to the recording mark once the session starts', async () => {
    useAppStore.setState({ connectedToExtension: true })
    setup()
    const trigger = screen.getByRole('button', { name: 'More ways to capture' })
    trigger.focus()
    await press('Enter')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('launch-control-launch'))
    )
    await press('ArrowDown', screen.getByTestId('launch-control-paste'))
    await press('ArrowDown', screen.getByTestId('launch-control-start-session'))
    await press('Enter')
    const mark = await screen.findByTestId('topbar-capture-session')
    await waitFor(() => expect(document.activeElement).toBe(mark))
  })
})

describe("the capture control during the extension's session", () => {
  function recording(overrides: Setup = {}) {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    return setup(overrides)
  }

  function openMarkMenu(): HTMLElement {
    fireEvent.click(screen.getByTestId('topbar-capture-session'))
    return screen.getByRole('menu')
  }

  // The extension's session has no panel, so its mark opens the capture menu.
  it('is the recording mark, with no Launch browser button beside it', () => {
    recording()
    const mark = screen.getByTestId('topbar-capture-session')
    expect(within(mark).getByTestId('topbar-rec').textContent).toBe('Recordingextension▾')
    expect(mark.getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('button', { name: /^Capture Session, ?Recording ?extension$/ })).toBe(
      mark
    )
    expect(screen.queryByRole('button', { name: /^Launch browser/ })).toBeNull()
    expect(screen.getAllByTestId('topbar-rec')).toHaveLength(1)
  })

  // A browser can still be launched to join the session, so the menu keeps its other items.
  it('opens the capture menu with Stop first and no second start', async () => {
    recording()
    const menu = openMarkMenu()
    await within(menu).findByTestId('launch-control-proxy')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.dataset.testid)
    ).toEqual([
      'launch-control-stop',
      'launch-control-launch',
      'launch-control-paste',
      'launch-control-proxy'
    ])
    expect(within(menu).getByTestId('launch-control-stop').textContent).toBe('Stop Capture Session')
  })

  it('opens on Stop from the keyboard', async () => {
    recording()
    screen.getByTestId('topbar-capture-session').focus()
    await press('Enter')
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('launch-control-stop'))
    )
  })

  it('stops the session at once, with no confirmation, and returns to Launch browser', async () => {
    const { session } = recording()
    fireEvent.click(within(openMarkMenu()).getByTestId('launch-control-stop'))
    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useAppStore.getState().sessionActive).toBe(false))
    expect(useAppStore.getState().stopConfirmOpen).toBe(false)
    const launch = launchButton()
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
    // The mark that held focus is gone, so focus moves to the button in its place.
    await waitFor(() => expect(document.activeElement).toBe(launch))
  })

  // Off a Case screen a running session still has to be stoppable; only a start needs a Case.
  it('leaves the session stoppable where no Case is on screen', async () => {
    const { session } = recording({ caseId: null })
    fireEvent.click(within(openMarkMenu()).getByTestId('launch-control-stop'))
    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1))
  })

  it('leaves the session stoppable after the extension disconnects', async () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: false })
    const { session } = setup()
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording▾')
    fireEvent.click(within(openMarkMenu()).getByTestId('launch-control-stop'))
    await waitFor(() => expect(session.stop).toHaveBeenCalledTimes(1))
  })

  it('keeps the session recording when the stop fails', async () => {
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session } = recording()
    session.stop.mockRejectedValueOnce(new Error('main refused'))
    fireEvent.click(within(openMarkMenu()).getByTestId('launch-control-stop'))
    await waitFor(() => expect(failed).toHaveBeenCalled())
    expect(useAppStore.getState().sessionActive).toBe(true)
    expect(screen.getByTestId('topbar-capture-session')).toBeTruthy()
    failed.mockRestore()
  })
})

// Decision 7, answer 10: the breadcrumb names the Case on screen, and the mark names the Case
// that Captures go into when it is another.
describe('the Case the session records into', () => {
  it("names the extension's Active Case when it is not the Case on screen", () => {
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-2'
    })
    setup()
    const into = screen.getByTestId('rec-into')
    expect(into.textContent).toBe('into Harbor Desk')
    expect(into.getAttribute('title')).toBe('into Harbor Desk')
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recordingextensioninto Harbor Desk▾')
  })

  // A launched browser pins the Case it started in, so opening another Case to read it does not
  // move where Captures go.
  it("names a launched browser's Active Case when it is not the Case on screen", () => {
    useAppStore.setState({ sessionActive: true, activeCaseId: 'case-2' })
    setup({ status: { state: 'open', browser: { ...BROWSER, caseId: 'case-2' } } })
    expect(screen.getByTestId('rec-into').textContent).toBe('into Harbor Desk')
  })

  it.each([
    ['the Case on screen', 'case-1', 'case-1'],
    ['no Case yet', 'case-1', null]
  ] satisfies Array<[string, string, string | null]>)(
    'names no Case while the session records into %s',
    (_, caseId, activeCaseId) => {
      useAppStore.setState({ sessionActive: true, connectedToExtension: true, activeCaseId })
      setup({ caseId })
      expect(screen.getByTestId('topbar-rec')).toBeTruthy()
      expect(screen.queryByTestId('rec-into')).toBeNull()
    }
  )

  // The dashboard and Settings name no Case in the breadcrumb, so there is nothing to tell apart.
  it('names no Case where no Case is on screen', () => {
    useAppStore.setState({
      sessionActive: true,
      connectedToExtension: true,
      activeCaseId: 'case-2'
    })
    setup({ caseId: null })
    expect(screen.queryByTestId('rec-into')).toBeNull()
  })
})
