// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { CrashRecoveryPrompt } from '@renderer/components/diagnostics/CrashRecoveryPrompt'
import { fakeBridge } from '../renderer/fakeBridge'

const session = {
  id: 'sess-1',
  startedAt: '2026-08-01T00:00:00.000Z',
  clean: false
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CrashRecoveryPrompt', () => {
  it('offers recovery when the previous session ended unclean', async () => {
    fakeBridge({ diagnostics: { lastSession: vi.fn(async () => session) } })

    render(<CrashRecoveryPrompt />)

    expect(await screen.findByText('Birdbrain closed unexpectedly last time.')).toBeDefined()
  })

  it('renders nothing when there is no unclean session', async () => {
    const lastSession = vi.fn(async () => null)
    fakeBridge({ diagnostics: { lastSession } })

    const { container } = render(<CrashRecoveryPrompt />)

    await waitFor(() => expect(lastSession).toHaveBeenCalledOnce())
    expect(container.firstChild).toBeNull()
  })

  it('stays silent when the take-once lookup fails', async () => {
    const lastSession = vi.fn(async () => Promise.reject(new Error('no log')))
    fakeBridge({ diagnostics: { lastSession } })

    const { container } = render(<CrashRecoveryPrompt />)

    await waitFor(() => expect(lastSession).toHaveBeenCalledOnce())
    expect(container.firstChild).toBeNull()
  })

  // The dialog is mounted once in __root.tsx; every other trigger reaches it
  // through this event, so the button must dispatch rather than mount its own.
  it('dispatches the report event instead of mounting a second dialog', async () => {
    fakeBridge({ diagnostics: { lastSession: vi.fn(async () => session) } })
    const onReport = vi.fn()
    window.addEventListener('birdbrain:report', onReport)

    render(<CrashRecoveryPrompt />)
    fireEvent.click(await screen.findByText('Create a report'))

    expect(onReport).toHaveBeenCalledOnce()
    window.removeEventListener('birdbrain:report', onReport)
  })

  it('dismisses without asking again', async () => {
    fakeBridge({ diagnostics: { lastSession: vi.fn(async () => session) } })

    render(<CrashRecoveryPrompt />)
    fireEvent.click(await screen.findByText('Dismiss'))

    expect(screen.queryByText('Birdbrain closed unexpectedly last time.')).toBeNull()
  })
})
