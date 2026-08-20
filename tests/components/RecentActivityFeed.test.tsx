// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { RecentActivityEvent } from '@shared/types'

// Hoisted so the mock factory can reference it while the component's import
// graph is still loading.
const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import { RecentActivityFeed } from '@renderer/components/dashboard/RecentActivityFeed'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

// Relative to the real clock so the time column is asserted the way an
// operator reads it, without a fake timer fighting React Query's scheduling.
const hoursAgo = (n: number): string => new Date(Date.now() - n * 3_600_000).toISOString()

const captureEvent: RecentActivityEvent = {
  kind: 'capture',
  captureId: 'cap-1',
  caseId: 'case-1',
  caseName: 'Nightjar Phishing Kit',
  caseType: 'fraud',
  title: 'Sign in — Meridian Trust Bank',
  url: 'https://meridian.example/login',
  occurredAt: hoursAgo(2),
  lastVerifiedStatus: 'verified'
}

const noteEvent: RecentActivityEvent = {
  kind: 'note',
  noteId: 'note-1',
  caseId: 'case-2',
  caseName: 'Lazuli Ransom Wallets',
  caseType: 'crypto',
  title: 'Kit fingerprint',
  occurredAt: hoursAgo(1)
}

function renderFeed(events: RecentActivityEvent[] | Promise<RecentActivityEvent[]>) {
  const recentActivity = vi.fn(async () => events)
  fakeBridge({ cases: { recentActivity } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { recentActivity, ...render(<RecentActivityFeed />, { wrapper: Wrapper }) }
}

beforeEach(() => {
  navigate.mockClear()
  useAppStore.setState({ selectedCaptureId: null, selectedNoteId: null })
})

afterEach(() => {
  cleanup()
})

describe('RecentActivityFeed', () => {
  it('asks the bounded cross-case query for the default page of events', async () => {
    const { recentActivity } = renderFeed([])
    await waitFor(() => expect(recentActivity).toHaveBeenCalledWith(10))
    expect(screen.getByText('last 10 events · all cases')).toBeTruthy()
  })

  it('renders one row per event, newest-first order preserved', async () => {
    renderFeed([noteEvent, captureEvent])

    const rows = await screen.findAllByTestId('recent-activity-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Edited note — Kit fingerprint')
    expect(rows[0].textContent).toContain('Lazuli Ransom Wallets')
    expect(rows[0].textContent).toContain('1 hour ago')
    expect(rows[1].textContent).toContain('Captured Sign in — Meridian Trust Bank')
    expect(rows[1].textContent).toContain('Nightjar Phishing Kit')
    expect(rows[1].textContent).toContain('2 hours ago')
  })

  it('falls back to the url on an untitled capture and to the notes copy on an untitled note', async () => {
    renderFeed([
      { ...captureEvent, title: null },
      { ...noteEvent, title: null }
    ])

    const rows = await screen.findAllByTestId('recent-activity-row')
    expect(rows[0].textContent).toContain('Captured https://meridian.example/login')
    expect(rows[1].textContent).toContain('Edited note — (Untitled note)')
  })

  it('shows the verification status on capture rows and no dot on note rows', async () => {
    renderFeed([captureEvent, noteEvent])

    const dots = await screen.findAllByTestId('recent-activity-provenance')
    expect(dots[0].getAttribute('title')).toBe('Verified')
    expect(dots[0].className).toContain('bg-emerald-400')
    expect(dots[1].getAttribute('title')).toBeNull()
    expect(dots[1].className).toContain('bg-transparent')
  })

  it('shows the empty state once the query resolves with nothing', async () => {
    renderFeed([])

    expect(await screen.findByTestId('recent-activity-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('recent-activity-row')).toHaveLength(0)
  })

  it('renders neither rows nor the empty state while the query is pending', () => {
    renderFeed(new Promise<RecentActivityEvent[]>(() => {}))

    expect(screen.getByTestId('recent-activity-feed')).toBeTruthy()
    expect(screen.queryByTestId('recent-activity-empty')).toBeNull()
    expect(screen.queryAllByTestId('recent-activity-row')).toHaveLength(0)
  })

  it('opens a capture row in its case with the capture selected', async () => {
    renderFeed([captureEvent])

    fireEvent.click(await screen.findByTestId('recent-activity-row'))

    expect(useAppStore.getState().selectedCaptureId).toBe('cap-1')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  it('opens a note row in the Notes tab with the note selected', async () => {
    renderFeed([noteEvent])

    fireEvent.click(await screen.findByTestId('recent-activity-row'))

    expect(useAppStore.getState().selectedNoteId).toBe('note-1')
    expect(useAppStore.getState().selectedCaptureId).toBeNull()
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/notes',
      params: { caseId: 'case-2' }
    })
  })

  it('tints the case chip by case type, defaulting to the accent token', async () => {
    renderFeed([captureEvent, { ...noteEvent, caseType: undefined }])

    const rows = await screen.findAllByTestId('recent-activity-row')
    expect(rows[0].innerHTML).toContain('text-pink-500')
    expect(rows[1].innerHTML).toContain('text-accent')
  })
})
