// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { useAppStore } from '@renderer/stores/appStore'
import { queryKeys } from '@renderer/lib/api/keys'
import { members, sync } from './sharingFixtures'
import { stubResizeObserver } from './resizeObserverStub'
import type { LaunchedBrowserStatus } from '@shared/types'

const routerState = vi.hoisted(() => ({ pathname: '/' }))
const navigate = vi.hoisted(() => vi.fn())

// Mirrors the three patterns the bar asks about. `/cases/$caseId` matches any
// segment, `new` included, which is the collision the wizard route guards against.
function matchRoute({ to, fuzzy }: { to: string; fuzzy?: boolean }) {
  const { pathname } = routerState
  if (to === '/cases/$caseId') {
    const match = pathname.match(fuzzy ? /^\/cases\/([^/]+)/ : /^\/cases\/([^/]+)$/)
    return match ? { caseId: match[1] } : false
  }
  return pathname === to ? {} : false
}

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back: vi.fn() } }),
  useMatchRoute: () => matchRoute
}))
vi.mock('@renderer/hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => ({ status: null })
}))
vi.mock('@renderer/hooks/useSearch', () => ({
  useSearch: () => ({
    results: [],
    noteResults: [],
    searching: false,
    search: vi.fn(),
    clear: vi.fn()
  })
}))
vi.mock('@renderer/components/status/SessionControls', () => ({
  SessionControls: () => <div data-testid="session-controls" />
}))
vi.mock('@renderer/components/status/StatusGroup', () => ({
  StatusGroup: () => <div data-testid="status-group" />
}))

import { TopBar } from '@renderer/components/layout/TopBar'

function renderAt(pathname: string) {
  routerState.pathname = pathname
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { ...render(<TopBar />, { wrapper: Wrapper }), client }
}

let getCase: ReturnType<typeof vi.fn>

beforeEach(() => {
  stubMatchMedia(false)
  getCase = vi.fn(async () => ({ id: 'case1', name: 'Operation Kestrel' }))
  fakeBridge({ cases: { get: getCase } })
  useAppStore.setState({
    sessionActive: false,
    connectedToExtension: false,
    commandPaletteOpen: false
  })
  navigate.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('the case chrome', () => {
  it('shows the case switcher and search inside a case', async () => {
    renderAt('/cases/case1/overview')
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').textContent).toContain('Operation Kestrel')
    )
    expect(screen.getByTestId('global-search-input')).toBeTruthy()
  })

  // It sits in CaseActionBar, so the bar's right side keeps one width beside the
  // native window controls.
  it('leaves the session switch to the case action bar', async () => {
    renderAt('/cases/case1/overview')
    await waitFor(() => expect(screen.getByTestId('topbar-case-name')).toBeTruthy())
    expect(screen.queryByTestId('session-controls')).toBeNull()
  })

  // The status group, then the capture control (LaunchControl.test.tsx): Launch browser and the
  // menu beside it. Share and Export are items of the Case menu on the Case name, and Settings is
  // at the foot of the rail on a Case screen.
  it('holds the status group and the capture control, and leaves the rest to the Case menu and the rail', async () => {
    renderAt('/cases/case1/overview')
    const controls = screen.getByTestId('topbar-controls')
    await within(controls).findByRole('button', { name: 'Launch browser' })
    const row = Array.from(controls.querySelectorAll('button, [data-testid="status-group"]')).map(
      (el) => el.getAttribute('data-testid') ?? el.getAttribute('title') ?? el.textContent
    )
    expect(row).toEqual(['status-group', 'Launch browser', 'More ways to capture'])
    expect(within(controls).queryByText(/Share|Export/)).toBeNull()
    expect(controls.contains(screen.getByTestId('topbar-case-name'))).toBe(false)
    expect(screen.queryByTitle('Settings')).toBeNull()
    expect(screen.queryByTitle('Toggle theme')).toBeNull()
  })

  it('treats the new-case wizard as no case, like the dashboard', () => {
    renderAt('/cases/new')
    expect(screen.queryByTestId('topbar-case-name')).toBeNull()
    expect(screen.queryByTestId('global-search-input')).toBeNull()
    expect(screen.queryByTestId('session-controls')).toBeNull()
    expect(getCase).not.toHaveBeenCalled()
  })

  it('shows no case control on the dashboard', () => {
    renderAt('/')
    expect(screen.queryByTestId('topbar-case-name')).toBeNull()
    expect(screen.queryByTestId('global-search-input')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Launch browser' })).toBeNull()
    expect(screen.getByTestId('status-group')).toBeTruthy()
  })

  // Settings is in this bar only where no rail holds it. The rail shows on Case screens and on
  // the new-Case wizard, so the dashboard is where the gear stays.
  it('keeps Settings after the capture control on the dashboard, and opens it', () => {
    renderAt('/')
    const controls = screen.getByTestId('topbar-controls')
    const settings = within(controls).getByTitle('Settings')
    expect(controls.lastElementChild).toBe(settings)
    expect(settings.previousElementSibling).toBe(screen.getByTestId('launch-control'))
    expect(controls.firstElementChild).toBe(screen.getByTestId('status-group'))
    fireEvent.click(settings)
    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
  })

  it.each(['/cases/new', '/cases/case1/overview'])('leaves Settings to the rail at %s', (path) => {
    renderAt(path)
    expect(screen.getByTestId('status-group')).toBeTruthy()
    expect(screen.queryByTitle('Settings')).toBeNull()
  })
})

describe('Launch browser', () => {
  const BROWSER = {
    family: 'chrome' as const,
    label: 'Google Chrome',
    caseId: 'case1',
    version: '149.0.7827.55',
    extensionWarnings: [],
    sessionStartedAt: null,
    tabs: []
  }

  function renderWith(status: LaunchedBrowserStatus) {
    fakeBridge({
      cases: { get: getCase },
      launchedBrowser: { status: vi.fn(async () => status) }
    })
    renderAt('/cases/case1/overview').client.setQueryData(queryKeys.launchedBrowserStatus, status)
  }

  afterEach(() => {
    useAppStore.setState({ startDialogCaseId: null, startDialogPicking: false })
  })

  // `2b`: it shows whenever a Case is open, so it needs no extension.
  it('opens the start dialog for the open Case, with no extension connected', async () => {
    renderWith({ state: 'none' })
    const launch = (await screen.findByRole('button', {
      name: 'Launch browser'
    })) as HTMLButtonElement
    // The 28 pixel control, and the bar's one filled button.
    expect(launch.className).toContain('h-7')
    expect(launch.className).toContain('bg-accent')
    await waitFor(() => expect(launch.getAttribute('aria-disabled')).toBe('false'))
    fireEvent.click(launch)
    expect(useAppStore.getState().startDialogCaseId).toBe('case1')
  })

  // The Capture Session panel is the open browser's place, and names it.
  it('leaves the bar while a launched browser is open', async () => {
    renderWith({ state: 'open', browser: BROWSER })
    // Export renders once the Case has loaded, as Launch browser would: without this wait the
    // button is absent whatever the browser's state.
    await within(screen.getByTestId('topbar-controls')).findByTestId('export-menu')
    expect(screen.queryByRole('button', { name: 'Launch browser' })).toBeNull()
    expect(screen.queryByTitle('A launched browser is already open')).toBeNull()
  })

  it('holds it while one is starting, and says why', async () => {
    renderWith({ state: 'starting', browser: BROWSER, step: 'browser' })
    const launch = await screen.findByRole('button', { name: 'Launch browser' })
    await waitFor(() => expect(launch.getAttribute('aria-disabled')).toBe('true'))
    expect(launch.getAttribute('title')).toBe('A launched browser is starting')
  })

  // With no Case the address can name, the launch dialog asks which Case.
  it('offers the Case picker when the address names no Case', async () => {
    getCase.mockResolvedValue(undefined)
    renderWith({ state: 'none' })
    await waitFor(() => expect(getCase).toHaveBeenCalledWith('case1'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Launch browser…' }))
    expect(useAppStore.getState().startDialogPicking).toBe(true)
    expect(screen.getByTestId('topbar-case-name')).toBeTruthy()
  })

  // A closed browser leaves its Capture Session running. The control stays the session's, and
  // the panel it shows offers Launch again.
  it('stays the session control once the launched browser has closed', async () => {
    useAppStore.setState({ sessionActive: true })
    renderWith({ state: 'closed', browser: BROWSER })
    expect(await screen.findByTestId('topbar-capture-session')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Launch browser' })).toBeNull()
  })
})

describe('the left group', () => {
  it('goes home from the logo', () => {
    renderAt('/cases/case1/overview')
    fireEvent.click(screen.getByTitle('Home'))
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  // The Case name opens the Case menu (CaseNameMenu.test.tsx), whose first item is the switcher.
  it('opens the Case menu from the case name, and the case switcher from its first item', async () => {
    renderAt('/cases/case1/overview')
    fireEvent.click(screen.getByTestId('topbar-case-name'))
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
    const menu = screen.getByRole('menu')
    await waitFor(() => expect(menu.getAttribute('aria-label')).toContain('Operation Kestrel'))
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Switch Case/ }))
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
  })
})

// This installation's Member Code leads the Case name on a shared Case
// (docs/design-handoff/2026-10-28-share-a-case/, frame C).
describe('the breadcrumb chip', () => {
  function bridgeWithRoster(roster: ReturnType<typeof members>) {
    fakeBridge({
      cases: { get: getCase },
      sharing: {
        getMembers: vi.fn(async () => roster),
        getSyncState: vi.fn(async () => sync()),
        isAvailable: vi.fn(async () => true)
      }
    })
  }

  it('leads the case name with this installation’s code and names it in the tooltip', async () => {
    bridgeWithRoster(members())
    renderAt('/cases/case1/overview')
    const chip = await screen.findByTestId('topbar-member-code')
    expect(chip.textContent).toBe('AR')
    expect(chip.dataset.hue).toBe('accent')
    const switcher = screen.getByTestId('topbar-case-name')
    expect(switcher.contains(chip)).toBe(true)
    // The chip and the chevron share the name's track, which gives way down to 160 pixels.
    expect(switcher.closest('.grid')!.className).toContain('minmax(10rem,max-content)')
    expect(switcher.title).toBe('Operation Kestrel · Case menu · You are AR in this Case')
  })

  it('shows no chip and the plain tooltip on a Case nobody has shared', async () => {
    bridgeWithRoster(members({ members: [], invites: [], pendingJoins: [] }))
    renderAt('/cases/case1/overview')
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').textContent).toContain('Operation Kestrel')
    )
    expect(screen.queryByTestId('topbar-member-code')).toBeNull()
    expect(screen.getByTestId('topbar-case-name').title).toBe('Operation Kestrel · Case menu')
  })
})

// Design review of 2026-11-04: at 1,200 pixels the Case name had shortened to "F.". jsdom has no
// layout, so e2e/topbar-layout.spec.ts measures the name against the search at each width.
describe('the breadcrumb case name', () => {
  it("shows the open Case's name", async () => {
    renderAt('/cases/case1/overview')
    const name = await screen.findByTestId('topbar-case-name-text')
    await waitFor(() => expect(name.textContent).toBe('Operation Kestrel'))
  })

  it('carries the full name in the tooltip for when it is hidden', async () => {
    renderAt('/cases/case1/overview')
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').title).toMatch(/^Operation Kestrel · /)
    )
  })
})

describe('the settings header', () => {
  it('keeps the recording mark and the session control while an extension session runs', () => {
    useAppStore.setState({ sessionActive: true })
    renderAt('/settings')
    expect(screen.getByText('Return to Birdbrain')).toBeTruthy()
    expect(screen.getByTestId('topbar-rec')).toBeTruthy()
    expect(screen.getByTestId('session-controls')).toBeTruthy()
    expect(screen.getByTestId('status-group')).toBeTruthy()
  })

  it('shows neither when no session is running', () => {
    renderAt('/settings')
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
    expect(screen.queryByTestId('session-controls')).toBeNull()
  })

  it('has no theme toggle: Settings → Appearance holds it', () => {
    renderAt('/settings')
    expect(screen.queryByTitle('Toggle theme')).toBeNull()
  })
})

// The recording mark is the capture control's running state, on every screen.
describe('the recording mark', () => {
  it('shows in the top bar on a Case screen during an extension-only session', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    renderAt('/cases/case1/captures')
    const mark = within(screen.getByTestId('topbar-controls')).getByTestId('topbar-rec')
    expect(mark.textContent).toBe('Recordingextension')
  })

  it('shows on the dashboard during an extension-only session, as a dot and the word', () => {
    useAppStore.setState({ sessionActive: true, connectedToExtension: true })
    renderAt('/')
    const mark = screen.getByTestId('topbar-rec')
    expect(mark.textContent).toContain('Recording')
    expect(mark.textContent).toContain('extension')
    expect(mark.textContent).not.toContain('REC')
  })
})

// 2c and 2d: the dashboard and Settings have no rail, so the top bar carries the panel as a
// popover while a launched browser is open, beside what the bar already shows.
describe('the Capture Session button', () => {
  const OPEN: LaunchedBrowserStatus = {
    state: 'open',
    browser: {
      family: 'chrome',
      label: 'Google Chrome',
      caseId: 'case1',
      version: '149.0.7827.55',
      extensionWarnings: [],
      sessionStartedAt: null,
      tabs: [{ targetId: 't1', title: 'Harbor notices', url: 'https://ferry.test/' }]
    }
  }

  function bridgeWith(status: LaunchedBrowserStatus) {
    fakeBridge({
      cases: {
        get: getCase,
        list: vi.fn(async () => [{ id: 'case1', name: 'Operation Kestrel' }])
      },
      settings: { get: vi.fn(async () => ({ egress: { kind: 'direct' } })) },
      launchedBrowser: { status: vi.fn(async () => status) }
    })
  }

  beforeEach(() => {
    stubResizeObserver()
    useAppStore.setState({ sessionActive: true })
  })

  async function openPopover() {
    const button = await screen.findByTestId('topbar-capture-session')
    fireEvent.click(button)
    return screen.findByRole('dialog', { name: 'Capture Session' })
  }

  it('opens the panel from the dashboard, keeping the status group', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    const popover = await openPopover()
    expect(popover.textContent).toContain('Launched Google Chrome')
    expect(popover.textContent).toContain('1 tab')
    expect(screen.getByTestId('status-group')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Operation Kestrel' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/$caseId', params: { caseId: 'case1' } })
  })

  // While a session records, the recording mark is the trigger (2026-11-08 top bar); with a
  // browser open and no session yet, the outline button, which takes the accent while open.
  it('is the recording mark while a session records', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    const button = await screen.findByTestId('topbar-capture-session')
    expect(button.querySelector('[data-testid="topbar-rec"]')).toBeTruthy()
    expect(button.textContent).toContain('Launched Google Chrome')
    expect(button.textContent).not.toContain('REC')
    expect(screen.getAllByTestId('topbar-rec')).toHaveLength(1)
  })

  // The mark is the button's content, so its accessible name carries what the mark shows.
  it("keeps the elapsed time and the source in the trigger's accessible name", async () => {
    bridgeWith({ ...OPEN, browser: { ...OPEN.browser, sessionStartedAt: Date.now() - 5_000 } })
    renderAt('/')
    const button = await screen.findByTestId('topbar-capture-session')
    await screen.findByRole('timer')
    expect(button.getAttribute('aria-label')).toBeNull()
    expect(
      screen.getByRole('button', {
        name: /^Capture Session, ?Recording ?00:0\d ?Launched Google Chrome$/
      })
    ).toBe(button)
  })

  it('marks the outline button selected while its popover is open', async () => {
    useAppStore.setState({ sessionActive: false })
    bridgeWith(OPEN)
    renderAt('/')
    const button = await screen.findByTestId('topbar-capture-session')
    expect(button.className).not.toContain('bg-accent-subtle')
    fireEvent.click(button)
    await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(button.className).toContain('bg-accent-subtle')
  })

  it('opens it in Settings beside the switch, as the recording mark, with no Open Case', async () => {
    bridgeWith(OPEN)
    renderAt('/settings')
    const popover = await openPopover()
    expect(popover.textContent).toContain('Launched Google Chrome')
    expect(screen.getByTestId('session-controls')).toBeTruthy()
    expect(screen.getAllByTestId('topbar-rec')).toHaveLength(1)
    // The Open link names the Case once the Case list has loaded, so wait for the list first.
    await waitFor(() => expect(popover.textContent).toContain('Into Operation Kestrel'))
    expect(screen.queryByRole('button', { name: /^Open\b/ })).toBeNull()
  })

  it('opens it on the new-Case wizard, which has no rail', async () => {
    bridgeWith(OPEN)
    renderAt('/cases/new')
    expect(await openPopover()).toBeTruthy()
  })

  // A Case screen has the panel on it, so the mark shows and hides that panel and opens no
  // popover.
  it('shows and hides the panel on a Case screen, with no popover', async () => {
    bridgeWith(OPEN)
    renderAt('/cases/case1/captures')
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').textContent).toContain('Operation Kestrel')
    )
    const mark = await screen.findByTestId('topbar-capture-session')
    await waitFor(() => expect(mark.getAttribute('aria-expanded')).toBe('true'))
    fireEvent.click(mark)
    expect(useAppStore.getState().captureSessionPanelHidden).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
    useAppStore.setState({ captureSessionPanelHidden: false })
  })

  it('comes back closed for the next browser after the last one went', async () => {
    bridgeWith(OPEN)
    const { client } = renderAt('/')
    await openPopover()
    act(() => {
      client.setQueryData(['launchedBrowser', 'status'], { state: 'none' })
    })
    await waitFor(() => expect(screen.queryByTestId('topbar-capture-session')).toBeNull())
    act(() => {
      client.setQueryData(['launchedBrowser', 'status'], OPEN)
    })
    expect(await screen.findByTestId('topbar-capture-session')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
  })

  it('does not show with no launched browser', async () => {
    useAppStore.setState({ sessionActive: false })
    bridgeWith({ state: 'none' })
    renderAt('/')
    await waitFor(() => expect(screen.getByTitle('Settings')).toBeTruthy())
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
  })

  it('names the launched browser in the mark while it is open, and no source once it has closed', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    expect(await screen.findByText('Launched Google Chrome')).toBeTruthy()
    cleanup()
    bridgeWith({ state: 'closed', browser: { ...OPEN.browser, tabs: [] } })
    renderAt('/')
    await screen.findByTestId('topbar-capture-session')
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording▾')
  })

  it('names the extension in the mark once the browser has closed while one is connected', async () => {
    useAppStore.setState({ connectedToExtension: true })
    bridgeWith({ state: 'closed', browser: { ...OPEN.browser, tabs: [] } })
    renderAt('/')
    await screen.findByTestId('topbar-capture-session')
    expect(screen.getByTestId('topbar-rec').textContent).toBe('Recordingextension▾')
  })

  // With no session and no browser, a notice of how the last one closed is the capture
  // control's to show: on its button, and in its menu.
  it.each(['/', '/settings'])('shows a notice in the capture control at %s', async (path) => {
    useAppStore.setState({ sessionActive: false, dismissedLaunchNotice: null })
    bridgeWith({
      state: 'none',
      notice: { code: 'EGRESS_BYPASS', message: 'A response did not come through…' }
    })
    renderAt(path)
    await screen.findByRole('button', { name: /^Launch browser…\. 1 notice: / })
    fireEvent.click(screen.getByRole('button', { name: 'More ways to capture' }))
    expect(screen.getByTestId('launch-control-notice').textContent).toContain(
      'The Capture Session ended.'
    )
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
  })
})
