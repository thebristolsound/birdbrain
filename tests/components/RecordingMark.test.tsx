// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { LaunchedBrowserStatus } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { RecordingMark } from '@renderer/components/status/RecordingMark'

const START = Date.parse('2026-11-09T12:00:00Z')

function openAt(sessionStartedAt: number | null): LaunchedBrowserStatus {
  return {
    state: 'open',
    browser: {
      family: 'chrome',
      label: 'Google Chrome',
      caseId: 'case1',
      version: '149.0.7827.55',
      extensionWarnings: [],
      sessionStartedAt,
      tabs: []
    }
  }
}

function renderMark(status: LaunchedBrowserStatus, trigger?: boolean) {
  fakeBridge({ launchedBrowser: { status: vi.fn(async () => status) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<RecordingMark trigger={trigger} />, { wrapper: Wrapper })
}

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
