// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { LaunchedBrowserStatus, LaunchedBrowserSummary } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { useAppStore } from '@renderer/stores/appStore'
import { RecordingMark } from '@renderer/components/status/RecordingMark'

const START = Date.parse('2026-11-09T12:00:00Z')

function browserAt(sessionStartedAt: number | null): LaunchedBrowserSummary {
  return {
    family: 'chrome',
    label: 'Google Chrome',
    caseId: 'case1',
    version: '149.0.7827.55',
    extensionWarnings: [],
    sessionStartedAt,
    tabs: []
  }
}

function openAt(sessionStartedAt: number | null): LaunchedBrowserStatus {
  return { state: 'open', browser: browserAt(sessionStartedAt) }
}

function renderMark(status: LaunchedBrowserStatus, trigger?: boolean) {
  fakeBridge({ launchedBrowser: { status: vi.fn(async () => status) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<RecordingMark trigger={trigger} />, { wrapper: Wrapper })
}

beforeEach(() => {
  useAppStore.setState({ connectedToExtension: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RecordingMark', () => {
  it('says Recording once for an extension-only session', async () => {
    renderMark({ state: 'none' })
    const mark = await screen.findByTestId('topbar-rec')
    await vi.waitFor(() => expect(mark.textContent).toContain('extension'))
    expect(mark.textContent?.match(/Recording/g)).toHaveLength(1)
    expect(screen.queryByRole('timer')).toBeNull()
  })

  // A launched browser needs no extension, and its session outlives it: the mark names the
  // extension only while one is connected.
  it.each(['closed', 'starting', 'closing'] as const)(
    'names no source while the browser is %s and no extension is connected',
    async (state) => {
      useAppStore.setState({ connectedToExtension: false })
      const browser = browserAt(START)
      const status: LaunchedBrowserStatus =
        state === 'starting' ? { state, browser, step: 'browser' } : { state, browser }
      const queried = vi.fn(async () => status)
      fakeBridge({ launchedBrowser: { status: queried } })
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      render(
        <QueryClientProvider client={client}>
          <RecordingMark />
        </QueryClientProvider>
      )
      await vi.waitFor(() =>
        expect(client.getQueryData(['launchedBrowser', 'status'])).toBeTruthy()
      )
      expect(screen.getByTestId('topbar-rec').textContent).toBe('Recording')
    }
  )

  it('names the extension once the browser has closed while one is connected', async () => {
    renderMark({ state: 'closed', browser: browserAt(START) })
    const mark = await screen.findByTestId('topbar-rec')
    await vi.waitFor(() => expect(mark.textContent).toBe('Recordingextension'))
  })

  it('names the browser, not the extension, while the browser is open', async () => {
    renderMark(openAt(null))
    const mark = await screen.findByTestId('topbar-rec')
    await vi.waitFor(() => expect(mark.textContent).toBe('RecordingLaunched Google Chrome'))
  })

  it('shows the chevron only as the popover trigger', async () => {
    const { unmount } = renderMark({ state: 'none' })
    expect((await screen.findByTestId('topbar-rec')).textContent).not.toContain('▾')
    unmount()

    renderMark({ state: 'none' }, true)
    expect((await screen.findByTestId('topbar-rec')).textContent).toContain('▾')
  })

  it('ticks the elapsed timer each second and stops it on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(START + 5_000)
    const { unmount } = renderMark(openAt(START))

    const timer = await screen.findByRole('timer')
    expect(timer.textContent).toBe('00:05')
    expect(screen.getByTestId('topbar-rec').textContent).toContain('Launched Google Chrome')
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(timer.textContent).toBe('00:06')

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
