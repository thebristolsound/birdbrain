// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type {
  Case,
  EgressSetting,
  LaunchedBrowserStatus,
  LaunchedBrowserSummary
} from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import {
  CaptureSessionPanel,
  type PanelForm
} from '@renderer/components/launchedBrowser/CaptureSessionPanel'

const NOW = Date.UTC(2026, 10, 3, 14, 31, 0)
const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
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
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: NOW - 42_000,
  tabs: [
    { targetId: 't1', title: 'Tuesday sailings', url: 'https://ferry.test/routes/tue' },
    { targetId: 't2', title: '', url: 'about:blank' }
  ]
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: SUMMARY }

interface MountOptions {
  status?: LaunchedBrowserStatus
  form?: PanelForm
  showOpenCase?: boolean
  egress?: EgressSetting
  endSession?: () => Promise<LaunchedBrowserStatus>
}

function mount(options: MountOptions = {}) {
  const { status = OPEN, form = 'rail', showOpenCase = false, egress = PROXY } = options
  const endSession = vi.fn(options.endSession ?? (async () => ({ state: 'none' as const })))
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: { get: vi.fn(async () => ({ operatorName: 'A. Marsh', egress })) },
    launchedBrowser: { status: vi.fn(async () => status), endSession }
  })
  const onDone = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureSessionPanel form={form} showOpenCase={showOpenCase} onDone={onDone} />
    </QueryClientProvider>
  )
  return { client, endSession, onDone }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(NOW)
  navigate.mockClear()
  useAppStore.setState({
    sessionActive: true,
    stopConfirmOpen: false,
    startDialogCaseId: null,
    dismissedLaunchNotice: null
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the Capture Session panel while the browser is open', () => {
  it('names the browser, its Egress and its Case under a running clock', async () => {
    mount()
    expect(await screen.findByText('Launched Google Chrome')).toBeTruthy()
    expect(await screen.findByText('Proxy · Harbor relay')).toBeTruthy()
    expect(await screen.findByText('Into Ferry Line')).toBeTruthy()
    expect(screen.getByRole('timer').textContent).toBe('00:42')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(screen.getByRole('timer').textContent).toBe('00:43')
  })

  it('names a Direct Egress', async () => {
    mount({ egress: { kind: 'direct' } })
    expect(await screen.findByText('Direct')).toBeTruthy()
  })

  it('lists the tabs with title and URL, naming an untitled tab by its URL', async () => {
    mount()
    const list = await screen.findByRole('list', { name: 'Tabs' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      'Tuesday sailingshttps://ferry.test/routes/tue',
      'about:blankabout:blank'
    ])
    expect(screen.getByText('2 tabs')).toBeTruthy()
  })

  it('says no tabs are open when the browser reports none', async () => {
    mount({ status: { state: 'open', browser: { ...SUMMARY, tabs: [] } } })
    expect(await screen.findByText('No tabs open')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tabs' })).toBeNull()
  })

  it('warns of an extension, naming none, and says what the warning means', async () => {
    mount({
      status: {
        state: 'open',
        browser: { ...SUMMARY, extensionWarnings: ['abcdefghijklmnopabcdefghijklmnop'] }
      }
    })
    await screen.findByText('Proxy · Harbor relay')
    const card = screen.getByText('An extension was added.')
    expect(screen.getByText('It could change how traffic leaves this browser.')).toBeTruthy()
    const tip = within(card.parentElement as HTMLElement).getByRole('img')
    expect(tip.getAttribute('title')).toBe(
      'Shown only while the Egress is not Direct. With the Egress on Proxy · Harbor relay, an ' +
        'extension can replace the proxy setting, and Birdbrain cannot check what it does. The ' +
        'Capture Session continues; the warning refuses nothing. Remove it in the browser if you ' +
        'did not add it.'
    )
    expect(screen.queryByText(/abcdefghijklmnop/)).toBeNull()
  })

  it('shows no extension warning while none appeared', async () => {
    mount()
    await screen.findByText('Launched Google Chrome')
    expect(screen.queryByText(/extension/)).toBeNull()
  })

  it('opens the stop confirmation from Stop…, and lets its own form close first', async () => {
    const { onDone } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop…' }))
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().stopConfirmOpen).toBe(true)
  })

  it('holds Stop… while the browser closes, and says so', async () => {
    mount({ status: { state: 'closing', browser: SUMMARY } })
    expect(await screen.findByText('Closing Launched Google Chrome…')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Stop…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no clock before main has given the start of the Capture Session', async () => {
    mount({ status: { state: 'open', browser: { ...SUMMARY, sessionStartedAt: null } } })
    await screen.findByText('Launched Google Chrome')
    expect(screen.queryByRole('timer')).toBeNull()
  })
})

describe('the popover form', () => {
  it('counts the tabs instead of listing them', async () => {
    mount({ form: 'popover' })
    expect(await screen.findByText('2 tabs')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tabs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Ferry Line' })).toBeNull()
  })

  it('offers to open the Case where it is asked to', async () => {
    const { onDone } = mount({ form: 'popover', showOpenCase: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ferry Line' }))
    expect(navigate).toHaveBeenCalledWith({ to: '/cases/$caseId', params: { caseId: 'case-1' } })
    expect(onDone).toHaveBeenCalled()
  })
})

describe('state 10: the browser closed while its Capture Session runs', () => {
  const CLOSED: LaunchedBrowserStatus = { state: 'closed', browser: { ...SUMMARY, tabs: [] } }

  it('says the Capture Session keeps running', async () => {
    mount({ status: CLOSED })
    expect(await screen.findByText('Launched Google Chrome closed.')).toBeTruthy()
    expect(screen.getByText('The Capture Session keeps running until you stop it.')).toBeTruthy()
    expect(screen.getByRole('timer').textContent).toBe('00:42')
    expect(screen.queryByRole('button', { name: 'Stop…' })).toBeNull()
  })

  it('launches again from the start dialog for the same Case', async () => {
    const { onDone } = mount({ status: CLOSED })
    fireEvent.click(await screen.findByRole('button', { name: 'Launch again…' }))
    expect(useAppStore.getState().startDialogCaseId).toBe('case-1')
    expect(onDone).toHaveBeenCalled()
  })

  it('stops the Capture Session with no confirmation, since no browser is left to close', async () => {
    const { endSession } = mount({ status: CLOSED })
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Capture Session' }))
    await waitFor(() => expect(endSession).toHaveBeenCalledTimes(1))
    expect(useAppStore.getState().stopConfirmOpen).toBe(false)
  })

  it('says so when the Capture Session could not be stopped', async () => {
    mount({
      status: CLOSED,
      endSession: async () => {
        throw new Error('gone')
      }
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Stop Capture Session' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('The Capture Session could not be stopped.')
  })

  it('offers to open the Case in the popover where asked', async () => {
    mount({ status: CLOSED, form: 'popover', showOpenCase: true })
    expect(await screen.findByRole('button', { name: 'Open Ferry Line' })).toBeTruthy()
  })
})

describe('state 11 and the other notices', () => {
  it('names a bypass, with main’s account behind the "i", until it is dismissed', async () => {
    const notice = {
      code: 'EGRESS_BYPASS',
      message:
        'A response in Google Chrome did not come through the Egress proxy, so Birdbrain ended ' +
        'the Capture Session and closed the browser.'
    }
    mount({ status: { state: 'none', notice } })
    const status = await screen.findByRole('status')
    expect(within(status).getByText('Browser closed: traffic went around the proxy')).toBeTruthy()
    expect(within(status).getByText('The Capture Session ended.')).toBeTruthy()
    expect(within(status).getByRole('img').getAttribute('title')).toBe(notice.message)
    await waitFor(() => expect(screen.queryByText('Into Ferry Line')).toBeNull())
    fireEvent.click(within(status).getByRole('button', { name: 'Dismiss' }))
    expect(useAppStore.getState().dismissedLaunchNotice).toEqual(notice)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a browser that would not exit without an "i"', async () => {
    mount({
      status: {
        state: 'none',
        notice: {
          code: 'BROWSER_DID_NOT_EXIT',
          message: 'Google Chrome did not exit after Birdbrain killed it.'
        }
      }
    })
    const status = await screen.findByRole('status')
    expect(within(status).getByText('The launched browser may still be running')).toBeTruthy()
    expect(within(status).queryByRole('img')).toBeNull()
  })

  it('shows nothing with no browser and no notice', async () => {
    const { client } = mount({ status: { state: 'none' } })
    // setInterval is faked here, so waitFor would poll only on a DOM change, and there is none.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(client.getQueryState(['launchedBrowser', 'status'])?.status).toBe('success')
    expect(document.body.textContent).toBe('')
  })
})
