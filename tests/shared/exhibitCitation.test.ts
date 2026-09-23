import { describe, it, expect } from 'vitest'
import { formatExhibitCitation } from '@shared/exhibitCitation'

// Decision 7 of the Shared Cases design: `<Member Code>-<n>` when prefixed
// and a code is known, bare `n` in every other case. The caller decides
// whether to prefix; this decides only how.

describe('formatExhibitCitation', () => {
  it('prefixes with the Member Code when asked and one is known', () => {
    expect(formatExhibitCitation({ exhibitNumber: 12, memberCode: 'NK' }, { prefixed: true })).toBe(
      'NK-12'
    )
  })

  it('cites bare when the caller hides the prefix', () => {
    expect(
      formatExhibitCitation({ exhibitNumber: 12, memberCode: 'NK' }, { prefixed: false })
    ).toBe('12')
  })

  it('cites bare when no code was recorded, whatever the caller asked', () => {
    expect(formatExhibitCitation({ exhibitNumber: 7, memberCode: null }, { prefixed: true })).toBe(
      '7'
    )
    expect(formatExhibitCitation({ exhibitNumber: 7 }, { prefixed: true })).toBe('7')
    expect(formatExhibitCitation({ exhibitNumber: 7, memberCode: '' }, { prefixed: true })).toBe(
      '7'
    )
  })
})
