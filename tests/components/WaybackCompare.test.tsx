// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'
import { LEGACY_HTML_PARTITION, WAYBACK_PARTITION } from '@shared/constants'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

// The MHTML viewer's own <webview> is covered by its own surface; here it stands
// in so the assertions are about the compare, not about the file: URL query.
vi.mock('@renderer/components/captures/MhtmlViewer', () => ({
  MhtmlViewer: () => <div data-testid="mhtml-viewer-stub" />
}))

import { WaybackCompare } from '@renderer/components/captures/WaybackCompare'

const SNAPSHOT_URL = 'https://web.archive.org/web/20260610000000/https://example.com/'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-06-15T12:00:00.000Z',
  createdAt: '2026-06-15T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

const LEGACY_FILE_URL = 'file:///store/case1/cap1.html'

let openExternal: ReturnType<typeof vi.fn>

function renderCompare(subject: Capture = capture) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<WaybackCompare capture={subject} />, { wrapper: Wrapper })
}

function select(captureId = 'cap1') {
  useAppStore.getState().setWaybackSelection({
    captureId,
    snapshotUrl: SNAPSHOT_URL,
    timestamp: '2026-06-10T00:00:00.000Z'
  })
}

beforeEach(() => {
  openExternal = vi.fn().mockResolvedValue(undefined)
  fakeBridge({
    captures: { openExternal, getHtmlUrl: vi.fn().mockResolvedValue(LEGACY_FILE_URL) }
  })
  useAppStore.getState().setWaybackSelection(null)
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
  useAppStore.getState().setWaybackSelection(null)
})

describe('WaybackCompare', () => {
  it('labels the replay pane as live non-evidence content whether or not one is loaded', () => {
    renderCompare()
    const label = screen.getByTestId('wayback-nonevidence-label')
    expect(label.textContent).toContain('not evidence')
    expect(label.textContent).toContain('Pinning records the reference only')

    select()
    expect(screen.getByTestId('wayback-nonevidence-label')).toBeDefined()
  })

  it('renders the live capture beside the snapshot rather than a stored image', () => {
    select()
    renderCompare()

    expect(screen.getByTestId('mhtml-viewer-stub')).toBeDefined()
    const guest = screen.getByTestId('wayback-replay-webview')
    expect(guest.getAttribute('src')).toBe(SNAPSHOT_URL)
    expect(guest.getAttribute('partition')).toBe(WAYBACK_PARTITION)
    // Presence is truth for these attributes, so absence is the posture.
    expect(guest.getAttribute('nodeintegration')).toBeNull()
    expect(guest.getAttribute('allowpopups')).toBeNull()
    expect(guest.getAttribute('webpreferences')).toContain('sandbox=yes')
  })

  it('shows the interval between the snapshot and the capture', () => {
    select()
    renderCompare()
    expect(screen.getByText(/5d 12h before capture/)).toBeDefined()
  })

  it('holds the pane empty until a snapshot is chosen', () => {
    renderCompare()
    expect(screen.getByTestId('wayback-compare-empty')).toBeDefined()
    expect(screen.queryByTestId('wayback-replay-webview')).toBeNull()
    expect(screen.getByTestId('wayback-open-external').getAttribute('disabled')).not.toBeNull()
  })

  it('ignores a selection belonging to a different capture', () => {
    select('other-capture')
    renderCompare()
    expect(screen.getByTestId('wayback-compare-empty')).toBeDefined()
  })

  it('opens the snapshot at archive.org in the operator’s browser', async () => {
    select()
    renderCompare()

    fireEvent.click(screen.getByTestId('wayback-open-external'))

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith(SNAPSHOT_URL))
  })

  it('reports a failed browser launch without naming the URL', async () => {
    const cause = new Error('EACCES')
    openExternal.mockRejectedValueOnce(cause)
    select()
    renderCompare()

    fireEvent.click(screen.getByTestId('wayback-open-external'))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    const [message, opts] = notifyError.mock.calls[0]
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  // #906. This mount is the earlier of the two the fix covers: it renders when the
  // operator opens the Wayback tab, before any archive.org lookup is requested, so
  // an `<iframe sandbox="" srcDoc>` here disclosed to third parties ahead of the
  // one disclosure the panel asks consent for.
  it('renders a pre-v11 HTML capture in a no-network guest, not a sandboxed frame', async () => {
    select()
    const { container } = renderCompare({ ...capture, format: 'html' })

    const guest = await screen.findByTestId('legacy-html-viewer')
    expect(guest.getAttribute('src')).toBe(LEGACY_FILE_URL)
    expect(guest.getAttribute('partition')).toBe(LEGACY_HTML_PARTITION)
    expect(guest.getAttribute('webpreferences')).toContain('javascript=no')
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByTestId('mhtml-viewer-stub')).toBeNull()
  })

  it('says so when a legacy capture has no stored page to show', async () => {
    fakeBridge({ captures: { openExternal, getHtmlUrl: vi.fn().mockResolvedValue(null) } })
    renderCompare({ ...capture, format: 'html' })

    expect(await screen.findByText('No stored page archive available')).toBeDefined()
  })
})
