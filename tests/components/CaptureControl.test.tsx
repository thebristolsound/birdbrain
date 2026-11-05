// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  Case,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary,
  LaunchedBrowserTab
} from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

import { CaptureSessionPanel } from '@renderer/components/launchedBrowser/CaptureSessionPanel'
import { TabPicker } from '@renderer/components/launchedBrowser/TabPicker'

// The panel's Capture control, its tab flags, and the tab picker (#1832).

const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}

const NOTICES: LaunchedBrowserTab = {
  targetId: 't1',
  title: 'Harbor notices',
  url: 'https://ferrylog.example/notices',
  firstRequest: true
}
const TIMETABLE: LaunchedBrowserTab = {
  targetId: 't2',
  title: 'Port timetable',
  url: 'https://ferrylog.example/files/port.pdf',
  firstRequest: false
}

function summary(overrides: Partial<LaunchedBrowserSummary> = {}): LaunchedBrowserSummary {
  return {
    family: 'chrome',
    label: 'Google Chrome',
    caseId: 'case-1',
    version: '149.0.7827.55',
    extensionWarnings: [],
    sessionStartedAt: null,
    tabs: [NOTICES],
    shortcut: { accelerator: 'CommandOrControl+Shift+F9', state: 'unknown' },
    ...overrides
  }
}

function mount(browser: LaunchedBrowserSummary, { picker = false } = {}) {
  const status: LaunchedBrowserStatus = { state: 'open', browser }
  const capture = vi.fn(async () => status)
  let pickTab: () => void = () => {}
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: {
      get: vi.fn(async () => ({ operatorName: 'A. Marsh', egress: { kind: 'direct' } }))
    },
    launchedBrowser: {
      status: vi.fn(async () => status),
      popOutState: vi.fn(async () => false),
      capture
    },
    onLaunchedBrowserPickTab: vi.fn((open: () => void) => {
      pickTab = open
      return () => {}
    })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureSessionPanel form="rail" />
      {picker && <TabPicker inPopOut={false} />}
    </QueryClientProvider>
  )
  return { capture, pickTab: () => act(() => pickTab()) }
}

beforeEach(() => {
  useAppStore.setState({
    captureTargetId: null,
    scrollToLoadNext: false,
    tabPickerOpen: false,
    dismissedLaunchNotice: null
  })
})

afterEach(() => cleanup())

describe('the Capture control', () => {
  it('names the tab it will take before the click, and takes it with Scroll-to-load off', async () => {
    const { capture } = mount(summary())
    expect(useAppStore.getInitialState().scrollToLoadNext).toBe(false)
    expect(await screen.findByText('Capture will take')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Capture Harbor notices' })
    fireEvent.click(button)
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t1', { scrollToLoad: false }))
  })

  it('passes the Operator’s Scroll-to-load choice for that Capture only', async () => {
    const { capture } = mount(summary())
    const box = (await screen.findByRole('checkbox', {
      name: 'Scroll to load'
    })) as HTMLInputElement
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Capture Harbor notices' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t1', { scrollToLoad: true }))
    await waitFor(() => expect(box.checked).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Capture Harbor notices' }))
    await waitFor(() => expect(capture).toHaveBeenLastCalledWith('t1', { scrollToLoad: false }))
  })

  it('takes no tab while two could be taken and none is picked, until a row is picked', async () => {
    const second = { ...NOTICES, targetId: 't3', title: 'Tuesday sailings' }
    const { capture } = mount(summary({ tabs: [NOTICES, second] }))
    expect(await screen.findByText('Pick a tab below, or choose one.')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Capture' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Tuesday sailings/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Capture Tuesday sailings' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t3', { scrollToLoad: false }))
  })

  it('shows the progress, then the Exhibit Number', async () => {
    mount(
      summary({
        capture: { state: 'capturing', targetId: 't1', title: 'https://ferrylog.example/' }
      })
    )
    expect(await screen.findByText('Capturing Harbor notices…')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Capture Harbor notices' }) as HTMLButtonElement).disabled
    ).toBe(true)
    cleanup()
    mount(
      summary({ capture: { state: 'captured', targetId: 't1', captureId: 'c', citation: 'NK-12' } })
    )
    expect(await screen.findByText('NK-12 · Captured')).toBeTruthy()
  })

  it('says an abandoned Capture stored nothing', async () => {
    mount(summary({ capture: { state: 'abandoned', targetId: 't1' } }))
    expect(await screen.findByText('Capture abandoned')).toBeTruthy()
    expect(screen.getByText('The page changed mid-capture; try again.')).toBeTruthy()
  })

  it('offers the shortcut to try and never says it works', async () => {
    mount(summary())
    expect(
      await screen.findByText(/Try the shortcut while the browser has focus, or use the Capture/)
    ).toBeTruthy()
    cleanup()
    mount(summary({ shortcut: { accelerator: 'CommandOrControl+Shift+F9', state: 'failed' } }))
    expect(await screen.findByText(/This desktop refused the shortcut/)).toBeTruthy()
  })

  it('offers no Capture where the platform has none, and says why', async () => {
    mount(summary({ captureUnavailable: 'Not on macOS yet.', shortcut: undefined }))
    expect(await screen.findByText('Not on macOS yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Capture/ })).toBeNull()
  })
})

describe('the tab rows', () => {
  it('flags each tab and says why one cannot be captured', async () => {
    mount(
      summary({
        tabs: [
          NOTICES,
          TIMETABLE,
          {
            targetId: 'p',
            title: 'Sign in',
            url: 'https://ferrylog.example/',
            firstRequest: true,
            refusal: 'private'
          },
          {
            targetId: 's',
            title: 'Settings',
            url: 'chrome://settings',
            firstRequest: false,
            refusal: 'not-http'
          },
          {
            targetId: 'c',
            title: 'Route map',
            url: 'https://ferrylog.example/map',
            firstRequest: true,
            refusal: 'crashed'
          }
        ]
      })
    )
    const list = await screen.findByRole('list', { name: 'Tabs' })
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[0]).getByText('from first request')).toBeTruthy()
    expect(within(rows[1]).getByText('not from first request')).toBeTruthy()
    expect(within(rows[2]).getByText("can't capture · private")).toBeTruthy()
    expect(within(rows[3]).getByText('never captured')).toBeTruthy()
    expect(within(rows[4]).getByText('tab crashed')).toBeTruthy()
    expect(within(rows[4]).getByText('Reload it in the browser, then capture.')).toBeTruthy()
    // Only the two recorded http tabs can be picked.
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([
      expect.stringContaining('Harbor notices'),
      expect.stringContaining('Port timetable')
    ])
  })
})

describe('the tab picker', () => {
  it('opens on the shortcut’s request, numbers the tabs it could take, and captures only the pick', async () => {
    const { capture, pickTab } = mount(summary({ tabs: [NOTICES, TIMETABLE] }), { picker: true })
    await screen.findByText('Capture will take')
    pickTab()
    const dialog = await screen.findByRole('dialog')
    const rows = within(dialog).getAllByRole('button', { name: /^\d · / })
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^1 · Harbor notices/),
      expect.stringMatching(/^2 · Port timetable/)
    ])
    expect(capture).not.toHaveBeenCalled()
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Enter' })
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t2', { scrollToLoad: false }))
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('takes the Scroll-to-load choice for the picked Capture, then turns it off', async () => {
    const { capture, pickTab } = mount(summary({ tabs: [NOTICES, TIMETABLE] }), { picker: true })
    await screen.findByText('Capture will take')
    act(() => useAppStore.setState({ scrollToLoadNext: true }))
    pickTab()
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Enter' })
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t1', { scrollToLoad: true }))
    await waitFor(() => expect(useAppStore.getState().scrollToLoadNext).toBe(false))
  })

  it('captures nothing when the Operator cancels', async () => {
    const { capture, pickTab } = mount(summary({ tabs: [NOTICES, TIMETABLE] }), { picker: true })
    await screen.findByText('Capture will take')
    pickTab()
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(capture).not.toHaveBeenCalled()
  })
})
