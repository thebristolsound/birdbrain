import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { fakeBridge } from '../fakeBridge'
import {
  ContactStoppedError,
  confirmContact,
  requireContact,
  settleVpnWarning,
  useVpnWarningStore,
  type VpnWarningOutcome
} from '@renderer/lib/vpnWarning'
import type { VpnWarningCheck, VpnWarningTarget } from '@shared/ipc'

let checkVpnWarning: Mock<(target: VpnWarningTarget) => Promise<VpnWarningCheck>>
let answerVpnWarning: Mock<() => Promise<void>>

// Main's answer for a Case not yet warned. A Wayback lookup names its Capture, whose Case
// main resolves; here every Capture belongs to case-a.
function warns(canMute = true) {
  return vi.fn(async (target: VpnWarningTarget) => ({
    caseId: 'caseId' in target ? target.caseId : 'case-a',
    warn: true,
    canMute
  }))
}

// Resolves once the warning is up, then answers it.
async function answer(outcome: VpnWarningOutcome): Promise<void> {
  await vi.waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
  settleVpnWarning(outcome)
}

beforeEach(() => {
  useVpnWarningStore.setState({ open: false, request: null, settle: null })
  checkVpnWarning = warns()
  answerVpnWarning = vi.fn(async () => undefined)
  fakeBridge({ egress: { checkVpnWarning, answerVpnWarning } })
})

describe('confirmContact', () => {
  it('lets the contact go ahead without asking when main says no warning is due', async () => {
    checkVpnWarning.mockResolvedValueOnce({ caseId: 'case-a', warn: false, canMute: false })
    expect(await confirmContact({ caseId: 'case-a' }, 'site')).toBe(true)
    expect(useVpnWarningStore.getState().open).toBe(false)
    expect(answerVpnWarning).not.toHaveBeenCalled()
  })

  it.each(['continue', 'mute-network'] as const)(
    'goes ahead on %s and reports the choice to main',
    async (outcome) => {
      const pending = confirmContact({ captureId: 'cap-1' }, 'site')
      await answer(outcome)
      expect(await pending).toBe(true)
      expect(answerVpnWarning).toHaveBeenCalledWith({ caseId: 'case-a', choice: outcome })
    }
  )

  it.each(['set-up-proxy', 'dismiss'] as const)(
    'stops on %s and leaves the Case unwarned',
    async (outcome) => {
      const pending = confirmContact({ caseId: 'case-a' }, 'site')
      await answer(outcome)
      expect(await pending).toBe(false)
      expect(answerVpnWarning).not.toHaveBeenCalled()
    }
  )

  it('carries the occasion and whether the network can be muted to the dialog', async () => {
    checkVpnWarning = warns(false)
    fakeBridge({ egress: { checkVpnWarning, answerVpnWarning } })
    const pending = confirmContact({ caseId: 'case-a' }, 'session')
    await vi.waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    expect(useVpnWarningStore.getState().request).toEqual({ occasion: 'session', canMute: false })
    settleVpnWarning('continue')
    await pending
    // Kept for the exit animation.
    expect(useVpnWarningStore.getState()).toMatchObject({
      open: false,
      request: { occasion: 'session' }
    })
  })

  it('asks one warning at a time, checking the next only after the first is answered', async () => {
    const first = confirmContact({ caseId: 'case-a' }, 'site')
    const second = confirmContact({ caseId: 'case-b' }, 'site')
    await vi.waitFor(() => expect(useVpnWarningStore.getState().open).toBe(true))
    expect(checkVpnWarning).toHaveBeenCalledTimes(1)
    settleVpnWarning('continue')
    expect(await first).toBe(true)
    await answer('dismiss')
    expect(await second).toBe(false)
    expect(checkVpnWarning).toHaveBeenCalledTimes(2)
  })

  it('rejects when the check fails, and the next contact is still asked', async () => {
    checkVpnWarning.mockRejectedValueOnce(new Error('Capture not found'))
    await expect(confirmContact({ captureId: 'gone' }, 'site')).rejects.toThrow('Capture not found')
    const next = confirmContact({ caseId: 'case-a' }, 'site')
    await answer('continue')
    expect(await next).toBe(true)
  })
})

describe('requireContact', () => {
  it('throws ContactStoppedError when the Operator stops at the warning', async () => {
    const pending = requireContact({ caseId: 'case-a' }, 'site')
    await answer('dismiss')
    const error = await pending.catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ContactStoppedError)
    expect((error as Error).message).toBe('Nothing was sent.')
  })

  it('resolves when the contact may go ahead', async () => {
    const pending = requireContact({ caseId: 'case-a' }, 'site')
    await answer('continue')
    await expect(pending).resolves.toBeUndefined()
  })
})

describe('settleVpnWarning', () => {
  it('closes the warning even when nothing is waiting on it', () => {
    useVpnWarningStore.setState({ open: true, request: null, settle: null })
    settleVpnWarning('dismiss')
    expect(useVpnWarningStore.getState().open).toBe(false)
  })
})
