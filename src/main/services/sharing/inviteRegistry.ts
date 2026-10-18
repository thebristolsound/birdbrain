import { createHash, randomBytes, randomUUID } from 'crypto'
import { SharingError } from '@main/services/sharing/errors'
import { INVITE_LIFETIME_MS, INVITE_SECRET_BYTES } from '@main/services/sharing/invite'

// The open invites of this process (#1810), held in memory and nowhere else
// (plan question 5): an invite ends when the Owner's app quits, and a join
// that arrives after a restart is refused `invite-unknown`. The registry
// stores the SHA-256 of each secret, never the secret, so nothing in this
// process can reproduce an invite it handed out. A used, cancelled or
// expired record stays until the process exits, so a late join gets the
// named refusal rather than `invite-unknown`.

type InviteState = 'open' | 'used' | 'cancelled'

interface InviteRecord {
  inviteId: string
  caseId: string
  expiresAt: number
  state: InviteState
}

export interface OpenedInvite {
  inviteId: string
  secret: Uint8Array
  expiresAt: string
}

export interface OpenInvite {
  inviteId: string
  expiresAt: string
}

function secretHash(secret: Uint8Array): string {
  return createHash('sha256').update(secret).digest('hex')
}

export class InviteRegistry {
  private readonly bySecret = new Map<string, InviteRecord>()
  private readonly byId = new Map<string, InviteRecord>()

  // Draws a fresh secret for `caseId`, good for INVITE_LIFETIME_MS from now.
  open(caseId: string): OpenedInvite {
    const secret = randomBytes(INVITE_SECRET_BYTES)
    const record: InviteRecord = {
      inviteId: randomUUID(),
      caseId,
      expiresAt: Date.now() + INVITE_LIFETIME_MS,
      state: 'open'
    }
    this.bySecret.set(secretHash(secret), record)
    this.byId.set(record.inviteId, record)
    return {
      inviteId: record.inviteId,
      secret: Uint8Array.from(secret),
      expiresAt: new Date(record.expiresAt).toISOString()
    }
  }

  // Uses the invite the secret names, once. Checked in this order: a secret
  // never issued, or issued for another Case, is `invite-unknown`; then
  // cancelled, then reused, then expired. The caller verifies the join's
  // signature before claiming, so a join relayed through another node does
  // not use the invite up.
  claim(caseId: string, secret: Uint8Array): void {
    const record = this.bySecret.get(secretHash(secret))
    if (record === undefined || record.caseId !== caseId) {
      throw new SharingError('invite-unknown')
    }
    if (record.state === 'cancelled') throw new SharingError('invite-cancelled')
    if (record.state === 'used') throw new SharingError('invite-reused')
    if (Date.now() >= record.expiresAt) throw new SharingError('invite-expired')
    record.state = 'used'
  }

  // Ends an open invite. A join already pending from it stays pending until
  // the Owner approves or declines it.
  cancel(caseId: string, inviteId: string): void {
    const record = this.byId.get(inviteId)
    if (record === undefined || record.caseId !== caseId) {
      throw new SharingError('invite-not-found')
    }
    if (record.state === 'open') record.state = 'cancelled'
  }

  // The invites of a Case a join could still use: open and not yet expired.
  openInvites(caseId: string): OpenInvite[] {
    const now = Date.now()
    return [...this.byId.values()]
      .filter((r) => r.caseId === caseId && r.state === 'open' && r.expiresAt > now)
      .map(({ inviteId, expiresAt }) => ({
        inviteId,
        expiresAt: new Date(expiresAt).toISOString()
      }))
  }
}
