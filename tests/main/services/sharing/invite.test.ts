import { describe, it, expect } from 'vitest'
import { encode } from 'cborg'
import { encodeBase32 } from '@main/services/sharing/base32'
import { SharingError } from '@main/services/sharing/errors'
import {
  INVITE_PREFIX,
  INVITE_SECRET_BYTES,
  decodeInvite,
  encodeInvite,
  type InviteFields
} from '@main/services/sharing/invite'

// The `bbinvite1` string (#1810): an invite decodes back to the fields it was
// made from, in either case and however it was pasted, and anything else is
// `invite-malformed`.

const FIELDS: InviteFields = {
  ticket: 'mem:owner-node',
  caseId: '0196f7a2-aaaa-bbbb-cccc-000000000010',
  operatorName: 'Alice Owner',
  secret: Uint8Array.from({ length: INVITE_SECRET_BYTES }, (_, i) => i * 7),
  expiresAt: '2026-10-18T09:00:00.000Z'
}

const malformed = (text: string): void => {
  let caught: unknown
  try {
    decodeInvite(text)
  } catch (err) {
    caught = err
  }
  expect(caught).toBeInstanceOf(SharingError)
  expect((caught as SharingError).code).toBe('invite-malformed')
}

describe('invite string', () => {
  it('round-trips the fields, with the prefix and lower-case base32', () => {
    const invite = encodeInvite(FIELDS)
    expect(invite.startsWith(INVITE_PREFIX)).toBe(true)
    expect(invite.slice(INVITE_PREFIX.length)).toMatch(/^[a-z2-7]+$/)
    expect(decodeInvite(invite)).toEqual(FIELDS)
  })

  it('decodes the upper-case form, and a pasted string with whitespace and line breaks', () => {
    const invite = encodeInvite(FIELDS)
    expect(decodeInvite(invite.toUpperCase())).toEqual(FIELDS)
    const wrapped = `  ${invite.slice(0, 40)}\n${invite.slice(40, 120)}\r\n${invite.slice(120)}  \n`
    expect(decodeInvite(wrapped)).toEqual(FIELDS)
  })

  it('refuses a wrong prefix, a truncated string and text that is not base32', () => {
    const invite = encodeInvite(FIELDS)
    malformed('bbinvite2' + invite.slice(INVITE_PREFIX.length))
    malformed(invite.slice(1))
    malformed(invite.slice(0, -10))
    malformed(INVITE_PREFIX + 'not base32!')
    malformed('')
    malformed(INVITE_PREFIX + 'a'.repeat(9000))
  })

  it('refuses a map with an extra key, a missing key, a 15-byte secret, a bad expiry or Case id', () => {
    const as = (map: Record<string, unknown>): string =>
      INVITE_PREFIX + encodeBase32(encode(map)).toLowerCase()
    malformed(as({ ...FIELDS, extra: 1 }))
    const noTicket: Record<string, unknown> = { ...FIELDS }
    delete noTicket.ticket
    malformed(as(noTicket))
    malformed(as({ ...FIELDS, secret: FIELDS.secret.subarray(0, 15) }))
    malformed(as({ ...FIELDS, secret: 'text' }))
    malformed(as({ ...FIELDS, expiresAt: 'tomorrow' }))
    malformed(as({ ...FIELDS, ticket: '' }))
    malformed(as({ ...FIELDS, ticket: 'x'.repeat(3000) }))
    // A Case id names the joiner's Case directory (#1913 review).
    malformed(as({ ...FIELDS, caseId: '../escaped' }))
    malformed(as({ ...FIELDS, caseId: FIELDS.caseId.toUpperCase() }))
    malformed(INVITE_PREFIX + encodeBase32(encode([1, 2, 3])).toLowerCase())
  })

  it('refuses to encode a secret of the wrong length or a Case id the app does not mint', () => {
    expect(() => encodeInvite({ ...FIELDS, secret: new Uint8Array(8) })).toThrow()
    expect(() => encodeInvite({ ...FIELDS, caseId: '../escaped' })).toThrow()
  })
})
