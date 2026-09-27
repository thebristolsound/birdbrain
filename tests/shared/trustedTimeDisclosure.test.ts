import { describe, it, expect } from 'vitest'
import {
  TRUSTED_TIME_AUTHORITY_NOT_CONTACTED,
  TRUSTED_TIME_LABELS,
  TRUSTED_TIME_UNNAMED_TSA,
  trustedTimeAttestingParty,
  trustedTimeLabel
} from '@shared/trustedTimeDisclosure'
import type { TrustedTime } from '@shared/types'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'

const AXES: TrustedTime[] = ['rfc3161', 'pending', 'none']

describe('trusted-time disclosure vocabulary (#519)', () => {
  it('gives every axis value a label no other value is a prefix of', () => {
    // 'pending' and 'none' must not share a leading phrase: an operator reading
    // the start of either row has to be able to tell them apart.
    for (const a of AXES) {
      for (const b of AXES) {
        if (a === b) continue
        expect(TRUSTED_TIME_LABELS[a].startsWith(TRUSTED_TIME_LABELS[b])).toBe(false)
      }
    }
  })

  it('maps each resolved axis to its label, and an unknown axis to the local-clock floor', () => {
    for (const axis of AXES) {
      expect(trustedTimeLabel({ trustedTime: axis })).toBe(TRUSTED_TIME_LABELS[axis])
    }
    // resolveTrustedTime never emits anything else, but a widened union or a
    // hand-built result must still fall to the floor rather than to nothing.
    const unknown = { trustedTime: 'bogus' } as unknown as TrustedTimeResult
    expect(trustedTimeLabel(unknown)).toBe(TRUSTED_TIME_LABELS.none)
  })

  it('names the TSA from the token when it carries one', () => {
    expect(trustedTimeAttestingParty({ trustedTime: 'rfc3161', tsaName: 'tsa.example.net' })).toBe(
      'tsa.example.net'
    )
  })

  it('does not name the local configuration when the token carries no TSA identity', () => {
    // The token may have come from another install (archive import) or from an
    // authority this install no longer points at, so the fallback must say the
    // identity is unrecorded rather than assert who signed it.
    const who = trustedTimeAttestingParty({ trustedTime: 'rfc3161' })
    expect(who).toBe(TRUSTED_TIME_UNNAMED_TSA)
    expect(who).toContain('not recorded in the retained token')
    expect(who).not.toContain('configured')
  })

  // #1169. The not-contacted note sits under the endpoint in the packaged
  // documents' configured-authority field, so it has to be a statement about this
  // installation's configuration and nothing else. A package can hold tokens
  // obtained before the operator switched timestamping off, so any claim here
  // about what was or was not submitted would be false for that package.
  it('says only that the installation switched it off, never what was submitted', () => {
    expect(TRUSTED_TIME_AUTHORITY_NOT_CONTACTED).toContain('switched off for this installation')
    expect(TRUSTED_TIME_AUTHORITY_NOT_CONTACTED).not.toMatch(/submitted|sent|requested|no capture/i)
    // The note carries no identity of its own; the endpoint above it is the only
    // authority the field names.
    expect(TRUSTED_TIME_AUTHORITY_NOT_CONTACTED).not.toMatch(/https?:/)
    // It must not read as a denial that an authority is configured — the same
    // document's verification section sends the reader to that authority for a
    // trust anchor (#1169 round-2 review).
    expect(TRUSTED_TIME_AUTHORITY_NOT_CONTACTED).not.toMatch(/^none\b/i)
  })

  // #1169 fix round. These labels are resolved from the manifest alone, which
  // records tokens rather than requests and carries no record of whether the
  // installation had timestamping switched on. 'Local clock — token pending'
  // therefore told every reader of a declined installation's export that a token
  // was on its way from an authority that was never contacted.
  it('states what the manifest holds, never that a token is on its way', () => {
    for (const axis of AXES) {
      expect(TRUSTED_TIME_LABELS[axis]).not.toMatch(/pending|awaiting|requested|in progress/i)
    }
  })
})
