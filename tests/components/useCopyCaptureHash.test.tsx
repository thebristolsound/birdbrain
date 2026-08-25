// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import type { Capture } from '@shared/types'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: notifySuccess, info: vi.fn() }
}))

import {
  copyCaptureHash,
  useCopyCaptureHash
} from '@renderer/components/captures/useCopyCaptureHash'

// The published SHA-256 of the empty input, in the form the app stores it:
// lowercase hex, 64 characters, nothing around it.
const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
// The same digest written in uppercase hex. Hex case carries no meaning to a
// verifier, which is exactly why a "tidy-up" that lowercases on the way to the
// clipboard looks harmless — and why the lowercase vector above cannot catch
// one. Spelled out rather than derived from DIGEST so the expected string is
// the fixture, not a second copy of the transformation under test.
const UPPER_DIGEST = 'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example',
  hash: DIGEST,
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

function copied(): unknown {
  return writeText.mock.calls[0][0]
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  document.body.dispatchEvent(event)
  return event
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

describe('copyCaptureHash', () => {
  it('puts the digest on the clipboard and confirms it', async () => {
    await copyCaptureHash(DIGEST)

    expect(writeText).toHaveBeenCalledWith(DIGEST)
    expect(notifySuccess).toHaveBeenCalledWith('Copied SHA-256')
    expect(notifyError).not.toHaveBeenCalled()
  })

  // The known-answer cases. A digest is a content address: the copied string
  // either matches the one the manifest records and `verify` recomputes, or it
  // names nothing. #910 is the same guard missing on the copy-URL sibling —
  // every case there passed with a normalising transform injected, because no
  // fixture was sensitive to one.
  it('copies an uppercase digest verbatim, without normalising its case', async () => {
    await copyCaptureHash(UPPER_DIGEST)

    expect(copied()).toBe(UPPER_DIGEST)
  })

  it('copies all 64 characters, never a truncated or grouped display form', async () => {
    await copyCaptureHash(DIGEST)

    expect(copied()).toHaveLength(64)
    expect(copied()).toBe(DIGEST)
  })

  it('copies a stored digest byte for byte, without trimming it', async () => {
    // A defensive trim is the plausible version of this bug: it looks like
    // hygiene, and it silently repairs the display of a stored value that is
    // wrong. The operator would then paste a digest the database does not hold
    // and never see the storage defect that produced it.
    await copyCaptureHash(` ${DIGEST}\n`)

    expect(copied()).toBe(` ${DIGEST}\n`)
  })

  it('copies the bare digest, with no label or algorithm prefix around it', async () => {
    await copyCaptureHash(DIGEST)

    expect(copied()).not.toMatch(/sha/i)
    expect(copied()).toBe(DIGEST)
  })

  it('says so when the clipboard refuses the write', async () => {
    const cause = new Error('NotAllowedError')
    stubClipboard(async () => {
      throw cause
    })

    await copyCaptureHash(DIGEST)

    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledOnce()
    const [message, opts] = notifyError.mock.calls[0]
    // Exact literal with nothing interpolated: notify.error also writes a
    // durable log entry, and the digest identifies a specific piece of
    // evidence. Same contract as the copy-URL failure.
    expect(message).toBe("Couldn't copy the SHA-256 to your clipboard")
    expect(opts.cause).toBe(cause)
  })
})

describe('useCopyCaptureHash', () => {
  it('returns a callback the actions menu can invoke', async () => {
    const { result } = renderHook(() => useCopyCaptureHash(capture))

    await act(async () => result.current())

    expect(writeText).toHaveBeenCalledWith(DIGEST)
    expect(notifySuccess).toHaveBeenCalledWith('Copied SHA-256')
  })

  it("passes the capture's stored digest through unchanged", async () => {
    const { result } = renderHook(() => useCopyCaptureHash({ ...capture, hash: UPPER_DIGEST }))

    await act(async () => result.current())

    expect(copied()).toBe(UPPER_DIGEST)
  })

  it('does nothing at all with no capture selected', () => {
    const { result } = renderHook(() => useCopyCaptureHash(null))

    act(() => result.current())

    expect(writeText).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('does nothing for a capture carrying no digest', () => {
    const { result } = renderHook(() => useCopyCaptureHash({ ...capture, hash: '' }))

    act(() => result.current())

    // An empty clipboard write under a "Copied SHA-256" toast is the one
    // outcome worse than no copy at all.
    expect(writeText).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('follows the selection to another capture', async () => {
    // SHA-256 of 'a' — a second real vector, so the assertion is on a digest
    // and not on a stand-in string.
    const second = 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'
    const { result, rerender } = renderHook(({ c }: { c: Capture }) => useCopyCaptureHash(c), {
      initialProps: { c: capture }
    })

    rerender({ c: { ...capture, id: 'cap2', hash: second } })
    await act(async () => result.current())

    expect(writeText).toHaveBeenCalledExactlyOnceWith(second)
  })

  it.each([
    ['ctrl+C', { ctrlKey: true }],
    ['cmd+C', { metaKey: true }],
    ['ctrl+shift+C', { ctrlKey: true, shiftKey: true }]
  ])('binds no %s accelerator, leaving that gesture to its existing owners', (_label, init) => {
    renderHook(() => useCopyCaptureHash(capture))

    const event = press('c', init)

    // Copy SHA-256 has no key hint in the mock and Ctrl/Cmd+C belongs to Copy
    // URL. Mounting this hook beside that one must not consume the keystroke.
    expect(event.defaultPrevented).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
