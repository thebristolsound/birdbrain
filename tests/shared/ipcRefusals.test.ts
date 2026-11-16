import { describe, expect, expectTypeOf, it } from 'vitest'
import { IPC_CHANNELS, IPC_REFUSALS, refusalCode, type RefusalCode } from '@shared/ipc'
import { SHARING_ERROR_CODES, type SharingErrorCode } from '@shared/types'

// The contract's refusal table: the codes a channel's callers may branch on,
// and the reader that reports only those.

const coded = (code: unknown): Error => Object.assign(new Error('refused'), { code })

describe('IPC_REFUSALS', () => {
  it('names codes only for invoke channels the contract declares', () => {
    const invokeChannels = new Set<string>(
      Object.values(IPC_CHANNELS).filter((channel) => !channel.startsWith('event:'))
    )
    for (const channel of Object.keys(IPC_REFUSALS)) {
      expect(invokeChannels.has(channel), channel).toBe(true)
    }
  })

  it('names each code once per channel, and at least one', () => {
    for (const [channel, codes] of Object.entries(IPC_REFUSALS)) {
      expect(codes.length, channel).toBeGreaterThan(0)
      expect(new Set(codes).size, channel).toBe(codes.length)
    }
  })

  it('names the sharing vocabulary on every sharing channel', () => {
    const sharingChannels = Object.values(IPC_CHANNELS).filter((channel) =>
      channel.startsWith('sharing:')
    )
    expect(sharingChannels).toHaveLength(13)
    for (const channel of sharingChannels) {
      expect(IPC_REFUSALS[channel as keyof typeof IPC_REFUSALS], channel).toBe(SHARING_ERROR_CODES)
    }
    expectTypeOf<RefusalCode<'sharing:join'>>().toEqualTypeOf<SharingErrorCode>()
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
    expect(refusalCode(coded('invite-expired'), 'sharing:readInvite')).toBe('invite-expired')
  })

  it('reports nothing for a code the channel does not name', () => {
    // Another channel's code, and a database code that any channel can carry.
    expect(refusalCode(coded('BROWSER_NOT_FOUND'), 'persona:import')).toBeUndefined()
    expect(refusalCode(coded('SQLITE_BUSY'), 'persona:import')).toBeUndefined()
    expect(refusalCode(coded('invite-expired'), 'launchedBrowser:launch')).toBeUndefined()
  })

  it('reports nothing for a rejection that carries no string code', () => {
    expect(refusalCode(new Error('disk full'), 'persona:import')).toBeUndefined()
    expect(refusalCode(coded(7), 'persona:import')).toBeUndefined()
    expect(refusalCode(null, 'persona:import')).toBeUndefined()
    expect(refusalCode('PERSONA_COOKIE_FILE_UNSUPPORTED', 'persona:import')).toBeUndefined()
  })
})
