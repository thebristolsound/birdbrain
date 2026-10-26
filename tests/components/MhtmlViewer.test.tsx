// @vitest-environment jsdom
//
// The MHTML evidence viewer: its guest's posture, its link menu, and its frame, which
// fills the pane whatever the window's size (#1941). Whether the guest's page lays out
// against that pane is only observable in Electron: e2e/page-tab-frame.spec.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MHTML_PARTITION } from '@shared/constants'
import { MhtmlViewer } from '@renderer/components/captures/MhtmlViewer'
import { notify } from '@renderer/lib/notify'
import { useAppStore } from '@renderer/stores/appStore'
import type { GuestMouseDownEvent, GuestMouseUpEvent } from '@shared/ipc'
import { fakeBridge } from '../renderer/fakeBridge'

const FILE_URL = 'file:///store/case1/cap1.mhtml'

function renderViewer({ linkClicks = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<MhtmlViewer captureId="cap1" caseId="case1" linkClicks={linkClicks} />, {
    wrapper: Wrapper
  })
}

// The guest's input as the main process reports it (#1735): a hover, a press and a
// release, each naming the guest, raised on whatever the viewer subscribed. `follow`
// is the guest's own attempt to follow a link, which Electron raises on the element.
function guestInput() {
  let down: (event: GuestMouseDownEvent) => void = () => {}
  let up: (event: GuestMouseUpEvent) => void = () => {}
  type Release = Partial<Omit<GuestMouseUpEvent, 'clickCount'>>
  const hover = (guest: HTMLElement, url: string) =>
    fireEvent(guest, Object.assign(new Event('update-target-url'), { url }))
  const press = ({ guestWebContentsId = 7, button = 'left' }: Release = {}) =>
    act(() => down({ guestWebContentsId, button }))
  const release = ({ guestWebContentsId = 7, button = 'left', modifiers = [] }: Release = {}) =>
    act(() => up({ guestWebContentsId, button, clickCount: 1, modifiers }))
  const follow = (guest: HTMLElement, url: string, type = 'did-start-navigation') =>
    fireEvent(guest, Object.assign(new Event(type), { url }))
  return {
    bridge: {
      onGuestMouseDown: (callback: typeof down) => {
        down = callback
        return () => {}
      },
      onGuestMouseUp: (callback: typeof up) => {
        up = callback
        return () => {}
      }
    },
    hover,
    press,
    release,
    follow,
    click: (guest: HTMLElement, url: string, input: Release = {}) => {
      hover(guest, url)
      press(input)
      release(input)
      follow(guest, url)
    }
  }
}

const VIEWED = { id: 'cap1', caseId: 'case1', url: 'https://news.example/story', title: 'Story' }
const HELD = {
  id: 'held',
  caseId: 'case1',
  url: 'https://other.example/a',
  title: 'Held',
  timestamp: '2026-02-01T00:00:00Z'
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

  // Re-parenting or re-keying the element is the kind of edit that can
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

  // #1735, plan A2 and A3. The guest goes nowhere; the selection moves.
  it('opens the Case’s Capture of a clicked link and pushes the viewed one on the trail', async () => {
    const input = guestInput()
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED, HELD])
      },
      ...input.bridge
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })

    await waitFor(() => {
      input.click(guest, 'https://other.example/a#section')
      expect(useAppStore.getState().selectedCaptureId).toBe('held')
    })
    expect(useAppStore.getState().captureTrail).toEqual(['cap1'])
    expect(screen.queryByTestId('link-not-in-case')).toBeNull()
  })

  it('does nothing for a middle, modified or dragged click, or one in another guest', async () => {
    const input = guestInput()
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED, HELD])
      },
      ...input.bridge
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })
    // A plain click first, so the Case's Captures are known to have loaded.
    await waitFor(() => {
      input.click(guest, HELD.url)
      expect(useAppStore.getState().selectedCaptureId).toBe('held')
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })

    input.click(guest, HELD.url, { button: 'middle' })
    input.click(guest, HELD.url, { button: 'right' })
    for (const modifier of ['shift', 'control', 'alt', 'meta'] as const) {
      input.click(guest, HELD.url, { modifiers: [modifier] })
    }
    // Pressed on the link and released off it.
    input.hover(guest, HELD.url)
    input.press()
    input.hover(guest, '')
    input.release()
    // A press or a release in another guest pairs with nothing here.
    input.hover(guest, HELD.url)
    input.press({ guestWebContentsId: 8 })
    input.release()
    input.press()
    input.release({ guestWebContentsId: 8 })

    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(useAppStore.getState().captureTrail).toEqual([])
  })

  // #1735 review, finding 1. The press and release can arrive before the guest reports
  // the link the pointer moved onto, so they name the previous one; the guest's own
  // attempt to follow a link says which it clicked.
  it('acts on a click only when the guest then follows the link it named', async () => {
    const input = guestInput()
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED, HELD])
      },
      ...input.bridge
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })
    await waitFor(() => {
      input.click(guest, HELD.url)
      expect(useAppStore.getState().selectedCaptureId).toBe('held')
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })

    // The hover still names the held link, but the guest follows another.
    input.hover(guest, HELD.url)
    input.press()
    input.release()
    input.follow(guest, 'https://elsewhere.example/b')
    // A click the guest does not follow, then a follow after the next press.
    input.press()
    input.release()
    input.press()
    input.follow(guest, HELD.url)

    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(screen.queryByTestId('link-not-in-case')).toBeNull()

    // A main-frame click raises will-frame-navigate too; either one confirms it.
    input.release()
    input.follow(guest, HELD.url, 'will-frame-navigate')
    expect(useAppStore.getState().selectedCaptureId).toBe('held')
  })

  it('says a clicked link is not in this Case and offers Capture link until the next press', async () => {
    const input = guestInput()
    const enqueue = vi.fn().mockResolvedValue({ accepted: 1, rejected: [] })
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED])
      },
      recapture: { enqueue },
      ...input.bridge
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })

    await waitFor(() => {
      input.click(guest, 'https://elsewhere.example/page')
      expect(screen.getByTestId('link-not-in-case')).toBeDefined()
    })
    const notice = screen.getByTestId('link-not-in-case')
    expect(notice.textContent).toContain('Not in this Case')
    expect(screen.queryByTestId('link-status-bubble')).toBeNull()
    fireEvent.click(within(notice).getByRole('button', { name: 'Capture link' }))
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith({
        urls: ['https://elsewhere.example/page'],
        caseId: 'case1',
        supersedesCaptureId: undefined
      })
    )
    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')

    input.click(guest, 'http://127.0.0.1:8080/admin')
    const refused = within(await screen.findByTestId('link-not-in-case')).getByRole('button')
    expect(refused.textContent).toBe('Capture link (Points at a loopback address)')
    expect((refused as HTMLButtonElement).disabled).toBe(true)

    input.click(guest, '')
    await waitFor(() => expect(screen.queryByTestId('link-not-in-case')).toBeNull())
  })

  it('does nothing for a link to the viewed Capture or a non-web scheme', async () => {
    const input = guestInput()
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED, HELD])
      },
      ...input.bridge
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })
    await waitFor(() => {
      input.click(guest, HELD.url)
      expect(useAppStore.getState().selectedCaptureId).toBe('held')
    })
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })

    for (const url of ['https://news.example/story#top', 'mailto:a@b.example']) {
      input.click(guest, url)
    }

    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(useAppStore.getState().captureTrail).toEqual([])
    expect(screen.queryByTestId('link-not-in-case')).toBeNull()
  })

  // #1735, plan A6. The Wayback compare pane mounts the viewer with link clicks off.
  it('does nothing on a link click with linkClicks off', async () => {
    const input = guestInput()
    fakeBridge({
      captures: {
        getMhtmlUrl: vi.fn().mockResolvedValue(FILE_URL),
        list: vi.fn().mockResolvedValue([VIEWED, HELD])
      },
      ...input.bridge
    })
    const onGuestMouseUp = vi.spyOn(window.birdbrain, 'onGuestMouseUp')
    useAppStore.setState({ selectedCaptureId: 'cap1', captureTrail: [] })
    renderViewer({ linkClicks: false })
    const guest = await screen.findByTestId('mhtml-viewer')
    Object.assign(guest, { getWebContentsId: () => 7 })

    input.click(guest, HELD.url)
    input.click(guest, 'https://elsewhere.example/page')

    expect(onGuestMouseUp).not.toHaveBeenCalled()
    expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    expect(screen.queryByTestId('link-not-in-case')).toBeNull()
  })

  it('opens no menu for a right-click on the pane around the guest', async () => {
    renderViewer()
    const pane = await screen.findByTestId('mhtml-viewer-pane')

    fireEvent.contextMenu(pane)

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens nothing for a right-click that hit no link, image or selection', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')

    guestContextMenu(guest, { linkURL: '' })

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('fills its pane, and a window resize leaves the frame to its pane', async () => {
    renderViewer()
    const guest = await screen.findByTestId('mhtml-viewer')
    expect(guest.style.width).toBe('100%')
    expect(guest.style.height).toBe('100%')

    resizeWindowTo(900, 600)

    expect(guest.style.width).toBe('100%')
    expect(guest.style.height).toBe('100%')
  })

  it('shows a failed archive lookup in the danger token and mounts no guest', async () => {
    fakeBridge({
      captures: { getMhtmlUrl: vi.fn().mockRejectedValue(new Error('archive missing')) }
    })
    renderViewer()

    const message = await screen.findByText('Error: archive missing')
    expect(message.className).toContain('text-danger-fg')
    expect(screen.queryByTestId('mhtml-viewer')).toBeNull()
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
