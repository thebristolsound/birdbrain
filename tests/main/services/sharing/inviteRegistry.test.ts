import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SharingError } from '@main/services/sharing/errors'
import { INVITE_LIFETIME_MS, INVITE_SECRET_BYTES } from '@main/services/sharing/invite'
import { InviteRegistry } from '@main/services/sharing/inviteRegistry'

// The in-memory invite registry (#1810): one claim per secret, the named
// refusal for every other claim, and a 24-hour life measured on this clock.

const CASE_A = 'case-a'
const CASE_B = 'case-b'
const START = new Date('2026-10-17T09:00:00.000Z')

function refusal(run: () => void): string {
  try {
    run()
  } catch (err) {
    if (err instanceof SharingError) return err.code
    throw err
  }
  throw new Error('expected a SharingError')
}

describe('invite registry', () => {
  let registry: InviteRegistry

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START)
    registry = new InviteRegistry()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens an invite with a fresh secret and a 24-hour expiry, and claims it once', () => {
    const { inviteId, secret, expiresAt } = registry.open(CASE_A)
    expect(secret).toHaveLength(INVITE_SECRET_BYTES)
    expect(expiresAt).toBe(new Date(START.getTime() + INVITE_LIFETIME_MS).toISOString())
    expect(registry.openInvites(CASE_A)).toEqual([{ inviteId, expiresAt }])
    expect(registry.openInvites(CASE_B)).toEqual([])
    const other = registry.open(CASE_A)
    expect(other.secret).not.toEqual(secret)
    expect(other.inviteId).not.toBe(inviteId)

    registry.claim(CASE_A, secret)
    expect(registry.openInvites(CASE_A).map((i) => i.inviteId)).toEqual([other.inviteId])
    expect(refusal(() => registry.claim(CASE_A, secret))).toBe('invite-reused')
  })

  it('refuses a secret it never issued, and one issued for another Case', () => {
    const { secret } = registry.open(CASE_A)
    expect(refusal(() => registry.claim(CASE_A, new Uint8Array(INVITE_SECRET_BYTES)))).toBe(
      'invite-unknown'
    )
    expect(refusal(() => registry.claim(CASE_B, secret))).toBe('invite-unknown')
    // Neither refusal used the invite up.
    registry.claim(CASE_A, secret)
  })

  it('refuses a cancelled invite, and cancel refuses an id it does not hold', () => {
    const { inviteId, secret } = registry.open(CASE_A)
    expect(refusal(() => registry.cancel(CASE_A, 'nope'))).toBe('invite-not-found')
    expect(refusal(() => registry.cancel(CASE_B, inviteId))).toBe('invite-not-found')
    registry.cancel(CASE_A, inviteId)
    expect(registry.openInvites(CASE_A)).toEqual([])
    expect(refusal(() => registry.claim(CASE_A, secret))).toBe('invite-cancelled')
    // Cancelling again, or cancelling a used one, changes nothing.
    registry.cancel(CASE_A, inviteId)
    const used = registry.open(CASE_A)
    registry.claim(CASE_A, used.secret)
    registry.cancel(CASE_A, used.inviteId)
    expect(refusal(() => registry.claim(CASE_A, used.secret))).toBe('invite-reused')
  })

  it('accepts a claim one millisecond before the 24-hour mark and refuses one at it', () => {
    const early = registry.open(CASE_A)
    const late = registry.open(CASE_A)
    vi.setSystemTime(new Date(START.getTime() + INVITE_LIFETIME_MS - 1))
    expect(registry.openInvites(CASE_A)).toHaveLength(2)
    registry.claim(CASE_A, early.secret)
    vi.setSystemTime(new Date(START.getTime() + INVITE_LIFETIME_MS))
    expect(registry.openInvites(CASE_A)).toEqual([])
    expect(refusal(() => registry.claim(CASE_A, late.secret))).toBe('invite-expired')
    // The record stays, so a later claim is still named, never unknown.
    vi.setSystemTime(new Date(START.getTime() + 3 * INVITE_LIFETIME_MS))
    expect(refusal(() => registry.claim(CASE_A, late.secret))).toBe('invite-expired')
    expect(refusal(() => registry.claim(CASE_A, early.secret))).toBe('invite-reused')
  })
})
