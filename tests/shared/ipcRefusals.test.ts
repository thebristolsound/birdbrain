import { describe, expect, expectTypeOf, it } from 'vitest'
import { IPC_REFUSALS, refusalCode } from '@shared/ipc'

// The contract's refusal table: the codes a channel's callers read through
// refusalCode, which reports only those.

const coded = (code: unknown): Error => Object.assign(new Error('refused'), { code })

describe('IPC_REFUSALS', () => {
  it('names each code once per channel, and at least one', () => {
    for (const [channel, codes] of Object.entries(IPC_REFUSALS)) {
      expect(codes.length, channel).toBeGreaterThan(0)
      expect(new Set(codes).size, channel).toBe(codes.length)
    }
  })
})

describe('refusalCode', () => {
  it('reports a code the channel names, typed as that channel names it', () => {
    const code = refusalCode(coded('PERSONA_COOKIE_FILE_UNSUPPORTED'), 'persona:import')
    expect(code).toBe('PERSONA_COOKIE_FILE_UNSUPPORTED')
    expectTypeOf(code).toEqualTypeOf<'PERSONA_COOKIE_FILE_UNSUPPORTED' | undefined>()
    expect(refusalCode(coded('BROWSER_LAUNCH_CANCELLED'), 'launchedBrowser:launch')).toBe(
      'BROWSER_LAUNCH_CANCELLED'
    )
  })

  it('reports nothing for a code the channel does not name', () => {
    // Another channel's code, and a database code that any channel can carry.
    expect(refusalCode(coded('BROWSER_NOT_FOUND'), 'persona:import')).toBeUndefined()
    expect(refusalCode(coded('SQLITE_BUSY'), 'persona:import')).toBeUndefined()
    expect(
      refusalCode(coded('PERSONA_COOKIE_FILE_UNSUPPORTED'), 'launchedBrowser:launch')
    ).toBeUndefined()
  })

  it('reports nothing for a rejection that carries no string code', () => {
    expect(refusalCode(new Error('disk full'), 'persona:import')).toBeUndefined()
    expect(refusalCode(coded(7), 'persona:import')).toBeUndefined()
    expect(refusalCode(null, 'persona:import')).toBeUndefined()
    expect(refusalCode('PERSONA_COOKIE_FILE_UNSUPPORTED', 'persona:import')).toBeUndefined()
  })
})
