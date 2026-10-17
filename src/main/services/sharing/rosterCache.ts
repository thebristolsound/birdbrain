import type { ManifestEntry } from '@shared/schemas'
import { withTransaction } from '@main/services/db/core'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { ensureMemberChainFile } from '@main/services/manifest'
import { writeMembersFile } from '@main/services/sharing/syncState'
import { isChainInstallationId } from '../../../packages/evidence-package-layout/index'

// The roster cache of a Shared Case (#1810, moved from session.ts). Membership
// is the Owner's to write (sharedCase.ts), and `case_members` is the cache of
// what the Owner's chain states: derived, never authoritative, rebuilt from
// the chain (the design's "Case directory"). The Owner rebuilds it after each
// roster write from its own chain; a member rebuilds it every session from the
// Owner's chain as stored, which is how it learns who joined or was revoked
// after it did.
//
// Only the chain's current segment is read: the entries at or after its last
// `import`, the way the verifier's `currentSegment` reads a roster. A fork
// continues its source Owner's chain behind an `import`, so reading the whole
// chain on a fork shared again would add the source Case's members to the new
// roster, and a source Member Code equal to a new one would fail every write.
//
// Idempotent: a member already held is not added again and a revocation
// already held is kept, so it runs over the whole segment every time, and a
// line an earlier run left unapplied is applied by the next. A member-add
// whose id cannot name a chain file is refused and returned; a write that
// fails throws, so the caller fails and the next run retries from the file.

export interface RosterCacheParams {
  caseId: string
  caseDir: string
  // The Owner's chain as this replica holds it: its own manifest on the
  // Owner, the stored member chain elsewhere.
  ownerEntries: ManifestEntry[]
  // This installation, which keeps no chain file for itself.
  self: string
}

// The entries of this Case: from the chain's last `import` on, or all of them.
export function currentSegment(entries: ManifestEntry[]): ManifestEntry[] {
  let cut = 0
  for (const entry of entries) if (entry.type === 'import') cut = entry.index
  return entries.filter((entry) => entry.index >= cut)
}

// The database half: applies every membership entry of the current segment
// to `case_members`. The caller runs it inside a transaction, beside any
// other row the same write owns.
export function applyRosterEntries(caseId: string, ownerEntries: ManifestEntry[]): string[] {
  const refused: string[] = []
  for (const entry of currentSegment(ownerEntries)) {
    if (entry.type !== 'member-add' && entry.type !== 'member-revoke') continue
    // The id names that member's chain file on every replica; one that is
    // not a single path segment is refused here rather than written to.
    if (!isChainInstallationId(entry.memberInstallationId)) {
      refused.push(
        `${entry.type} at index ${entry.index}: installation id ${JSON.stringify(entry.memberInstallationId)} cannot name a chain file`
      )
      continue
    }
    const existing = listCaseMembers(caseId).find(
      (m) => m.installationId === entry.memberInstallationId
    )
    if (entry.type === 'member-add' && !existing) {
      upsertCaseMember({
        caseId,
        installationId: entry.memberInstallationId,
        publicKeyPem: entry.memberPublicKeyPem,
        memberCode: entry.memberCode,
        operatorName: entry.memberOperatorName,
        nodeId: entry.nodeId,
        role: entry.role,
        addedAtIndex: entry.index,
        revokedAtIndex: null
      })
    } else if (entry.type === 'member-revoke' && existing && existing.revokedAtIndex === null) {
      upsertCaseMember({ ...existing, revokedAtIndex: entry.index })
    }
  }
  return refused
}

// The file half, after the rows commit: a chain file for every member in
// good standing other than this installation, empty until that member's
// entries arrive (ensureMemberChainFile), then `members.json`. The files come
// after the commit so a rolled-back `member-add` never leaves a chain file
// for an installation the roster does not name, which the walk would report
// as `unknown-member`. No file is made while this replica holds no roster
// from the chain: a joiner before its first session would otherwise hold an
// empty Owner chain, which reads as a chain of nobody.
export function writeRosterFiles(params: RosterCacheParams): void {
  const { caseId, caseDir, ownerEntries, self } = params
  const stated = currentSegment(ownerEntries).some((entry) => entry.type === 'member-add')
  if (stated) {
    for (const member of listCaseMembers(caseId)) {
      if (member.installationId === self || member.revokedAtIndex !== null) continue
      if (!isChainInstallationId(member.installationId)) continue
      ensureMemberChainFile(caseDir, member.installationId)
    }
  }
  writeMembersFile(caseId)
}

export function rebuildRosterCache(params: RosterCacheParams): string[] {
  const refused = withTransaction(() => applyRosterEntries(params.caseId, params.ownerEntries))
  writeRosterFiles(params)
  return refused
}
