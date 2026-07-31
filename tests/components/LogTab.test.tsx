import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { LogTab } from '@renderer/components/diagnostics/LogTab'
import type { LogEntry } from '@shared/types'

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'a1',
    sessionId: 's1',
    timestamp: '2026-07-25T10:00:00.000Z',
    level: 'error',
    source: 'captureServer',
    code: 'capture.failed',
    ...over
  }
}

let listener: ((e: LogEntry) => void) | null = null

beforeEach(() => {
  listener = null
  vi.stubGlobal('birdbrain', {
    onLogEntry: (cb: (e: LogEntry) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    },
    diagnostics: { revealLog: vi.fn(), recentEntries: vi.fn().mockResolvedValue([]) }
  })
})

afterEach(() => {
  cleanup()
})

describe('LogTab', () => {
  it('shows an empty state before any entry arrives', () => {
    render(<LogTab />)
    expect(screen.getByText('No log entries')).toBeTruthy()
  })

  it('loads entries that were written before the tab was opened', async () => {
    // The tester opens this tab BECAUSE something failed, so the failure they
    // came to look at is always already in the past.
    window.birdbrain.diagnostics.recentEntries = vi
      .fn()
      .mockResolvedValue([entry({ id: 'old', code: 'capture.failed' })])
    render(<LogTab />)
    expect(await screen.findByText('Capture failed')).toBeTruthy()
  })

  it('does not double-list an entry present in both history and the live feed', async () => {
    window.birdbrain.diagnostics.recentEntries = vi.fn().mockResolvedValue([entry({ id: 'dup' })])
    render(<LogTab />)
    act(() => {
      listener?.(entry({ id: 'dup' }))
    })
    await waitFor(() => expect(screen.getAllByText('Capture failed')).toHaveLength(1))
  })

  it('renders entries pushed from main', () => {
    render(<LogTab />)
    act(() => {
      listener?.(entry())
    })
    expect(screen.getByText('Capture failed')).toBeTruthy()
    expect(screen.getByText('captureServer')).toBeTruthy()
  })

  it('filters out a level when its chip is toggled off', () => {
    render(<LogTab />)
    act(() => {
      listener?.(entry({ id: 'a1', level: 'error', code: 'capture.failed' }))
      listener?.(entry({ id: 'a2', level: 'info', code: 'app.session_start' }))
    })

    fireEvent.click(screen.getByRole('button', { name: /error/i }))
    expect(screen.queryByText('Capture failed')).toBeNull()
    expect(screen.getByText('Session started')).toBeTruthy()
  })

  it('reveals the log file', () => {
    render(<LogTab />)
    fireEvent.click(screen.getByRole('button', { name: /reveal log file/i }))
    expect(window.birdbrain.diagnostics.revealLog).toHaveBeenCalled()
  })
})
