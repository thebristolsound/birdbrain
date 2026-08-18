import { describe, it, expect } from 'vitest'
import {
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
})
