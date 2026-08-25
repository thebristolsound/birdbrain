// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: notifySuccess, info: vi.fn() }
}))

import { copyCaptureUrl, useCopyCaptureUrl } from '@renderer/components/captures/useCopyCaptureUrl'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence?q=1',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

let writeText: ReturnType<typeof vi.fn>

function stubClipboard(impl: () => Promise<void>) {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

function press(key: string, init: KeyboardEventInit = {}, target?: HTMLElement) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
  return event
}

// jsdom's Selection is always collapsed unless a range is added, which is the
// state this stub reproduces without touching the real DOM selection.
function stubSelection(isCollapsed: boolean) {
  vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed } as Selection)
}

beforeEach(() => {
  stubClipboard(async () => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  notifySuccess.mockReset()
  notifyError.mockReset()
})

describe('copyCaptureUrl', () => {
  it('puts the URL on the clipboard and confirms it', async () => {
    await copyCaptureUrl(capture.url)

    expect(writeText).toHaveBeenCalledWith('https://example.com/evidence?q=1')
    expect(notifySuccess).toHaveBeenCalledWith('Copied URL')
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('says so when the clipboard refuses the write', async () => {
    const cause = new Error('NotAllowedError')
    stubClipboard(async () => {
      throw cause
    })

    await copyCaptureUrl(capture.url)

    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledOnce()
    const [message, opts] = notifyError.mock.calls[0]
    // Exact literal with nothing interpolated: the capture URL is evidence
    // trail, and notify.error's message is what a durable log entry would
    // otherwise carry. Same contract as the route's open-external failure.
    expect(message).toBe("Couldn't copy the URL to your clipboard")
    expect(opts.cause).toBe(cause)
  })
})

describe('useCopyCaptureUrl', () => {
  it('copies the capture URL on ctrl+C and consumes the event', async () => {
    renderHook(() => useCopyCaptureUrl(capture))

    const event = press('c', { ctrlKey: true })

    expect(event.defaultPrevented).toBe(true)
    expect(writeText).toHaveBeenCalledWith(capture.url)
  })

  it('accepts the cmd modifier as well, for macOS', async () => {
    renderHook(() => useCopyCaptureUrl(capture))

    press('c', { metaKey: true })

    expect(writeText).toHaveBeenCalledWith(capture.url)
  })

  it('returns a callback the actions menu can invoke without the keyboard', async () => {
    const { result } = renderHook(() => useCopyCaptureUrl(capture))

    await act(async () => result.current())

    expect(writeText).toHaveBeenCalledWith(capture.url)
    expect(notifySuccess).toHaveBeenCalledWith('Copied URL')
  })

  it('does nothing at all with no capture selected', () => {
    const { result } = renderHook(() => useCopyCaptureUrl(null))

    const event = press('c', { ctrlKey: true })
    act(() => result.current())

    expect(event.defaultPrevented).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('leaves a real text selection to the native copy', () => {
    stubSelection(false)
    renderHook(() => useCopyCaptureUrl(capture))

    const event = press('c', { ctrlKey: true })

    expect(event.defaultPrevented).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies when the selection object exists but is collapsed', () => {
    stubSelection(true)
    renderHook(() => useCopyCaptureUrl(capture))

    press('c', { ctrlKey: true })

    expect(writeText).toHaveBeenCalledWith(capture.url)
  })

  it.each([
    ['an input', document.createElement('input')],
    ['a textarea', document.createElement('textarea')]
  ])('leaves %s to the native copy', (_label, element) => {
    document.body.appendChild(element)
    renderHook(() => useCopyCaptureUrl(capture))

    press('c', { ctrlKey: true }, element)

    expect(writeText).not.toHaveBeenCalled()
    element.remove()
  })

  it('leaves a contenteditable — the note editor — to the native copy', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not implement contenteditable behaviour, so isContentEditable
    // stays false unless it is defined here.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    document.body.appendChild(editable)
    renderHook(() => useCopyCaptureUrl(capture))

    press('c', { ctrlKey: true }, editable)

    expect(writeText).not.toHaveBeenCalled()
    editable.remove()
  })

  it.each([
    ['a bare c', { ctrlKey: false }],
    ['the shift variant', { ctrlKey: true, shiftKey: true }],
    ['the alt variant', { ctrlKey: true, altKey: true }],
    ['a held-down repeat', { ctrlKey: true, repeat: true }]
  ])('ignores %s', (_label, init) => {
    renderHook(() => useCopyCaptureUrl(capture))

    press('c', init)

    expect(writeText).not.toHaveBeenCalled()
  })

  it('ignores an event another handler has already consumed', () => {
    renderHook(() => useCopyCaptureUrl(capture))
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    event.preventDefault()

    document.body.dispatchEvent(event)

    expect(writeText).not.toHaveBeenCalled()
  })

  it('stops copying once the surface unmounts', () => {
    const { unmount } = renderHook(() => useCopyCaptureUrl(capture))

    unmount()
    press('c', { ctrlKey: true })

    expect(writeText).not.toHaveBeenCalled()
  })

  it('follows the selection to another capture', () => {
    const { rerender } = renderHook(({ c }: { c: Capture }) => useCopyCaptureUrl(c), {
      initialProps: { c: capture }
    })

    rerender({ c: { ...capture, id: 'cap2', url: 'https://example.com/second' } })
    press('c', { ctrlKey: true })

    expect(writeText).toHaveBeenCalledExactlyOnceWith('https://example.com/second')
  })
})
