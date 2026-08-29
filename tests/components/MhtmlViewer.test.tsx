// @vitest-environment jsdom
//
// The MHTML evidence viewer's frame geometry (#465). Electron sizes a guest's widget
// from the element but lays its page out against the embedder window, so a frame
// sized to the pane painted the rest of the page outside itself with nothing able to
// scroll to it. What this file keeps is the shape that makes it reachable: the frame
// carries the window's size, and the pane around it scrolls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MHTML_PARTITION } from '@shared/constants'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { fakeBridge } from '../renderer/fakeBridge'

const FILE_URL = 'file:///store/case1/cap1.mhtml'

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<MhtmlViewer captureId="cap1" />, { wrapper: Wrapper })
}

function resizeWindowTo(width: number, height: number) {
  Object.assign(window, { innerWidth: width, innerHeight: height })
  fireEvent(window, new Event('resize'))
}

beforeEach(() => {
  fakeBridge({ captures: { getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL) } })
  Object.assign(window, { innerWidth: 1200, innerHeight: 800 })
})

afterEach(() => {
  cleanup()
})

describe('MhtmlViewer', () => {
  it('mounts the archive as a guest on the MHTML partition', async () => {
    renderViewer()

    const guest = await screen.findByTestId('mhtml-viewer')

    expect(guest.getAttribute('src')).toBe(FILE_URL)
    expect(guest.getAttribute('partition')).toBe(MHTML_PARTITION)
    expect(guest.getAttribute('webpreferences')).toContain('javascript=no')
    expect(guest.getAttribute('webpreferences')).toContain('sandbox=yes')
    // Presence is truth for these two, so absence is the posture.
    expect(guest.getAttribute('nodeintegration')).toBeNull()
    expect(guest.getAttribute('allowpopups')).toBeNull()
  })

  // Re-parenting the element under a scroll container is the kind of edit that can
  // quietly drop the listeners this viewer's posture rests on, so both are asserted
  // against the element as mounted.
  it('refuses a navigation the guest attempts anyway', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    for (const type of ['will-navigate', 'new-window']) {
      const event = new Event(type, { cancelable: true })
      fireEvent(guest, event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  it('disables links in the guest once it is ready', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    const insertCSS = vi.fn()
    Object.assign(guest, { insertCSS })

    fireEvent(guest, new Event('dom-ready'))

    expect(insertCSS).toHaveBeenCalledOnce()
    expect(insertCSS.mock.calls[0][0]).toContain('pointer-events: none')
  })

  it('sizes the frame to the window rather than to the pane, and lets the pane scroll', async () => {
    renderViewer()

    const guest = await screen.findByTestId('mhtml-viewer')
    expect(guest.style.width).toBe('1200px')
    expect(guest.style.height).toBe('800px')
    // The pane is the only box that may clip, and it has to offer scrollbars when it
    // does: an overflow-hidden pane is what made the excess unreachable.
    const pane = screen.getByTestId('mhtml-viewer-scroll')
    expect(pane.className).toContain('overflow-auto')
    // A frame narrower than the pane would leave a strip of empty pane beside the page.
    expect(guest.style.minWidth).toBe('100%')
    expect(guest.style.minHeight).toBe('100%')
  })

  it('re-measures the frame when the window is resized', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    resizeWindowTo(900, 600)

    await waitFor(() => {
      expect(guest.style.width).toBe('900px')
      expect(guest.style.height).toBe('600px')
    })
  })

  // The `captures:getMhtmlUrl` handler answers null for a capture whose file is gone,
  // and this viewer has no state for that: the null lands on the
  // same `!fileUrl` branch as a query still in flight, so a missing archive reads as a
  // permanent "Loading MHTML...". That is pre-existing and out of scope for #465, and
  // it is why this case is titled for what it asserts — no guest — rather than for a
  // report the component does not make. `LegacyHtmlViewer` has the emptyLabel this one
  // lacks.
  it('mounts no guest while the archive URL is unresolved', async () => {
    fakeBridge({ captures: { getMhtmlUrl: vi.fn().mockResolvedValue(null) } })
    renderViewer()

    expect(await screen.findByText('Loading MHTML...')).toBeDefined()
    expect(screen.queryByTestId('mhtml-viewer')).toBeNull()
  })
})
