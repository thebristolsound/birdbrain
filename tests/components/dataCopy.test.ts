// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())
const notifyWarn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: notifyWarn, success: notifySuccess, info: vi.fn() }
}))

import { copyDigest, copyValue } from '@renderer/components/data/copy'

// SHA-256 of the empty input, as the app stores it.
const DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

let writeText: ReturnType<typeof vi.fn>

function stubClipboard(impl: () => Promise<void>) {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
}

beforeEach(() => {
  stubClipboard(async () => undefined)
})

afterEach(() => {
  notifySuccess.mockReset()
  notifyError.mockReset()
  notifyWarn.mockReset()
})

describe('copyDigest', () => {
  it('copies a valid digest and announces it under its label', async () => {
    await copyDigest(DIGEST, 'entry hash')

    expect(writeText).toHaveBeenCalledExactlyOnceWith(DIGEST)
    expect(notifySuccess).toHaveBeenCalledExactlyOnceWith('Copied entry hash')
    expect(notifyWarn).not.toHaveBeenCalled()
  })

  it('accepts an uppercase digest and copies it unchanged', async () => {
    await copyDigest(DIGEST.toUpperCase(), 'SHA-256')

    expect(writeText).toHaveBeenCalledExactlyOnceWith(DIGEST.toUpperCase())
    expect(notifySuccess).toHaveBeenCalledExactlyOnceWith('Copied SHA-256')
  })

  it.each([
    ['too short', DIGEST.slice(1)],
    ['not hex', `${DIGEST.slice(1)}g`],
    ['padded', ` ${DIGEST}`]
  ])('copies a malformed value (%s) as stored, with a warning', async (_case, stored) => {
    await copyDigest(stored, 'SHA-256 (not anchored)')

    expect(writeText).toHaveBeenCalledExactlyOnceWith(stored)
    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyWarn).toHaveBeenCalledExactlyOnceWith(
      "Copied the stored SHA-256 (not anchored), but it isn't a 64-character hex digest"
    )
  })

  it('writes nothing for an empty value, and says so', async () => {
    await copyDigest('', 'SHA-256 (not anchored)')

    expect(writeText).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
    expect(notifyWarn).toHaveBeenCalledExactlyOnceWith(
      'Nothing was copied: the stored SHA-256 (not anchored) is empty'
    )
  })

  it('reports a denied clipboard instead of a warning or success', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError')
    })

    await copyDigest('not a hash', 'previous hash')

    expect(notifyError).toHaveBeenCalledOnce()
    expect(notifyError.mock.calls[0][0]).toBe("Couldn't copy the previous hash to your clipboard")
    expect(notifyWarn).not.toHaveBeenCalled()
    expect(notifySuccess).not.toHaveBeenCalled()
  })
})

describe('copyValue', () => {
  // Values that are not digests keep their unchecked copy: an empty or
  // non-hex value is still written and announced.
  it.each(['', 'case1/cap-a.mhtml'])('copies %j unchecked', async (value) => {
    await copyValue(value, 'relative path')

    expect(writeText).toHaveBeenCalledExactlyOnceWith(value)
    expect(notifySuccess).toHaveBeenCalledExactlyOnceWith('Copied relative path')
    expect(notifyWarn).not.toHaveBeenCalled()
  })
})
