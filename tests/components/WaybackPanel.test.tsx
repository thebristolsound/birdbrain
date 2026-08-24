// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { WaybackPanel } from '@renderer/components/captures/WaybackPanel'
import { useAppStore } from '@renderer/stores/appStore'
import type { Capture, WaybackSnapshot } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'

// Hoisted: the mock factory runs while the panel's import graph is still
// loading, which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

const CAPTURE_AT = '2026-06-15T12:00:00.000Z'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/',
  title: 'Example',
  hash: 'h',
  timestamp: CAPTURE_AT,
  createdAt: '2026-06-15T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

function snap(iso: string, extra: Partial<WaybackSnapshot> = {}): WaybackSnapshot {
  const cdx = iso.replace(/[-:TZ.]/g, '').slice(0, 14)
  return {
    timestamp: iso,
    snapshotUrl: `https://web.archive.org/web/${cdx}/https://example.com/`,
    originalUrl: 'https://example.com/',
    statusCode: 200,
    mimeType: 'text/html',
    ...extra
  }
}

// Eight snapshots one day apart, so the six-per-page footer and the pager both
// have something to do. Index 5 sits exactly on the capture time.
const SNAPSHOTS = Array.from({ length: 8 }, (_, i) =>
  snap(new Date(Date.parse(CAPTURE_AT) + (i - 5) * 86_400_000).toISOString())
)
const CLOSEST = SNAPSHOTS[5]

const LOOKUP_RESULT = {
  snapshots: SNAPSHOTS,
  closestIndex: 5,
  checkedAt: '2026-06-16T12:00:00.000Z'
}

let wayback: Record<string, ReturnType<typeof vi.fn>>
let onClose: ReturnType<typeof vi.fn>

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<WaybackPanel capture={capture} onClose={onClose} />, {
    wrapper: withClient(client)
  })
}

async function renderWithResult() {
  renderPanel()
  fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
  await screen.findAllByTestId('wayback-snapshot-row')
}

beforeEach(() => {
  onClose = vi.fn()
  wayback = {
    lookup: vi.fn().mockResolvedValue(LOOKUP_RESULT),
    list: vi.fn().mockResolvedValue([]),
    listForCase: vi.fn().mockResolvedValue([]),
    pin: vi.fn().mockResolvedValue({ id: 'ref1' }),
    unpin: vi.fn().mockResolvedValue(true)
  }
  fakeBridge({
    wayback,
    captures: { openExternal: vi.fn().mockResolvedValue(undefined) }
  })
  useAppStore.getState().setWaybackSelection(null)
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
  useAppStore.getState().setWaybackSelection(null)
})

describe('WaybackPanel', () => {
  it('waits for the operator before disclosing the URL to archive.org', () => {
    renderPanel()
    expect(screen.getByTestId('wayback-lookup-btn')).toBeDefined()
    expect(screen.getByTestId('wayback-idle')).toBeDefined()
    expect(screen.getByTestId('wayback-summary').textContent).toBe('Not looked up yet')
    expect(wayback.lookup).not.toHaveBeenCalled()
  })

  it('keeps the standing corroboration disclosure above the list', () => {
    renderPanel()
    expect(
      screen.getByText(/Corroboration only — looking up discloses the URL to archive\.org/)
    ).toBeDefined()
  })

  it('runs the lookup on click and pages the results six at a time', async () => {
    await renderWithResult()

    await waitFor(() => expect(wayback.lookup).toHaveBeenCalledWith('cap1'))
    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(6)
    expect(screen.getByTestId('wayback-footer').textContent).toContain('8 snapshots total')
    expect(screen.getByTestId('wayback-summary').textContent).toBe(
      '8 snapshots · closest 0m after capture'
    )

    fireEvent.click(screen.getByTestId('wayback-next-page'))
    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('wayback-prev-page'))
    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(6)
  })

  it('loads the closest snapshot into the compare selection on arrival', async () => {
    await renderWithResult()

    await waitFor(() =>
      expect(useAppStore.getState().waybackSelection).toEqual({
        captureId: 'cap1',
        snapshotUrl: CLOSEST.snapshotUrl,
        timestamp: CLOSEST.timestamp
      })
    )
  })

  it('moves the compare selection to a row the operator clicks', async () => {
    await renderWithResult()
    const rows = screen.getAllByTestId('wayback-snapshot-row')

    fireEvent.click(rows[0])

    expect(useAppStore.getState().waybackSelection?.snapshotUrl).toBe(SNAPSHOTS[0].snapshotUrl)
    expect(rows[0].getAttribute('aria-current')).toBe('true')
  })

  it('selects a row from the keyboard as well as the pointer', async () => {
    await renderWithResult()
    const rows = screen.getAllByTestId('wayback-snapshot-row')

    fireEvent.keyDown(rows[1], { key: 'Enter' })
    expect(useAppStore.getState().waybackSelection?.snapshotUrl).toBe(SNAPSHOTS[1].snapshotUrl)

    fireEvent.keyDown(rows[2], { key: ' ' })
    expect(useAppStore.getState().waybackSelection?.snapshotUrl).toBe(SNAPSHOTS[2].snapshotUrl)

    fireEvent.keyDown(rows[3], { key: 'Escape' })
    expect(useAppStore.getState().waybackSelection?.snapshotUrl).toBe(SNAPSHOTS[2].snapshotUrl)
  })

  it('filters the list without querying archive.org again', async () => {
    wayback.lookup.mockResolvedValue({
      snapshots: [
        snap('2026-06-14T00:00:00.000Z', { mimeType: 'application/pdf', statusCode: 404 }),
        ...SNAPSHOTS
      ],
      closestIndex: 6,
      checkedAt: LOOKUP_RESULT.checkedAt
    })
    await renderWithResult()

    fireEvent.change(screen.getByLabelText('Filter snapshots'), { target: { value: 'pdf' } })

    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(1)
    expect(wayback.lookup).toHaveBeenCalledTimes(1)
  })

  it('narrows to a preset range and reports an empty range distinctly', async () => {
    await renderWithResult()

    // Every snapshot is within a few days of the capture, so ±30 days keeps them
    // all; a year that contains none of them empties the list.
    fireEvent.click(screen.getByRole('button', { name: '±30 days of capture' }))
    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(6)

    fireEvent.click(screen.getByTestId('wayback-calendar-toggle'))
    fireEvent.click(screen.getByLabelText('Previous month'))
    fireEvent.click(screen.getByLabelText('May 2026 3'))
    fireEvent.click(screen.getByLabelText('May 2026 5'))
    fireEvent.click(screen.getByTestId('wayback-calendar-apply'))

    expect(screen.queryAllByTestId('wayback-snapshot-row')).toHaveLength(0)
    expect(screen.getByTestId('wayback-empty').textContent).toContain('No snapshots in this range')
    expect(screen.getByTestId('wayback-footer').textContent).toContain('0 in range')
  })

  it('jumps to the page holding the closest snapshot', async () => {
    await renderWithResult()

    fireEvent.click(screen.getByTestId('wayback-next-page'))
    expect(screen.getAllByTestId('wayback-snapshot-row')).toHaveLength(2)

    fireEvent.click(screen.getByTestId('wayback-jump-closest'))
    const rows = screen.getAllByTestId('wayback-snapshot-row')
    expect(rows).toHaveLength(6)
    expect(rows.some((row) => within(row).queryByText('closest'))).toBe(true)
  })

  it('pins a snapshot with the lookup time that produced it', async () => {
    await renderWithResult()

    fireEvent.click(screen.getAllByLabelText('Pin snapshot')[0])

    await waitFor(() =>
      expect(wayback.pin).toHaveBeenCalledWith({
        captureId: 'cap1',
        snapshot: SNAPSHOTS[0],
        checkedAt: LOOKUP_RESULT.checkedAt
      })
    )
  })

  it('unpins through the same control when the snapshot is already pinned', async () => {
    wayback.list.mockResolvedValue([
      {
        id: 'ref1',
        captureId: 'cap1',
        snapshotTimestamp: SNAPSHOTS[0].timestamp,
        snapshotUrl: SNAPSHOTS[0].snapshotUrl,
        originalUrl: 'https://example.com/',
        checkedAt: LOOKUP_RESULT.checkedAt,
        pinnedAt: '2026-06-16T12:01:00.000Z',
        statusCode: 200
      }
    ])
    await renderWithResult()

    const unpin = await screen.findByLabelText('Unpin snapshot')
    fireEvent.click(unpin)

    await waitFor(() => expect(wayback.unpin).toHaveBeenCalledWith('ref1'))
    expect(wayback.pin).not.toHaveBeenCalled()
  })

  it('opens a snapshot in the browser and reports a failed launch', async () => {
    // Held so the assertion can be on identity: the handler must pass the
    // original rejection through as `cause`, not a rewrapped stand-in.
    const cause = new Error('EACCES')
    const openExternal = vi.fn(async () => {
      throw cause
    })
    fakeBridge({ wayback, captures: { openExternal } })
    await renderWithResult()

    fireEvent.click(screen.getAllByLabelText('Open snapshot')[0])

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: a message that grew the URL would put the
    // captured URL into the durable log.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
    expect(openExternal).toHaveBeenCalledWith(SNAPSHOTS[0].snapshotUrl)
  })

  it('shows the loading, error and no-results states', async () => {
    let resolveLookup: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveLookup = resolve
    })
    wayback.lookup.mockReturnValueOnce(pending)
    renderPanel()
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    expect(await screen.findByTestId('wayback-loading')).toBeDefined()

    resolveLookup({ snapshots: [], closestIndex: null, checkedAt: LOOKUP_RESULT.checkedAt })
    expect(await screen.findByTestId('wayback-empty')).toBeDefined()
    expect(screen.getByTestId('wayback-empty').textContent).toContain('No archive.org snapshots')
    expect(screen.getByTestId('wayback-summary').textContent).toBe('No snapshots found')

    wayback.lookup.mockRejectedValueOnce(new Error('boom'))
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    expect(await screen.findByTestId('wayback-error')).toBeDefined()
  })

  it('closes through the panel header', () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('wayback-panel-close'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
