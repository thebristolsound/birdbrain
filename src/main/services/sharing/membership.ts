import { join } from 'path'
import type { ManifestEntry } from '@shared/schemas'
import type { CaseMember } from '@shared/types'
import type { SharedCaseExclusion } from '@shared/verify'
import { suggestMemberCode } from '@shared/memberCode'
import { withTransaction } from '@main/services/db/core'
import { listCaseMembers, memberCodeProblem } from '@main/services/db/caseMemberRepo'
import { getCase, markCaseShared } from '@main/services/db/caseRepo'
import { getInstallationId } from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { getSettings } from '@main/services/settings'
import { ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { resolveToolVersion } from '@main/services/toolVersion'
import {
  readManifestSnapshot,
  readSharedCaseSnapshot,
  withManifestEntry,
  type ManifestEntryInput
} from '@main/services/manifest'
import { SharingError } from '@main/services/sharing/errors'
import {
  applyRosterEntries,
  currentSegment,
  rebuildRosterCache,
  writeRosterFiles
} from '@main/services/sharing/rosterCache'
import { storedEntries } from '@main/services/sharing/entryAcceptance'
import { isChainInstallationId } from '../../../packages/evidence-package-layout/index'

// The roster writers (#1810): the entries only the Owner writes, through the
// manifest's write-ahead seam so a failed cache write rolls the entry back.
// Every rule the verifier's `buildRoster` re-checks is held here at write
// time, and every refusal is a SharingError raised before anything is
// written. Before each write the cache is rebuilt from the own chain, so a
// stale `case_members` cannot lead to an entry the walk would refuse.

type MemberAddEntry = Extract<ManifestEntry, { type: 'member-add' }>

interface OwnerContext {
  caseId: string
  caseDir: string
  self: string
  operatorName: string
}

export interface JoiningMember {
  installationId: string
  publicKeyPem: string
  operatorName: string
  nodeId: string
  memberCode: string
}

// The operator gate every ingest passes (captureLifecycle.ts): a signed
// roster entry naming no operator would be a weaker record than any other
// entry this app writes.
function trimmedOperatorName(): string {
  const name = getSettings().operatorName?.trim() ?? ''
  if (name.length === 0) throw new SharingError('operator-name-required')
  return name
}

function ownEntries(caseDir: string): ManifestEntry[] {
  return storedEntries(readManifestSnapshot(caseDir).jsonl)
}

// The Owner's own `member-add` in the chain's current segment, when the Case
// is shared from this chain.
function ownerMemberAdd(entries: ManifestEntry[]): MemberAddEntry | undefined {
  return currentSegment(entries).find(
    (e): e is MemberAddEntry => e.type === 'member-add' && e.role === 'owner'
  )
}

function samePem(a: string, b: string): boolean {
  const normalize = (pem: string): string => pem.replace(/\r\n/g, '\n').trim()
  return normalize(a) === normalize(b)
}

function stamp(self: string, operatorName: string) {
  return {
    timestamp: new Date().toISOString(),
    operatorId: self,
    operatorName,
    toolVersion: resolveToolVersion()
  }
}

function caseOrThrow(caseId: string): NonNullable<ReturnType<typeof getCase>> {
  const row = getCase(caseId)
  if (!row) throw new Error(`Case not found: ${caseId}`)
  return row
}

// Owner only: the row says the Case is shared and names this installation,
// and the own chain's current segment opens its roster with this
// installation's `member-add` as `owner`. A member's installation refuses
// `not-owner`; a Case nobody shared, `not-shared`.
function assertOwner(caseId: string): OwnerContext {
  const row = caseOrThrow(caseId)
  const self = getInstallationId()
  if (row.sharedAt === undefined) throw new SharingError('not-shared')
  if (row.ownerInstallationId !== self) throw new SharingError('not-owner')
  const caseDir = join(getStorageRoot(), caseId)
  const owner = ownerMemberAdd(ownEntries(caseDir))
  if (owner === undefined || owner.memberInstallationId !== self) {
    throw new SharingError('not-owner')
  }
  return { caseId, caseDir, self, operatorName: trimmedOperatorName() }
}

function refreshCache({ caseId, caseDir, self }: OwnerContext): CaseMember[] {
  rebuildRosterCache({ caseId, caseDir, ownerEntries: ownEntries(caseDir), self })
  return listCaseMembers(caseId)
}

// Appends one roster entry with the cache rebuilt from the chain in the same
// write: the rows inside the manifest's callback and one transaction, so a
// failed row write rolls the entry back, and the files after both commit.
async function appendRosterEntry(
  ctx: OwnerContext,
  entry: ManifestEntryInput,
  inTransaction: () => void = () => {}
): Promise<number> {
  const { caseId, caseDir, self } = ctx
  const { index } = await withManifestEntry(caseDir, entry, (appended) => {
    withTransaction(() => {
      inTransaction()
      applyRosterEntries(caseId, ownEntries(caseDir))
    })
    return appended
  })
  writeRosterFiles({ caseId, caseDir, ownerEntries: ownEntries(caseDir), self })
  return index
}

export interface ShareCaseOptions {
  // The Owner's own Member Code; suggested from the Operator name when absent.
  ownerMemberCode?: string
  // This installation's transport node id, as the `member-add` records it.
  nodeId: string
}

// Makes a Case shared, run by the first invite: appends the Owner's own
// `member-add` and sets `shared_at` and `owner_installation_id`. A Case
// whose chain already holds the Owner's `member-add` gets nothing appended;
// a row left unset by a crash between the append and the row write is set.
export async function shareCase(caseId: string, options: ShareCaseOptions): Promise<CaseMember> {
  const row = caseOrThrow(caseId)
  const self = getInstallationId()
  const operatorName = trimmedOperatorName()
  if (row.sharedAt !== undefined && row.ownerInstallationId !== self) {
    throw new SharingError('not-owner')
  }
  // A Case with no Capture yet has no directory: ingest makes it, and so
  // does the first invite.
  const caseDir = ensureCaseDir(caseId)
  const existing = ownerMemberAdd(ownEntries(caseDir))
  if (existing !== undefined) {
    if (existing.memberInstallationId !== self) throw new SharingError('not-owner')
    withTransaction(() => {
      markCaseShared(caseId, self)
      applyRosterEntries(caseId, ownEntries(caseDir))
    })
    writeRosterFiles({ caseId, caseDir, ownerEntries: ownEntries(caseDir), self })
    return listCaseMembers(caseId).find((m) => m.installationId === self)!
  }
  const memberCode = options.ownerMemberCode ?? suggestMemberCode(operatorName, [])
  const problem = memberCodeProblem(caseId, memberCode, self)
  if (problem !== null) throw new SharingError('member-code-rejected', problem)
  const ctx: OwnerContext = { caseId, caseDir, self, operatorName }
  await appendRosterEntry(
    ctx,
    {
      type: 'member-add',
      caseId,
      memberInstallationId: self,
      memberPublicKeyPem: getPublicKeyPem(),
      memberCode,
      memberOperatorName: operatorName,
      nodeId: options.nodeId,
      role: 'owner',
      ...stamp(self, operatorName)
    },
    () => markCaseShared(caseId, self)
  )
  return listCaseMembers(caseId).find((m) => m.installationId === self)!
}

// Adds a member on approval of its join. An installation or key already on
// the roster, revoked or not, is `already-member`: the verifier defines no
// second `member-add` for one installation, and one key names one member.
export async function addMember(caseId: string, joiner: JoiningMember): Promise<CaseMember> {
  const ctx = assertOwner(caseId)
  const roster = refreshCache(ctx)
  if (!isChainInstallationId(joiner.installationId)) {
    throw new Error(
      `Installation id ${JSON.stringify(joiner.installationId)} cannot name a chain file`
    )
  }
  const held = roster.some(
    (m) =>
      m.installationId === joiner.installationId || samePem(m.publicKeyPem, joiner.publicKeyPem)
  )
  if (held) throw new SharingError('already-member')
  const problem = memberCodeProblem(caseId, joiner.memberCode, joiner.installationId)
  if (problem !== null) throw new SharingError('member-code-rejected', problem)
  await appendRosterEntry(ctx, {
    type: 'member-add',
    caseId,
    memberInstallationId: joiner.installationId,
    memberPublicKeyPem: joiner.publicKeyPem,
    memberCode: joiner.memberCode,
    memberOperatorName: joiner.operatorName,
    nodeId: joiner.nodeId,
    role: 'member',
    ...stamp(ctx.self, ctx.operatorName)
  })
  return listCaseMembers(caseId).find((m) => m.installationId === joiner.installationId)!
}

// Ends a member's participation. The listener re-reads the roster before
// every request (session.ts), so a session with that member ends at its next
// request.
export async function revokeMember(caseId: string, installationId: string): Promise<CaseMember> {
  const ctx = assertOwner(caseId)
  const member = refreshCache(ctx).find((m) => m.installationId === installationId)
  if (member === undefined) throw new SharingError('not-a-member')
  if (member.revokedAtIndex !== null) throw new SharingError('already-revoked')
  if (member.role === 'owner') throw new SharingError('owner-not-revocable')
  await appendRosterEntry(ctx, {
    type: 'member-revoke',
    caseId,
    memberInstallationId: installationId,
    ...stamp(ctx.self, ctx.operatorName)
  })
  return listCaseMembers(caseId).find((m) => m.installationId === installationId)!
}

// Marks an Exhibit excluded; exports still enclose it and list the exclusion
// (export.ts, reportHtml.ts). The author is found the way
// step 5 of the walk checks an exclusion: among the accepted entries of each
// current member chain, the one chain holding an `exhibit` with that id or a
// `capture` with that `captureId`. A revoked author's entries past the head
// the Owner merged before revoking it are not accepted, and an Exhibit only
// a failing chain holds has no accepted entries, so neither can be excluded.
// The Owner's own entries are read from the current segment: a fork's
// history belongs to its source Case.
export async function excludeExhibit(
  caseId: string,
  exhibitId: string,
  reason?: string
): Promise<SharedCaseExclusion> {
  const ctx = assertOwner(caseId)
  refreshCache(ctx)
  const walk = (): SharedCaseExclusion[] | undefined =>
    readSharedCaseSnapshot(ctx.caseDir, readManifestSnapshot(ctx.caseDir)).verification?.exclusions
  const { verification } = readSharedCaseSnapshot(ctx.caseDir, readManifestSnapshot(ctx.caseDir))
  if (verification === undefined) throw new SharingError('not-shared')
  const holds = (entry: ManifestEntry): boolean =>
    (entry.type === 'exhibit' && entry.exhibitId === exhibitId) ||
    (entry.type === 'capture' && entry.captureId === exhibitId)
  const holders = [...verification.entries]
    .filter(([key]) => !key.includes('/'))
    .filter(([key, entries]) => (key === ctx.self ? currentSegment(entries) : entries).some(holds))
    .map(([key]) => key)
  if (holders.length === 0) throw new SharingError('exhibit-not-found')
  if (holders.length > 1) throw new SharingError('exhibit-ambiguous')
  const excluded = verification.exclusions.some(
    (e) => e.sourceCaseId === undefined && e.exhibitId === exhibitId
  )
  if (excluded) throw new SharingError('already-excluded')
  const index = await appendRosterEntry(ctx, {
    type: 'exclude',
    caseId,
    exhibitId,
    authorInstallationId: holders[0],
    ...(reason !== undefined ? { reason } : {}),
    ...stamp(ctx.self, ctx.operatorName)
  })
  return walk()!.find((e) => e.index === index && e.sourceCaseId === undefined)!
}
