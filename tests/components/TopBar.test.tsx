// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { useAppStore } from '@renderer/stores/appStore'
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
vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() })
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
vi.mock('@renderer/components/status/ConnectionStatus', () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />
}))
vi.mock('@renderer/components/status/CaptureHealth', () => ({
  CaptureHealth: () => <div data-testid="capture-health" />
}))
vi.mock('@renderer/components/export/ExportMenu', () => ({
  ExportMenu: ({ caseId, caseName }: { caseId: string; caseName: string }) => (
    <div data-testid="export-menu">{`${caseId}:${caseName}`}</div>
  )
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
  useAppStore.setState({ sessionActive: false, commandPaletteOpen: false })
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

  it('carries Export for the open case', async () => {
    renderAt('/cases/case1/overview')
    await waitFor(() =>
      expect(screen.getByTestId('export-menu').textContent).toBe('case1:Operation Kestrel')
    )
  })

  it('treats the new-case wizard as no case, like the dashboard', () => {
    renderAt('/cases/new')
    expect(screen.queryByTestId('topbar-case-name')).toBeNull()
    expect(screen.queryByTestId('global-search-input')).toBeNull()
    expect(screen.queryByTestId('session-controls')).toBeNull()
    expect(screen.queryByTestId('export-menu')).toBeNull()
    expect(getCase).not.toHaveBeenCalled()
  })

  it('shows no case control on the dashboard', () => {
    renderAt('/')
    expect(screen.queryByTestId('topbar-case-name')).toBeNull()
    expect(screen.queryByTestId('global-search-input')).toBeNull()
    expect(screen.queryByTestId('export-menu')).toBeNull()
  })
})

describe('the left group', () => {
  it('goes home from the logo', () => {
    renderAt('/cases/case1/overview')
    fireEvent.click(screen.getByTitle('Home'))
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
  })

  it('opens the case switcher from the case name', () => {
    renderAt('/cases/case1/overview')
    fireEvent.click(screen.getByTestId('topbar-case-name'))
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
    expect(switcher.title).toMatch(
      /^Operation Kestrel · Switch case \(.+\) · You are AR in this Case$/
    )
    // The chip widens the name's track, so the name still keeps about eight characters.
    expect(switcher.parentElement!.className).toContain('minmax(7.5rem,max-content)')
  })

  it('shows no chip and the plain tooltip on a Case nobody has shared', async () => {
    bridgeWithRoster(members({ members: [], invites: [], pendingJoins: [] }))
    renderAt('/cases/case1/overview')
    await waitFor(() => expect(screen.getByTestId('share-pill').dataset.state).toBe('share'))
    expect(screen.queryByTestId('topbar-member-code')).toBeNull()
    expect(screen.getByTestId('topbar-case-name').title).toMatch(
      /^Operation Kestrel · Switch case \(.+\)$/
    )
  })
})

// Design review of 2026-11-04: at 1,200 pixels the Case name had shortened to "F.".
describe('the breadcrumb case name', () => {
  it('keeps about eight characters before the search gives up width, then hides below 1,000', async () => {
    renderAt('/cases/case1/overview')
    const name = await screen.findByTestId('topbar-case-name-text')
    await waitFor(() => expect(name.textContent).toBe('Operation Kestrel'))
    expect(name.className).toContain('truncate')
    expect(name.className).toContain('min-w-16')
    expect(name.className).toContain('max-[1000px]:hidden')
    const track = screen.getByTestId('topbar-case-name').parentElement!.className
    expect(track).toContain('grid-cols-[max-content_max-content_minmax(6rem,max-content)]')
    expect(track).toContain(
      'max-[1000px]:grid-cols-[max-content_max-content_minmax(2rem,max-content)]'
    )
  })

  it('carries the full name in the tooltip for when it is hidden', async () => {
    renderAt('/cases/case1/overview')
    await waitFor(() =>
      expect(screen.getByTestId('topbar-case-name').title).toMatch(/^Operation Kestrel · /)
    )
  })
})

describe('the settings header', () => {
  it('keeps the REC indicator and the session control while a session runs', () => {
    useAppStore.setState({ sessionActive: true })
    renderAt('/settings')
    expect(screen.getByText('Return to Birdbrain')).toBeTruthy()
    expect(screen.getByTestId('topbar-rec')).toBeTruthy()
    expect(screen.getByTestId('session-controls')).toBeTruthy()
  })

  it('shows neither when no session is running', () => {
    renderAt('/settings')
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
    expect(screen.queryByTestId('session-controls')).toBeNull()
  })
})

describe('the theme toggle', () => {
  it('carries one static title in the normal header', () => {
    renderAt('/')
    expect(screen.getByTitle('Toggle theme')).toBeTruthy()
  })

  it('carries the same title in the settings header', () => {
    renderAt('/settings')
    expect(screen.getByTitle('Toggle theme')).toBeTruthy()
  })
})

describe('the REC indicator', () => {
  it('shows in the normal header while a session runs', () => {
    useAppStore.setState({ sessionActive: true })
    renderAt('/cases/case1/captures')
    expect(screen.getByTestId('topbar-rec')).toBeTruthy()
  })
})

// 2c and 2d, revised 2026-11-04: the dashboard and Settings have no rail, so the REC pill opens
// the panel as a popover while a launched browser is open; there is no separate button.
describe('the REC pill as the Capture Session trigger', () => {
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

  async function findTrigger() {
    await screen.findByText('· Launched Google Chrome')
    const pill = screen.getByTestId('topbar-rec')
    await waitFor(() => expect(pill.tagName).toBe('BUTTON'))
    return screen.getByTestId('topbar-rec')
  }

  async function openPopover() {
    fireEvent.click(await findTrigger())
    return screen.findByRole('dialog', { name: 'Capture Session' })
  }

  it('opens the panel from the dashboard, keeping connection status and capture health', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    const popover = await openPopover()
    expect(popover.textContent).toContain('Launched Google Chrome')
    expect(popover.textContent).toContain('1 tab')
    expect(screen.getByTestId('connection-status')).toBeTruthy()
    expect(screen.getByTestId('capture-health')).toBeTruthy()
    expect(screen.getByTitle('Toggle theme')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Operation Kestrel' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/$caseId', params: { caseId: 'case1' } })
  })

  it('reads "REC · Launched Google Chrome" with a chevron, and no Capture Session button', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    const trigger = await findTrigger()
    expect(trigger.textContent).toBe('REC· Launched Google Chrome')
    expect(trigger.querySelector('svg')).toBeTruthy()
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
  })

  it('takes the accent outline while its popover is open', async () => {
    bridgeWith(OPEN)
    renderAt('/')
    const trigger = await findTrigger()
    expect(trigger.className).not.toContain('outline-accent')
    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(trigger.className).toContain('outline-accent')
  })

  it('opens it in Settings beside the switch and the theme toggle, with no Open Case', async () => {
    bridgeWith(OPEN)
    renderAt('/settings')
    const popover = await openPopover()
    expect(popover.textContent).toContain('Launched Google Chrome')
    expect(screen.getByTestId('session-controls')).toBeTruthy()
    expect(screen.getByTitle('Toggle theme')).toBeTruthy()
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Operation Kestrel' })).toBeNull()
  })

  it('opens it on the new-Case wizard, which has no rail', async () => {
    bridgeWith(OPEN)
    renderAt('/cases/new')
    expect(await openPopover()).toBeTruthy()
  })

  it('leaves Case screens to the rail', async () => {
    bridgeWith(OPEN)
    renderAt('/cases/case1/captures')
    await screen.findByText('· Launched Google Chrome')
    expect(screen.getByTestId('topbar-rec').tagName).toBe('DIV')
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
  })

  it('comes back closed for the next browser after the last one went', async () => {
    bridgeWith(OPEN)
    const { client } = renderAt('/')
    await openPopover()
    act(() => {
      client.setQueryData(['launchedBrowser', 'status'], { state: 'none' })
    })
    await waitFor(() => expect(screen.getByTestId('topbar-rec').tagName).toBe('DIV'))
    act(() => {
      client.setQueryData(['launchedBrowser', 'status'], OPEN)
    })
    expect(await findTrigger()).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Capture Session' })).toBeNull()
  })

  it('is a plain pill with no launched browser', async () => {
    bridgeWith({ state: 'none' })
    renderAt('/')
    await waitFor(() => expect(screen.getByTitle('Toggle theme')).toBeTruthy())
    expect(screen.getByTestId('topbar-rec').tagName).toBe('DIV')
    expect(screen.queryByTestId('topbar-capture-session')).toBeNull()
  })

  it('names the launched browser while it is open, and not once it has closed', async () => {
    bridgeWith({ state: 'closed', browser: { ...OPEN.browser, tabs: [] } })
    renderAt('/')
    await waitFor(() => expect(screen.getByTestId('topbar-rec').tagName).toBe('BUTTON'))
    expect(screen.getByTestId('topbar-rec').textContent).toBe('REC')
  })

  it('leaves a notice to the Capture Session button once no session runs', async () => {
    useAppStore.setState({ sessionActive: false, dismissedLaunchNotice: null })
    bridgeWith({
      state: 'none',
      notice: { code: 'EGRESS_BYPASS', message: 'A response did not come through…' }
    })
    renderAt('/')
    fireEvent.click(await screen.findByTestId('topbar-capture-session'))
    const popover = await screen.findByRole('dialog', { name: 'Capture Session' })
    expect(popover.textContent).toContain('The Capture Session ended.')
    expect(screen.queryByTestId('topbar-rec')).toBeNull()
  })
})
