// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Case, LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { WINDOW_CONTROLS_RIGHT_PROPERTY } from '@renderer/lib/windowControls'
import { CaptureSessionWindow } from '@renderer/components/launchedBrowser/CaptureSessionWindow'
import { fakeBridge } from '../renderer/fakeBridge'

// No router mock: the pop-out has no router, so a call to one would warn (useRouter).

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
  sessionStartedAt: Date.now(),
  tabs: [
    { targetId: 't1', title: 'Tuesday sailings', url: 'https://ferry.test/routes/tue' },
    { targetId: 't2', title: '', url: 'about:blank' }
  ]
}
const OPEN: LaunchedBrowserStatus = { state: 'open', browser: SUMMARY }

function mount(status: LaunchedBrowserStatus = OPEN) {
  let push: ((next: LaunchedBrowserStatus) => void) | undefined
  const dock = vi.fn(async () => {})
  const endSession = vi.fn(async (): Promise<LaunchedBrowserStatus> => ({ state: 'none' }))
  fakeBridge({
    cases: { list: vi.fn(async () => [FERRY]) },
    settings: { get: vi.fn(async () => ({ egress: { kind: 'direct' } })) },
    launchedBrowser: { status: vi.fn(async () => status), dock, endSession },
    onLaunchedBrowserStatus: vi.fn((callback: (next: LaunchedBrowserStatus) => void) => {
      push = callback
      return () => {}
    })
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CaptureSessionWindow />
    </QueryClientProvider>
  )
  return { dock, endSession, push: (next: LaunchedBrowserStatus) => act(() => push?.(next)) }
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  document.title = 'Birdbrain · Capture Session'
  useAppStore.setState({ stopConfirmOpen: false, openDialogCount: 0 })
  warn = vi.spyOn(console, 'warn')
})

afterEach(() => {
  cleanup()
  warn.mockRestore()
})

describe('the Capture Session pop-out window', () => {
  it('titles the window with the Case, as the desktop shows it', async () => {
    mount()
    await waitFor(() => expect(document.title).toBe('Birdbrain · Ferry Line · Capture Session'))
    const bar = screen.getByRole('banner')
    expect(within(bar).getByText('Birdbrain')).toBeTruthy()
    expect(within(bar).getByText('Ferry Line')).toBeTruthy()
    // Beside the window controls there is no room for it; the panel's header names it.
    expect(within(bar).queryByText('Capture Session')).toBeNull()
    expect(within(screen.getByRole('main')).getByText('Capture Session')).toBeTruthy()
  })

  it('keeps its bar clear of the native window controls', () => {
    mount()
    expect(screen.getByRole('banner').style.paddingRight).toContain(
      `var(${WINDOW_CONTROLS_RIGHT_PROPERTY}, 0px)`
    )
  })

  it('docks from its title bar', async () => {
    const { dock } = mount()
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Dock' }))
    await waitFor(() => expect(dock).toHaveBeenCalledTimes(1))
  })

  it('shows the panel and follows the status main pushes', async () => {
    const { push } = mount()
    expect(await screen.findByText('2 tabs')).toBeTruthy()
    push({ ...OPEN, browser: { ...SUMMARY, tabs: SUMMARY.tabs.slice(0, 1) } })
    expect(await screen.findByText('1 tab')).toBeTruthy()
  })

  it('asks before stopping, in its own window', async () => {
    const { endSession } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Stop…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Stop the Capture Session?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop and close browser' }))
    await waitFor(() => expect(endSession).toHaveBeenCalledTimes(1))
  })

  it('runs with no router', async () => {
    mount()
    await screen.findByText('2 tabs')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('RouterProvider'))
  })
})
