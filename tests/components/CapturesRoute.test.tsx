// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// Hoisted: the factories run while the route's import graph is still loading,
// which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' })
}))

// The route's own handler is what is under test; the capture list, viewer and
// note modal contribute nothing to it and each drag in their own data graph.
// The details panel and rail are each reduced to the one control that invokes
// the handler. Their labels differ because the route can mount both at once —
// the overlay panel renders *in addition to* the rail once forcedPanelOpen
// flips — and a shared label would turn a future default change into a
// "found multiple elements" failure rather than a failure about this handler.
vi.mock('@renderer/components/captures/CaptureList', () => ({
  CaptureList: () => null
}))
vi.mock('@renderer/components/captures/CaptureViewer', () => ({
  CaptureViewer: () => null
}))
vi.mock('@renderer/components/notes/AddNoteModal', () => ({
  AddNoteModal: () => null
}))
vi.mock('@renderer/components/captures/CaptureDetailsPanel', () => ({
  CaptureDetailsPanel: ({ onOpenExternal }: { onOpenExternal: () => void }) => (
    <button onClick={onOpenExternal}>panel: open externally</button>
  )
}))
vi.mock('@renderer/components/captures/CaptureDetailsRail', () => ({
  CaptureDetailsRail: ({ onOpenExternal }: { onOpenExternal: () => void }) => (
    <button onClick={onOpenExternal}>rail: open externally</button>
  )
}))

import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

// jsdom's viewport is 1024px wide, under the route's 1100px collapse
// threshold, so the rail is the variant that mounts here.
const OPEN_CONTROL = 'rail: open externally'

let openExternal: ReturnType<typeof vi.fn>
// Held so the assertion can be on identity: the handler must pass the original
// rejection through as `cause`, not a rewrapped stand-in.
let cause: Error

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CapturesRoute />, { wrapper: Wrapper })
}

beforeEach(() => {
  stubMatchMedia(false)
  cause = new Error('EACCES')
  openExternal = vi.fn(async () => {
    throw cause
  })
  fakeBridge({
    captures: { list: vi.fn(async () => [capture]), openExternal },
    settings: { get: vi.fn(async () => ({ detailsPanelCollapsed: false })) }
  })
  useAppStore.getState().setSelectedCaptureId(capture.id)
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
  useAppStore.getState().setSelectedCaptureId(null)
})

describe('CapturesRoute', () => {
  it("reports a failed shell launch when the capture's URL cannot be opened", async () => {
    renderRoute()

    fireEvent.click(await screen.findByText(OPEN_CONTROL))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(openExternal).toHaveBeenCalledWith('https://example.com/evidence')
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the capture URL is the evidence trail, and
    // a fixed literal with nothing interpolated into it is what keeps it out of
    // the durable log. A message that grew the URL would fail here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  it('says nothing when the capture URL opens successfully', async () => {
    openExternal.mockResolvedValue(undefined)
    renderRoute()

    fireEvent.click(await screen.findByText(OPEN_CONTROL))

    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    expect(notifyError).not.toHaveBeenCalled()
  })
})
