import { decode, encode } from 'cborg'
import { z } from 'zod'
import { decodeBase32, encodeBase32 } from '@main/services/sharing/base32'
import { SharingError } from '@main/services/sharing/errors'

// The invite string (docs/specs/2026-09-19-collaborative-cases-design.md,
// "Invite and join"): `bbinvite1` followed by base32 of a CBOR map holding
// the Owner's transport ticket, the Case id, the Owner's Operator name, a
// one-time secret and an expiry. The ticket is opaque here: `Transport.ticket`
// produces it and `Transport.dial` consumes it, and nothing in between reads
// inside it (ruling 74: a ticket names the node id and relay URL, never a
// direct address). Decoding is a trust boundary, so the map is parsed against
// a strict schema with a length bound on every string, as `decodeMessage`
// treats a frame.

export const INVITE_PREFIX = 'bbinvite1'
export const INVITE_SECRET_BYTES = 16
export const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000

// Bounds on what a pasted string can make the app hold. A relay-only Iroh
// ticket is about 120 characters; the margin is for a longer relay URL.
const MAX_TICKET_CHARS = 2048
const MAX_CASE_ID_CHARS = 128
const MAX_OPERATOR_NAME_CHARS = 256
const MAX_TIMESTAMP_CHARS = 64
const MAX_INVITE_CHARS = INVITE_PREFIX.length + 8192

export interface InviteFields {
  ticket: string
  caseId: string
  operatorName: string
  secret: Uint8Array
  // ISO 8601 UTC.
  expiresAt: string
}

const bytesField = z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'expected bytes')

const InviteSchema = z
  .object({
    ticket: z.string().min(1).max(MAX_TICKET_CHARS),
    caseId: z.string().min(1).max(MAX_CASE_ID_CHARS),
    operatorName: z.string().max(MAX_OPERATOR_NAME_CHARS),
    secret: bytesField.refine((b) => b.length === INVITE_SECRET_BYTES, {
      message: `secret must be ${INVITE_SECRET_BYTES} bytes`
    }),
    expiresAt: z
      .string()
      .max(MAX_TIMESTAMP_CHARS)
      .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'expiresAt must be a timestamp' })
  })
  .strict()

export function encodeInvite(fields: InviteFields): string {
  const { ticket, caseId, operatorName, secret, expiresAt } = InviteSchema.parse(fields)
  const map = encode({ ticket, caseId, operatorName, secret, expiresAt })
  // Lower case for the string the Operator copies; SC-8 upper-cases it for the
  // QR code, which alphanumeric mode encodes in fewer modules, and both forms
  // decode alike.
  return INVITE_PREFIX + encodeBase32(map).toLowerCase()
}

// Decodes a pasted invite. Whitespace anywhere is dropped, since a pasted
// string may have wrapped; the prefix is accepted in either case.
export function decodeInvite(text: string): InviteFields {
  const compact = text.replace(/\s+/g, '')
  if (compact.length > MAX_INVITE_CHARS) throw new SharingError('invite-malformed')
  if (compact.slice(0, INVITE_PREFIX.length).toLowerCase() !== INVITE_PREFIX) {
    throw new SharingError('invite-malformed', 'Not a Birdbrain invite')
  }
  let raw: unknown
  try {
    raw = decode(decodeBase32(compact.slice(INVITE_PREFIX.length)))
  } catch (err) {
    throw new SharingError('invite-malformed', (err as Error).message)
  }
  const parsed = InviteSchema.safeParse(raw)
  if (!parsed.success) throw new SharingError('invite-malformed', 'Malformed invite')
  return parsed.data
}
