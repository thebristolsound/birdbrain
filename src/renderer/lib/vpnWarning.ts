import { create } from 'zustand'
import type { VpnWarningOccasion, VpnWarningTarget } from '@shared/ipc'

// The warning before a Case's first contact with a site while the Egress is Direct and a VPN
// is not seen (ADR-0032 rule 2). Main decides whether to warn; this asks the Operator through
// the one VpnWarningDialog mounted at the root, and reports whether the contact may go ahead.

export type VpnWarningOutcome = 'continue' | 'mute-network' | 'set-up-proxy' | 'dismiss'

export interface VpnWarningRequest {
  occasion: VpnWarningOccasion
  canMute: boolean
}

interface VpnWarningState {
  open: boolean
  // Kept after the warning closes, so its text stays put during the exit animation.
  request: VpnWarningRequest | null
  settle: ((outcome: VpnWarningOutcome) => void) | null
}

export const useVpnWarningStore = create<VpnWarningState>(() => ({
  open: false,
  request: null,
  settle: null
}))

export function settleVpnWarning(outcome: VpnWarningOutcome): void {
  const { settle } = useVpnWarningStore.getState()
  useVpnWarningStore.setState({ open: false, settle: null })
  settle?.(outcome)
}

/** Thrown in place of a contact the Operator stopped at the warning. Nothing was sent. */
export class ContactStoppedError extends Error {
  constructor() {
    super('Nothing was sent.')
    this.name = 'ContactStoppedError'
  }
}

// One warning at a time. A contact that waited behind a warning for the same Case is asked
// about again after it, and main answers that the Case was already warned.
let queue: Promise<unknown> = Promise.resolve()

async function ask(target: VpnWarningTarget, occasion: VpnWarningOccasion): Promise<boolean> {
  const { caseId, warn, canMute } = await window.birdbrain.egress.checkVpnWarning(target, occasion)
  if (!warn) return true
  const outcome = await new Promise<VpnWarningOutcome>((settle) => {
    useVpnWarningStore.setState({ open: true, request: { occasion, canMute }, settle })
  })
  if (outcome !== 'continue' && outcome !== 'mute-network') return false
  await window.birdbrain.egress.answerVpnWarning({ caseId, occasion, choice: outcome })
  return true
}

/** Whether a contact may go ahead: true when no warning was due or the Operator continued. */
export function confirmContact(
  target: VpnWarningTarget,
  occasion: VpnWarningOccasion
): Promise<boolean> {
  const turn = queue.then(() => ask(target, occasion))
  queue = turn.catch(() => undefined)
  return turn
}

/** confirmContact for a mutation or query: throws ContactStoppedError when stopped. */
export async function requireContact(
  target: VpnWarningTarget,
  occasion: VpnWarningOccasion
): Promise<void> {
  if (!(await confirmContact(target, occasion))) throw new ContactStoppedError()
}
