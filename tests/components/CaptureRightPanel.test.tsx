// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { Case, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import {
  panelView,
  type PanelView
} from '@renderer/components/launchedBrowser/captureSessionPanelModel'
import { fakeBridge } from '../renderer/fakeBridge'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ caseId: 'case-1' })
}))

import {
  CaptureRightPanel,
  CaptureRightStrip,
  type RightPanelTab
} from '@renderer/components/captures/CaptureRightPanel'

const FERRY: Case = {
  id: 'case-1',
  name: 'Ferry Line',
  isDemo: false,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-01T10:00:00.000Z',
  archived: false
}
const SUMMARY: LaunchedBrowserSummary = {
  family: 'chrome',
  label: 'Google Chrome',
  caseId: 'case-1',
  version: '149.0.7827.55',
  extensionWarnings: [],
  sessionStartedAt: Date.UTC(2026, 10, 3, 14, 30, 0),
  tabs: [
    {
      targetId: 't1',
      title: 'Tuesday sailings',
      url: 'https://ferry.test/routes/tue',
      firstRequest: true
    },
    {
      targetId: 't2',
      title: 'Harbor notices',
      url: 'https://ferry.test/notices',
      firstRequest: true
    }
  ]
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: SUMMARY }

type Shown = Exclude<PanelView, { kind: 'none' }>

function shown(status: LaunchedBrowserStatus): Shown | null {
  const view = panelView(status, null)
  return view.kind === 'none' ? null : view
}

interface MountOptions {
  status?: LaunchedBrowserStatus
  form?: 'rail' | 'overlay'
  tab?: RightPanelTab
  details?: boolean
  poppedOut?: boolean
}

function mount(options: MountOptions = {}) {
  const { status = OPEN, form = 'rail', tab = 'session', details = true } = options
  const popOut = vi.fn(async () => true)
  const showPopOut = vi.fn(async () => {})
  const dock = vi.fn(async () => {})
  const capture = vi.fn(async () => status)
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: {
      get: vi.fn(async () => ({ operatorName: 'A. Marsh', egress: { kind: 'direct' } }))
    },
    launchedBrowser: {
      status: vi.fn(async () => status),
      popOutState: vi.fn(async () => options.poppedOut ?? false),
      popOut,
      showPopOut,
      dock,
      capture
    }
  })
  const onCollapse = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // The route holds the tab; this stands in for it.
  function Host() {
    const [current, setCurrent] = useState<RightPanelTab>(tab)
    return (
      <CaptureRightPanel
        session={shown(status)}
        form={form}
        tab={current}
        onTabChange={setCurrent}
        onCollapse={onCollapse}
        details={details ? <textarea aria-label="Inline note" /> : null}
      />
    )
  }
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>
  )
  return { client, popOut, showPopOut, dock, capture, onCollapse }
}

const tab = (name: string) => screen.getByRole('tab', { name })

beforeEach(() => {
  useAppStore.setState({
    sessionActive: true,
    stopConfirmOpen: false,
    captureTargetId: null,
    dismissedLaunchNotice: null
  })
})

afterEach(() => {
  cleanup()
})

describe('the right panel with no Capture Session to show', () => {
  it('is the details alone, with no tab row', () => {
    mount({ status: { state: 'none' } })
    expect(screen.getByRole('textbox', { name: 'Inline note' })).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull()
  })
})

describe('the right panel with a Capture Session', () => {
  it('announces Details and Capture Session as two tabs of one tab list', async () => {
    mount()
    const list = screen.getByRole('tablist', { name: 'Right panel' })
    expect(within(list).getAllByRole('tab')).toHaveLength(2)
    expect(tab('Details').getAttribute('aria-selected')).toBe('false')
    expect(tab('Capture Session').getAttribute('aria-selected')).toBe('true')
    // Each tab names the panel it shows, and the panel names its tab.
    const panel = await screen.findByRole('tabpanel', { name: 'Capture Session' })
    expect(tab('Capture Session').getAttribute('aria-controls')).toBe(panel.id)
  })

  it('reaches both tabs from the keyboard: one tab stop, and the arrows move between them', async () => {
    mount()
    await screen.findByRole('list', { name: 'Tabs' })
    // The tab list is one tab stop, and focus that reaches it goes to the selected tab.
    const list = screen.getByRole('tablist', { name: 'Right panel' })
    expect(list.tabIndex).toBe(0)
    expect(tab('Details').tabIndex).toBe(-1)
    act(() => list.focus())
    expect(document.activeElement).toBe(tab('Capture Session'))

    fireEvent.keyDown(tab('Capture Session'), { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Details')))
    expect(tab('Details').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'Details' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Tabs' })).toBeNull()

    fireEvent.keyDown(tab('Details'), { key: 'ArrowRight' })
    await waitFor(() => expect(document.activeElement).toBe(tab('Capture Session')))
    expect(tab('Capture Session').getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByRole('list', { name: 'Tabs' })).toBeTruthy()
  })

  it('keeps a red dot on the Capture Session tab while recording, and none otherwise', () => {
    mount()
    const dot = within(tab('Capture Session')).getByTestId('session-tab-rec')
    expect(dot.className).toContain('bg-danger-fg')
    expect(within(tab('Details')).queryByTestId('session-tab-rec')).toBeNull()

    act(() => useAppStore.setState({ sessionActive: false }))
    expect(screen.queryByTestId('session-tab-rec')).toBeNull()
  })

  it('keeps the dot while the Details tab shows', () => {
    mount({ tab: 'details' })
    expect(tab('Details').getAttribute('aria-selected')).toBe('true')
    expect(within(tab('Capture Session')).getByTestId('session-tab-rec')).toBeTruthy()
  })

  it('shows the browser, its version, the Egress and the Case, with Stop… and the tab list', async () => {
    mount()
    const panel = await screen.findByRole('tabpanel', { name: 'Capture Session' })
    expect(await within(panel).findByText('Direct · Into this Case')).toBeTruthy()
    const version = within(panel).getByText('149.0.7827.55')
    expect(version.previousElementSibling?.textContent).toBe('Launched Google Chrome')
    expect(within(panel).getByRole('list', { name: 'Tabs' })).toBeTruthy()
    // The tab names the panel, so its body does not say "Capture Session" again.
    expect(within(panel).queryByText('Capture Session')).toBeNull()
    expect(within(panel).queryByRole('timer')).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: 'Stop…' }))
    expect(useAppStore.getState().stopConfirmOpen).toBe(true)
  })

  it('takes a Capture of the chosen tab from the session tab, as the rail does', async () => {
    const { capture } = mount()
    const panel = await screen.findByRole('tabpanel', { name: 'Capture Session' })
    const tabs = await within(panel).findByRole('list', { name: 'Tabs' })
    fireEvent.click(within(tabs).getByRole('button', { name: /Harbor notices/ }))
    expect(useAppStore.getState().captureTargetId).toBe('t2')
    fireEvent.click(within(panel).getByRole('button', { name: 'Capture Harbor notices' }))
    await waitFor(() => expect(capture).toHaveBeenCalledWith('t2', { scrollToLoad: false }))
  })

  it('keeps the details mounted behind the Capture Session tab, hidden', async () => {
    mount({ tab: 'details' })
    const note = screen.getByRole('textbox', { name: 'Inline note' }) as HTMLTextAreaElement
    fireEvent.change(note, { target: { value: 'half a sentence' } })

    fireEvent.mouseDown(tab('Capture Session'))
    expect(tab('Capture Session').getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('textbox', { name: 'Inline note' })).toBeNull()
    expect(note.isConnected).toBe(true)
    expect(note.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(true)

    fireEvent.mouseDown(tab('Details'))
    expect(screen.getByRole('textbox', { name: 'Inline note' })).toBe(note)
    expect(note.value).toBe('half a sentence')
    expect(note.closest('[role="tabpanel"]')?.hasAttribute('hidden')).toBe(false)
  })

  it('says to select a Capture on the Details tab with none selected', () => {
    mount({ tab: 'details', details: false })
    const panel = screen.getByRole('tabpanel', { name: 'Details' })
    expect(within(panel).getByText('Select a Capture to see its details.')).toBeTruthy()
  })

  it('shows a notice on the Capture Session tab, with no Pop out', async () => {
    const notice = { code: 'EGRESS_CHANGED', message: 'It changed.' }
    mount({ status: { state: 'none', notice } })
    const panel = await screen.findByRole('tabpanel', { name: 'Capture Session' })
    expect(await within(panel).findByRole('status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull()
  })
})

describe('Pop out and Dock from the tab', () => {
  it('pops the panel out from the tab row', async () => {
    const { popOut, onCollapse } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    await waitFor(() => expect(popOut).toHaveBeenCalledTimes(1))
    // Docked, the panel stays where it is.
    expect(onCollapse).not.toHaveBeenCalled()
    // One Pop out: the tab row's, not a second in the panel's header.
    expect(screen.getAllByRole('button', { name: 'Pop out' })).toHaveLength(1)
  })

  it('closes the overlay as it pops the panel out', async () => {
    const { popOut, onCollapse } = mount({ form: 'overlay' })
    fireEvent.click(screen.getByRole('button', { name: 'Pop out' }))
    await waitFor(() => expect(popOut).toHaveBeenCalledTimes(1))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('holds Pop out while the browser closes', () => {
    mount({ status: { state: 'closing', browser: SUMMARY } })
    const button = screen.getByRole('button', { name: 'Pop out' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('offers no Pop out once the browser has closed', async () => {
    mount({ status: { state: 'closed', browser: { ...SUMMARY, tabs: [] } } })
    expect(await screen.findByText('Launched Google Chrome closed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull()
  })

  it('shows the popped-out stub in the tab, which shows the window and docks it', async () => {
    const { client, showPopOut, dock } = mount({ poppedOut: true })
    await act(() => client.refetchQueries({ queryKey: queryKeys.launchedBrowserPopOut }))
    const panel = screen.getByRole('tabpanel', { name: 'Capture Session' })
    expect(await within(panel).findByText('Panel popped out')).toBeTruthy()
    expect(within(panel).queryByRole('list', { name: 'Tabs' })).toBeNull()
    // The window has the panel, so the tab row offers no second pop-out.
    expect(screen.queryByRole('button', { name: 'Pop out' })).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: 'Show window' }))
    await waitFor(() => expect(showPopOut).toHaveBeenCalledTimes(1))
    fireEvent.click(within(panel).getByRole('button', { name: 'Dock' }))
    await waitFor(() => expect(dock).toHaveBeenCalledTimes(1))
  })
})

describe('folding the panel from the tab row', () => {
  it('offers Collapse panel on the Capture Session tab', () => {
    const { onCollapse } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse panel' }))
    expect(onCollapse).toHaveBeenCalledTimes(1)
  })

  it('leaves it to the details panel on the Details tab, which has its own', () => {
    mount({ tab: 'details' })
    expect(screen.queryByRole('button', { name: 'Collapse panel' })).toBeNull()
  })

  it('offers it on the Details tab with no Capture selected', () => {
    mount({ tab: 'details', details: false })
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeTruthy()
  })
})

describe('the folded strip', () => {
  function mountStrip(status: LaunchedBrowserStatus | null, rail: boolean) {
    const onExpandSession = vi.fn()
    render(
      <CaptureRightStrip session={status && shown(status)} onExpandSession={onExpandSession}>
        {rail ? <button>rail: expand</button> : null}
      </CaptureRightStrip>
    )
    return { onExpandSession }
  }

  it('is the details rail alone with no Capture Session to show', () => {
    mountStrip(null, true)
    const strip = screen.getByTestId('capture-details-aside')
    expect(strip.className).toContain('w-10')
    expect(within(strip).getByText('rail: expand')).toBeTruthy()
    expect(screen.queryByTestId('right-strip-session')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Expand the Capture Session panel' })).toBeNull()
  })

  it('shows the recording dot and the tab count under the details rail', () => {
    const { onExpandSession } = mountStrip(OPEN, true)
    const session = screen.getByTestId('right-strip-session')
    expect(within(session).getByTitle('REC · Launched Google Chrome')).toBeTruthy()
    expect(within(session).getByTitle('2 tabs').textContent).toBe('2')
    expect(screen.getByText('rail: expand')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand the Capture Session panel' }))
    expect(onExpandSession).toHaveBeenCalledTimes(1)
  })

  it('shows them alone with no Capture selected', () => {
    mountStrip(OPEN, false)
    const strip = screen.getByTestId('capture-details-aside')
    expect(within(strip).getByTitle('2 tabs')).toBeTruthy()
    expect(strip.children).toHaveLength(1)
  })

  it('shows no dot while nothing records, and a notice by its glyph', () => {
    useAppStore.setState({ sessionActive: false })
    mountStrip(OPEN, false)
    expect(screen.queryByTitle('REC · Launched Google Chrome')).toBeNull()
    cleanup()
    const notice = { code: 'EGRESS_BYPASS', message: 'A response did not come through…' }
    mountStrip({ state: 'none', notice }, false)
    expect(screen.getByTitle('Browser closed: traffic went around the proxy')).toBeTruthy()
  })
})
