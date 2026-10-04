// @vitest-environment jsdom
//
// The MHTML evidence viewer's frame geometry (#465). Electron sizes a guest's widget
// from the element but lays its page out against the embedder window, so a frame
// sized to the pane painted the rest of the page outside itself with nothing able to
// scroll to it. What this file keeps is the shape that makes it reachable: the frame
// carries the window's size, and the pane around it scrolls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MHTML_PARTITION } from '@shared/constants'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const FILE_URL = 'file:///store/case1/cap1.mhtml'

function renderViewer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<MhtmlViewer captureId="cap1" caseId="case1" />, { wrapper: Wrapper })
}

// What Electron raises on the <webview> element for a right-click in the guest: the
// data is on `params`, not on the event.
function guestContextMenu(guest: HTMLElement, params: Record<string, unknown>) {
  const event = Object.assign(new Event('context-menu', { cancelable: true }), {
    params: {
      x: 10,
      y: 20,
      linkText: '',
      srcURL: '',
      mediaType: 'none',
      selectionText: '',
      ...params
    }
  })
  fireEvent(guest, event)
  return event
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
  vi.restoreAllMocks()
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
  // quietly drop these listeners, so both are asserted against the element as mounted.
  // They are kept as a second layer only: this test is no evidence that a navigation
  // is blocked, because the main process's frame guard is what blocks it (#1708).
  it('refuses a navigation the guest attempts anyway', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    for (const type of ['will-navigate', 'new-window']) {
      const event = new Event(type, { cancelable: true })
      fireEvent(guest, event)
      expect(event.defaultPrevented).toBe(true)
    }
  })

  // The links in the guest have to take the pointer for a hover or a right-click to
  // find them, so the viewer no longer injects the stylesheet that switched them off.
  // What stops a click following one is the main-process guard, which no test of
  // this component can stand in for.
  it('leaves links in the guest live to the pointer', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    const insertCSS = vi.fn()
    Object.assign(guest, { insertCSS })

    fireEvent(guest, new Event('dom-ready'))

    expect(insertCSS).not.toHaveBeenCalled()
  })

  // #1708 D4. The guest's right-click never reaches this document, so the menu is
  // opened by hand; this pins that the second right-click opens with its own target.
  it('opens the link menu with each right-click’s own target', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    const first = guestContextMenu(guest, { linkURL: 'https://a.example/one', linkText: 'one' })
    expect(first.defaultPrevented).toBe(true)
    expect((await screen.findByRole('menu')).getAttribute('aria-label')).toBe(
      'Link actions: https://a.example/one'
    )

    guestContextMenu(guest, { linkURL: 'https://b.example/two', linkText: 'two' })
    await waitFor(() => {
      expect(screen.getByRole('menu').getAttribute('aria-label')).toBe(
        'Link actions: https://b.example/two'
      )
    })
    expect(screen.getAllByRole('menu')).toHaveLength(1)
  })

  it('shows the hovered link’s destination in a bubble and clears it on an empty one', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    const long = `https://example.com/${'x'.repeat(300)}/end`

    fireEvent(guest, Object.assign(new Event('update-target-url'), { url: long }))
    const bubble = await screen.findByTestId('link-status-bubble')
    expect(bubble.getAttribute('title')).toBe(long)
    expect(bubble.textContent).toHaveLength(120)
    expect(bubble.textContent?.endsWith('/end')).toBe(true)

    fireEvent(guest, Object.assign(new Event('update-target-url'), { url: '' }))
    await waitFor(() => expect(screen.queryByTestId('link-status-bubble')).toBeNull())
  })

  it('queues Capture link into the viewed Capture’s Case and reports a refusal', async () => {
    const enqueue = vi
      .fn()
      .mockResolvedValueOnce({ accepted: 1, rejected: [] })
      .mockResolvedValueOnce({
        accepted: 0,
        rejected: [{ url: 'https://a.example/one', reason: 'excluded by case policy' }]
      })
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([])
      },
      recapture: { enqueue }
    })
    const success = vi.spyOn(notify, 'success')
    const warn = vi.spyOn(notify, 'warn')
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    for (let i = 0; i < 2; i++) {
      guestContextMenu(guest, { linkURL: 'https://a.example/one', linkText: 'one' })
      fireEvent.click(await screen.findByTestId('context-menu-item-link-capture'))
    }

    await waitFor(() => expect(warn).toHaveBeenCalled())
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue).toHaveBeenCalledWith({
      urls: ['https://a.example/one'],
      caseId: 'case1',
      supersedesCaptureId: undefined
    })
    expect(success).toHaveBeenCalledWith('Link capture queued', {
      description: 'https://a.example/one'
    })
    expect(warn).toHaveBeenCalledWith('Link not captured: excluded by case policy')
  })

  it('offers Open captured copy when the Case holds the link, and selects that Capture', async () => {
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([
          { id: 'old', url: 'https://a.example/one', timestamp: '2026-01-01T00:00:00Z' },
          { id: 'new', url: 'https://a.example/one#top', timestamp: '2026-02-01T00:00:00Z' }
        ])
      }
    })
    useAppStore.setState({ selectedCaptureId: 'cap1' })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    guestContextMenu(guest, { linkURL: 'https://b.example/elsewhere' })
    await screen.findByRole('menu')
    expect(screen.queryByTestId('context-menu-item-link-open-captured')).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    await waitFor(() => {
      guestContextMenu(guest, { linkURL: 'https://a.example/one' })
      expect(screen.getByTestId('context-menu-item-link-open-captured')).toBeDefined()
    })
    fireEvent.click(screen.getByTestId('context-menu-item-link-open-captured'))
    expect(useAppStore.getState().selectedCaptureId).toBe('new')
  })

  // #1708. The main process reports an iframe that swapped its stored document; the
  // pane says so and offers a reload, and the reload's main-frame commit clears it.
  it('flags a swapped frame in its own guest only, and clears it on reload', async () => {
    let report: (event: { guestWebContentsId: number }) => void = () => {}
    fakeBridge({
      captures: { getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL) },
      onGuestFrameReplaced: (callback: typeof report) => {
        report = callback
        return () => {}
      }
    })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    const reload = vi.fn()
    Object.assign(guest, { getWebContentsId: () => 7, reload })

    act(() => report({ guestWebContentsId: 8 }))
    expect(screen.queryByTestId('frame-changed-notice')).toBeNull()

    act(() => report({ guestWebContentsId: 7 }))
    const notice = await screen.findByTestId('frame-changed-notice')
    expect(notice.textContent).toContain('A frame in this page changed after it loaded.')
    fireEvent.click(within(notice).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()

    fireEvent(guest, new Event('did-navigate'))
    await waitFor(() => expect(screen.queryByTestId('frame-changed-notice')).toBeNull())
  })

  // #1708. The main process reports a press in a guest; only this viewer's own closes it.
  it('closes the menu on a mouse press in its own guest', async () => {
    let press: (event: { guestWebContentsId: number }) => void = () => {}
    const stop = vi.fn()
    fakeBridge({
      captures: { getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL) },
      onGuestMouseDown: (callback: typeof press) => {
        press = callback
        return stop
      }
    })
    const { unmount } = renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })
    guestContextMenu(guest, { linkURL: 'https://a.example/one' })
    await screen.findByRole('menu')

    act(() => press({ guestWebContentsId: 8 }))
    expect(screen.getByRole('menu')).toBeDefined()

    act(() => press({ guestWebContentsId: 7 }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('opens no menu for a right-click on the pane around the guest', async () => {
    renderViewer()
    const pane = await screen.findByTestId('mhtml-viewer-scroll')

    fireEvent.contextMenu(pane)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens nothing for a right-click that hit no link, image or selection', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    guestContextMenu(guest, { linkURL: '' })

    expect(screen.queryByRole('menu')).toBeNull()
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
