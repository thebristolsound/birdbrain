// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ArchiveExportResult, ArchiveProgressEvent } from '@shared/ipc'
import type { ArchiveInspectReport, Case, SharingMembers, SyncState } from '@shared/types'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: notifyError }
}))

// The import dialog is on the evidence path and has tests of its own. Here it only has to open
// with the report the menu's item fetched.
vi.mock('@renderer/components/dashboard/cases/ImportCaseDialog', () => ({
  ImportCaseDialog: ({
    report,
    onClose
  }: {
    report: ArchiveInspectReport
    onClose: () => void
  }) => (
    <div role="dialog" aria-label="Import Case Archive">
      {report.caseName}
      {/* Stands in for the dialog's own state, such as its tamper override. */}
      <input type="checkbox" aria-label="Override" />
      <button onClick={onClose}>Close import</button>
    </div>
  )
}))

import { CaseMenu } from '@renderer/components/dashboard/CaseMenu'
import { useCaseExports } from '@renderer/components/export/useCaseExport'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { AR, JO, members, sync } from './sharingFixtures'
import { isDisabledItem, nextTurn, press } from './menuKeys'

const CASE: Case = {
  id: 'case-1',
  name: 'Harbour ledger review',
  description: '',
  isDemo: false,
  archived: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z'
}

// A Case nobody has shared lists no members, and a Case with only its Owner has no peer.
const LOCAL = members({ members: [], invites: [], pendingJoins: [] })
const NO_PEERS = sync({ peersTotal: 0, peersReachable: 0, peers: [] })
const NEVER = new Promise<never>(() => {})
const ARCHIVE_PATH = '/home/tester/Harbour.bbcase'

interface Reads {
  available?: boolean
  roster?: SharingMembers | Promise<SharingMembers>
  syncState?: SyncState | Promise<SyncState>
  caseData?: Case | undefined
  counts?: Record<string, number>
}

let exportArchive: ReturnType<typeof vi.fn>
let inspectArchive: ReturnType<typeof vi.fn>
let showItemInFolder: ReturnType<typeof vi.fn>
// Every listener the app has for archive progress, minus those it has stopped. A step reaches
// only these, as it would in the app.
const progressListeners = new Set<(event: ArchiveProgressEvent) => void>()
function sendProgress(event: ArchiveProgressEvent) {
  act(() => progressListeners.forEach((listener) => listener(event)))
}

function setup(reads: Reads = {}) {
  const { available = true, roster = LOCAL, syncState = NO_PEERS, counts = { 'case-1': 3 } } = reads
  // An explicit undefined is the Case that has not loaded, so it must not fall back to CASE.
  const caseData = 'caseData' in reads ? reads.caseData : CASE
  const getSyncState = vi.fn(async () => syncState)
  const getCase = vi.fn<(id: string) => Promise<null>>(async () => null)
  fakeBridge({
    sharing: {
      isAvailable: vi.fn(async () => available),
      getMembers: vi.fn(async () => roster),
      getSyncState
    },
    captures: { countsByCase: vi.fn(async () => counts) },
    cases: { exportArchive, inspectArchive, get: getCase },
    export: { preflight: vi.fn(async () => null) },
    wayback: { listForCase: vi.fn(async () => []) },
    shell: { showItemInFolder },
    onArchiveProgress: vi.fn((cb: (event: ArchiveProgressEvent) => void) => {
      progressListeners.add(cb)
      return () => progressListeners.delete(cb)
    })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <CaseMenu place="name" caseId="case-1" caseData={caseData} />
    </QueryClientProvider>
  )
  return { client, getSyncState, getCase, ...view }
}

function trigger(): HTMLElement {
  return screen.getByTestId('topbar-case-name')
}

function openMenu(): HTMLElement {
  fireEvent.click(trigger())
  return screen.getByRole('menu')
}

// The menu, opened if it is not open already.
function theMenu(): HTMLElement {
  return screen.queryByRole('menu') ?? openMenu()
}

beforeEach(() => {
  navigate.mockClear()
  notifySuccess.mockReset()
  notifyError.mockReset()
  progressListeners.clear()
  exportArchive = vi.fn(async () => ({ canceled: false, filePath: ARCHIVE_PATH }))
  inspectArchive = vi.fn(async () => null)
  showItemInFolder = vi.fn(async () => undefined)
  useAppStore.setState({ commandPaletteOpen: false, shareMarkOpen: false })
  // Running exports and their failures outlive the menu, so each test starts with none.
  useCaseExports.setState({ pending: {}, failed: {} })
})

afterEach(cleanup)

describe('the Case menu on the Case name', () => {
  it('holds Switch Case, sharing, the two exports, Import and Case settings, in that order', async () => {
    setup()
    const menu = openMenu()
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.dataset.testid)
    ).toEqual([
      'case-menu-switch',
      'case-menu-sharing',
      'case-menu-export-report',
      'case-menu-export-archive',
      'case-menu-import',
      'case-menu-settings'
    ])
    expect(within(menu).getAllByRole('separator')).toHaveLength(2)
    expect(trigger().dataset.tour).toBe('caseswitcher')
    expect(trigger().getAttribute('title')).toBe('Harbour ledger review · Case menu')
  })

  it('says how many Captures the Case holds and that it is on this machine only', async () => {
    setup()
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe(
        '3 Captures · On this machine only'
      )
    )
    // The label is hidden from assistive technology, so the menu's name carries its words.
    expect(menu.getAttribute('aria-label')).toBe(
      'Harbour ledger review: 3 Captures · On this machine only'
    )
  })

  it('counts one Capture in the singular', async () => {
    setup({ counts: { 'case-1': 1 } })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toMatch(/^1 Capture · /)
    )
  })

  // A Case that was shared and has nobody connected is not local: a Member who left can still
  // hold a copy.
  it('does not call a shared Case local once nobody else is connected', async () => {
    const { client } = setup({ caseData: { ...CASE, sharedAt: '2026-09-02T00:00:00Z' } })
    const menu = openMenu()
    // The line depends on the roster, so the roster has to be in before the line is read.
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingMembers('case-1'))?.status).toBe('success')
    )
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe('3 Captures')
    )
  })

  // The visible name hides on a narrow window, and the button must still say which Case it is.
  it('keeps the Case name in the button for assistive technology when the name hides', () => {
    setup()
    const copies = within(trigger()).getAllByText('Harbour ledger review')
    expect(copies).toHaveLength(2)
    expect(copies.map((el) => el.className).filter((c) => c.includes('sr-only'))).toEqual([
      'sr-only min-[1000px]:hidden'
    ])
  })

  it('opens the command palette from Switch Case, which names the shortcut', async () => {
    setup()
    const item = within(openMenu()).getByTestId('case-menu-switch')
    expect(item.textContent).toBe('Switch Case…Ctrl+K')
    fireEvent.click(item)
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it.each(['case-menu-sharing', 'case-menu-settings'])('opens Case settings from %s', (testId) => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId(testId))
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/settings',
      params: { caseId: 'case-1' }
    })
  })

  it('opens from the keyboard on Switch Case and walks to Case settings with End', async () => {
    setup()
    trigger().focus()
    await press('Enter')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('case-menu-switch')))
    await press('End', screen.getByTestId('case-menu-settings'))
    await press('Escape')
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger()))
  })
})

describe('sharing in the Case menu', () => {
  it('offers Share this Case… on a Case nobody has shared, without polling its sync state', async () => {
    const { getSyncState } = setup()
    const item = within(openMenu()).getByTestId('case-menu-sharing')
    expect(item.textContent).toBe('Share this Case…')
    await waitFor(() =>
      expect(item.getAttribute('title')).toBe(
        'Early access. Share this Case with teammates. Opens Members.'
      )
    )
    expect(getSyncState).not.toHaveBeenCalled()
    expect(screen.queryByTestId('case-sync-state')).toBeNull()
  })

  it('reads Members once the Case is shared', () => {
    setup({ caseData: { ...CASE, sharedAt: '2026-09-19T14:00:00.000Z' }, roster: members() })
    expect(within(openMenu()).getByTestId('case-menu-sharing').textContent).toBe('Members')
  })

  it('says an invite is waiting, with its expiry in the item title', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
    setup({ roster: members({ members: [AR], invites: [{ inviteId: 'inv-1', expiresAt }] }) })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe(
        '3 Captures · invite waiting'
      )
    )
    expect(within(menu).getByTestId('case-menu-sharing').getAttribute('title')).toMatch(
      /^Early access\. Invite expires (today|tomorrow) \d\d:\d\d$/
    )
  })

  it('counts the join requests waiting for approval', async () => {
    setup({ roster: members({ members: [AR], pendingJoins: [JO] }) })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe(
        '3 Captures · 1 to approve'
      )
    )
  })

  it('says where sharing is not available', async () => {
    setup({ available: false })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe(
        '3 Captures · Sharing is not available on this Mac'
      )
    )
  })

  it('says nothing about sharing until the roster has loaded', async () => {
    const { client } = setup({ roster: NEVER })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingAvailable)?.status).toBe('success')
    )
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe('3 Captures')
    )
    expect(within(menu).getByTestId('case-menu-sharing').getAttribute('title')).toBe('Early access')
  })

  it('wears a ring while the Share mark shows', () => {
    useAppStore.setState({ shareMarkOpen: true })
    setup()
    expect(trigger().dataset.marked).toBe('true')
    expect(trigger().className).toContain('ring-[3px]')
  })
})

describe('the sync state beside the Case name', () => {
  it('shows nothing while the Case is in sync, and says so in the menu', async () => {
    setup({ roster: members(), syncState: sync() })
    const menu = openMenu()
    await waitFor(() =>
      expect(within(menu).getByTestId('case-menu-about').textContent).toBe(
        '3 Captures · Synced · 1 of 3 peers'
      )
    )
    expect(screen.queryByTestId('case-sync-state')).toBeNull()
  })

  it('never calls a shared Case local on its way to Synced', async () => {
    const { client } = setup({ roster: members(), syncState: NEVER })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingMembers('case-1'))?.status).toBe('success')
    )
    expect(within(openMenu()).getByTestId('case-menu-about').textContent).toBe('3 Captures')
  })

  it('shows Syncing with a spinner while a sync runs', async () => {
    setup({ roster: members(), syncState: sync({ phase: 'syncing' }) })
    const state = await screen.findByTestId('case-sync-state')
    expect(state.dataset.chrome).toBe('active')
    expect(state.textContent).toBe('Syncing')
    expect(state.querySelector('.animate-spin')).not.toBeNull()
  })

  // A sync that has stopped is something the Operator must see without opening a menu.
  it('shows a stopped sync in the danger colour with an icon, with the menu closed', async () => {
    setup({
      roster: members(),
      syncState: sync({
        phase: 'error',
        lastError: { kind: 'newer-version', at: '2026-01-01T00:00:00Z' }
      })
    })
    const state = await screen.findByTestId('case-sync-state')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(state.dataset.chrome).toBe('error')
    expect(state.textContent).toBe('Sync paused')
    expect(state.className).toContain('text-danger-fg')
    expect(state.querySelector('svg')).not.toBeNull()
    expect(state.getAttribute('title')).toBe('Sync paused · newer version')
    // The words fold away below xl, where the name's track is narrow; the icon never does.
    expect(within(state).getByText('Sync paused').className).toBe('sr-only xl:not-sr-only')
    expect(state.querySelector('svg')!.getAttribute('class')).not.toMatch(/hidden|sr-only/)
    // It sits inside the Case name's button, beside the name.
    expect(trigger().contains(state)).toBe(true)
  })

  it('names a failed sync by its kind in the title', async () => {
    setup({
      roster: members(),
      syncState: sync({ phase: 'error', lastError: { kind: 'relay', at: '2026-01-01T00:00:00Z' } })
    })
    const state = await screen.findByTestId('case-sync-state')
    expect(state.textContent).toBe('Sync failed')
    expect(state.getAttribute('title')).toBe('Sync failed · relay')
  })

  it('keeps the network notice beside the name while the Egress is not Direct', async () => {
    setup({ roster: members(), syncState: sync({ egress: 'tor' }) })
    const notice = await screen.findByLabelText(
      'Network addresses visible to teammates and the relay'
    )
    expect(screen.getByRole('tooltip').textContent).toContain('including a system VPN’s own')
    // It is a control of its own, not part of the button that opens the menu.
    expect(trigger().contains(notice)).toBe(false)
    // Outside a button, it has to leave the bar's window drag region itself.
    expect(notice.className).toContain('[app-region:no-drag]')
    // Focus reads the explanation, not only the short label.
    const tip = screen.getByRole('tooltip')
    expect(tip.id).not.toBe('')
    expect(notice.getAttribute('aria-describedby')).toBe(tip.id)
  })

  it('shows no network notice on a Direct Egress', async () => {
    setup({ roster: members(), syncState: sync({ phase: 'syncing' }) })
    await screen.findByTestId('case-sync-state')
    expect(screen.queryByTestId('case-network-notice')).toBeNull()
  })
})

// A dialog opened from the menu renders at the end of the document, not beside the Case name,
// where the top bar's search would paint over it.
function expectOutsideTheBar(dialog: HTMLElement) {
  let top = dialog
  while (top.parentElement && top.parentElement !== document.body) top = top.parentElement
  expect(top.contains(trigger())).toBe(false)
}

describe('exporting from the Case menu', () => {
  it('opens the export dialog from Export evidence report, and hands focus back on close', async () => {
    setup()
    const item = within(openMenu()).getByTestId('case-menu-export-report')
    item.focus()

    fireEvent.click(item)
    const dialog = screen.getByRole('dialog', { name: 'Export case' })
    expectOutsideTheBar(dialog)
    expect(dialog.contains(document.activeElement)).toBe(true)
    // The closing menu takes no focus back a turn later: the dialog keeps it.
    await nextTurn()
    await nextTurn()
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })
    // The dialog leaves through its exit animation.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(trigger())
  })

  it('reports a saved Case Archive as a toast with the path and a reveal action', async () => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledOnce())
    const [title, opts] = notifySuccess.mock.calls[0]
    expect(title).toBe('Archive saved')
    expect(opts.description).toBe(ARCHIVE_PATH)
    expect(screen.queryByRole('alert')).toBeNull()

    opts.action.onClick()
    await waitFor(() => expect(showItemInFolder).toHaveBeenCalledWith(ARCHIVE_PATH))
  })

  it('raises no toast when the save dialog is cancelled', async () => {
    exportArchive.mockResolvedValue({ canceled: true } satisfies ArchiveExportResult)
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await waitFor(() => expect(exportArchive).toHaveBeenCalledWith('case-1'))
    await nextTurn()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('shows the running step beside the name, and holds both exports until it ends', async () => {
    let finish!: (result: ArchiveExportResult) => void
    exportArchive.mockReturnValue(new Promise<ArchiveExportResult>((resolve) => (finish = resolve)))
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    const progress = await screen.findByTestId('case-export-progress')
    expect(progress.textContent).toBe('Preparing archive… — 0%')
    expect(trigger().contains(progress)).toBe(true)
    // The step stays on one line, cut short, so a long one cannot wrap out of the button (#2159).
    expect(progress.querySelector('span')?.className).toContain('xl:max-w-44 xl:truncate')

    sendProgress({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })
    expect(progress.textContent).toBe('Bundling captures... — 55%')
    expect(progress.getAttribute('title')).toBe('Bundling captures... — 55%')
    sendProgress({ caseId: 'other-case', step: 'Should not show', percent: 99 })
    expect(screen.queryByText(/Should not show/)).toBeNull()
    // Another Case's steps leave no record behind, which would hold that Case's items for good.
    expect(Object.keys(useCaseExports.getState().pending)).toEqual(['case-1'])

    const menu = openMenu()
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-report'))).toBe(true)
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-archive'))).toBe(true)
    fireEvent.click(within(menu).getByTestId('case-menu-export-archive'))
    expect(exportArchive).toHaveBeenCalledOnce()

    await act(async () => finish({ canceled: false, filePath: ARCHIVE_PATH }))
    await waitFor(() => expect(screen.queryByTestId('case-export-progress')).toBeNull())
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-archive'))).toBe(false)
    // The export stops listening once it has settled.
    expect(progressListeners.size).toBe(0)
  })

  it('keeps a failed export on screen until the Operator dismisses it', async () => {
    exportArchive.mockRejectedValue(new Error('disk full'))
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('disk full')
    expect(notifySuccess).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a failure on its own Case only, until it is dismissed there', async () => {
    exportArchive.mockRejectedValue(new Error('disk full'))
    const { rerender, client } = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByRole('alert')
    const show = (id: string) =>
      rerender(
        <QueryClientProvider client={client}>
          <CaseMenu place="name" caseId={id} caseData={{ ...CASE, id }} />
        </QueryClientProvider>
      )
    show('case-2')
    expect(screen.queryByRole('alert')).toBeNull()
    show('case-1')
    expect(screen.getByRole('alert').textContent).toContain('disk full')
  })

  // The menu leaves the screen on the dashboard and in Settings. The export it started does
  // not: coming back finds it running, with its items held, so a second cannot start beside it.
  it('finds a running export again after the menu has left the screen', async () => {
    let finish!: (result: ArchiveExportResult) => void
    exportArchive.mockReturnValue(new Promise<ArchiveExportResult>((resolve) => (finish = resolve)))
    const first = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    first.unmount()
    // The export keeps listening while the menu is away, so the step shown on return is current.
    // A listener that belonged to the menu would have stopped with it.
    expect(progressListeners.size).toBe(1)
    sendProgress({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })

    setup()
    expect(screen.getByTestId('case-export-progress').textContent).toBe(
      'Bundling captures... — 55%'
    )
    const menu = openMenu()
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-report'))).toBe(true)
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-archive'))).toBe(true)
    fireEvent.click(within(menu).getByTestId('case-menu-export-archive'))
    expect(exportArchive).toHaveBeenCalledOnce()

    await act(async () => finish({ canceled: false, filePath: ARCHIVE_PATH }))
    await waitFor(() => expect(screen.queryByTestId('case-export-progress')).toBeNull())
  })

  it('shows a failure that happened while the menu was off screen', async () => {
    let fail!: (reason: Error) => void
    exportArchive.mockReturnValue(new Promise<ArchiveExportResult>((_, reject) => (fail = reject)))
    const first = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    first.unmount()
    await act(async () => fail(new Error('disk full')))

    setup()
    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
    expect(screen.queryByTestId('case-export-progress')).toBeNull()
  })

  it('ends an export that finishes while another Case is on screen', async () => {
    let finish!: (result: ArchiveExportResult) => void
    exportArchive.mockReturnValue(new Promise<ArchiveExportResult>((resolve) => (finish = resolve)))
    const { rerender, client } = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    const show = (id: string) =>
      rerender(
        <QueryClientProvider client={client}>
          <CaseMenu place="name" caseId={id} caseData={{ ...CASE, id }} />
        </QueryClientProvider>
      )
    show('case-2')
    sendProgress({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })
    expect(screen.queryByTestId('case-export-progress')).toBeNull()
    await act(async () => finish({ canceled: false, filePath: ARCHIVE_PATH }))

    show('case-1')
    expect(screen.queryByTestId('case-export-progress')).toBeNull()
    expect(isDisabledItem(within(theMenu()).getByTestId('case-menu-export-archive'))).toBe(false)
  })

  // The button has room for one state. A running sync gives way to the export's step.
  it('shows the export step in place of a running sync', async () => {
    exportArchive.mockReturnValue(NEVER)
    setup({ roster: members(), syncState: sync({ phase: 'syncing' }) })
    await screen.findByTestId('case-sync-state')
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    expect(screen.queryByTestId('case-sync-state')).toBeNull()
  })

  // A running export belongs to its Case. Another Case shows none of it, and coming back
  // finds it still running, with its item held, so a second export cannot start beside it.
  it('keeps a running export with its Case across a switch of Case', async () => {
    let finish!: (result: ArchiveExportResult) => void
    exportArchive.mockReturnValue(new Promise<ArchiveExportResult>((resolve) => (finish = resolve)))
    const { rerender, client } = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    const show = (id: string) =>
      rerender(
        <QueryClientProvider client={client}>
          <CaseMenu place="name" caseId={id} caseData={{ ...CASE, id }} />
        </QueryClientProvider>
      )

    show('case-2')
    expect(screen.queryByTestId('case-export-progress')).toBeNull()
    expect(isDisabledItem(within(theMenu()).getByTestId('case-menu-export-archive'))).toBe(false)

    show('case-1')
    expect(screen.getByTestId('case-export-progress')).toBeTruthy()
    expect(isDisabledItem(within(theMenu()).getByTestId('case-menu-export-archive'))).toBe(true)
    fireEvent.click(within(theMenu()).getByTestId('case-menu-export-archive'))
    expect(exportArchive).toHaveBeenCalledOnce()

    await act(async () => finish({ canceled: false, filePath: ARCHIVE_PATH }))
    await waitFor(() => expect(screen.queryByTestId('case-export-progress')).toBeNull())
  })

  it('keeps a stopped sync in view while an export runs', async () => {
    exportArchive.mockReturnValue(NEVER)
    setup({
      roster: members(),
      syncState: sync({ phase: 'error', lastError: { kind: 'relay', at: '2026-01-01T00:00:00Z' } })
    })
    await screen.findByTestId('case-sync-state')
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    await screen.findByTestId('case-export-progress')
    expect(screen.getByTestId('case-sync-state').dataset.chrome).toBe('error')
  })

  it('shows one failure at a time and dismisses only the one shown', async () => {
    exportArchive.mockRejectedValue(new Error('disk full'))
    inspectArchive.mockRejectedValue(new Error('not an archive'))
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-archive'))
    expect((await screen.findByRole('alert')).textContent).toContain('disk full')
    fireEvent.click(within(theMenu()).getByTestId('case-menu-import'))
    await waitFor(() => expect(inspectArchive).toHaveBeenCalledOnce())
    await nextTurn()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect((await screen.findByRole('alert')).textContent).toContain('not an archive')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // The palette can change the Case on screen while the dialog is up. The dialog reads the Case
  // it exports, so its reads show which Case that is.
  it('keeps the export dialog on the Case it was opened for', async () => {
    const { rerender, client, getCase } = setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-export-report'))
    await waitFor(() => expect(getCase).toHaveBeenCalledWith('case-1'))
    rerender(
      <QueryClientProvider client={client}>
        <CaseMenu place="name" caseId="case-2" caseData={{ ...CASE, id: 'case-2' }} />
      </QueryClientProvider>
    )
    expect(screen.getByRole('dialog', { name: 'Export case' })).toBeTruthy()
    await nextTurn()
    await nextTurn()
    expect(getCase.mock.calls.map(([id]) => id)).toEqual(['case-1'])
  })

  it('holds both exports while the Case has not loaded', () => {
    setup({ caseData: undefined })
    const menu = openMenu()
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-report'))).toBe(true)
    expect(isDisabledItem(within(menu).getByTestId('case-menu-export-archive'))).toBe(true)
    expect(isDisabledItem(within(menu).getByTestId('case-menu-import'))).toBe(false)
  })
})

describe('importing from the Case menu', () => {
  it('inspects the chosen archive and opens the import dialog with its report', async () => {
    inspectArchive.mockResolvedValue({ caseName: 'Ferry Line' } as ArchiveInspectReport)
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-import'))
    const dialog = await screen.findByRole('dialog', { name: 'Import Case Archive' })
    expectOutsideTheBar(dialog)
    expect(dialog.textContent).toContain('Ferry Line')
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens one file picker at a time', async () => {
    inspectArchive.mockReturnValue(NEVER)
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-import'))
    fireEvent.click(within(theMenu()).getByTestId('case-menu-import'))
    await nextTurn()
    expect(inspectArchive).toHaveBeenCalledOnce()
  })

  // The dialog's own state, its tamper override among it, belongs to one archive.
  it('starts a second archive with a fresh dialog', async () => {
    inspectArchive
      .mockResolvedValueOnce({ caseName: 'Ferry Line', archivePath: '/a.bbcase' })
      .mockResolvedValueOnce({ caseName: 'Harbor Desk', archivePath: '/b.bbcase' })
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-import'))
    await screen.findByRole('dialog', { name: 'Import Case Archive' })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Override' }))
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Override' }).checked).toBe(true)

    fireEvent.click(within(theMenu()).getByTestId('case-menu-import'))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Import Case Archive' }).textContent).toContain(
        'Harbor Desk'
      )
    )
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Override' }).checked).toBe(false)
  })

  it('opens nothing when no archive is chosen', async () => {
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-import'))
    await waitFor(() => expect(inspectArchive).toHaveBeenCalledOnce())
    await nextTurn()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps an archive that could not be read on screen until dismissed', async () => {
    inspectArchive.mockRejectedValue(new Error('not a Case Archive'))
    setup()
    fireEvent.click(within(openMenu()).getByTestId('case-menu-import'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('not a Case Archive')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
