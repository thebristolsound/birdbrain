import { ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { verifyManifestChainText } from '@shared/verify/manifestChain'
import type { ChainVerifyResult, UnsupportedEntry } from '@shared/verify/manifestChain'

// Shared Case verification (docs/specs/2026-09-19-collaborative-cases-design.md,
// "Verification"). A Shared Case is one chain per member installation plus
// `merge` entries naming other members' heads. `verifyManifestChainText` is
// unchanged and verifies each chain on its own; this is the layer above it:
//
//   1. verify the Owner's chain under the key the caller trusts, and build the
//      roster from its `member-add` and `member-revoke` entries in chain order;
//   2. verify each remote chain under the key its `member-add` carries, and
//      report an entry a revoked member wrote after its revocation;
//   3. check that every `merge` head names an entry that exists, at that index
//      with that hash, in that member's chain;
//   4. resolve every Exhibit citation to `<memberCode>-<exhibitNumber>` and
//      report one that resolves to two entries, except a number one chain
//      assigns to two Exhibits: that is an Integrity Exception, found per
//      chain by `findRepeatedExhibitNumbers` and never a failed walk (X48);
//   5. check that every `exclude` names an Exhibit its stated author holds.
//
// Along the way: every chain's current entries must name the Owner's Case, no
// two members share a key, and every member the Owner could hold a chain for
// has one supplied.
//
// LINEAGE. An `import` ends a roster. A fork continues the source Owner's
// chain behind an `import` naming that Owner's key, so the roster is read from
// the entries at or after the Owner chain's last `import`, and the entries
// before it are verified as the source Shared Case in their own right: under
// the key the `import` names, with the source Case's other member chains
// supplied as lineage. A fork of a fork repeats this once per `import`.
//
// What this proves: each member's chain was not edited without that member's
// key; each `merge` names chain states that exist; a citation resolves to one
// entry, or to Exhibits its own chain numbered twice, which step 4 leaves to the
// X48 report. What it does not prove: that a member's key was not misused by
// whoever holds that machine, or that a member's TSA is honest.
//
// TRUST ANCHOR. The only key the caller hands over is the Owner's. Every other
// key is read from a `member-add` entry in the Owner's chain, which has verified
// under the Owner's key before it is read, so no remote chain is ever verified
// under a key an unverified line supplied.
//
// REVOCATION. "After" is not a timestamp: a revoked member can write any
// timestamp it likes. The accepted history of a revoked member is what the
// Owner merged before revoking it — the highest head index the Owner's own
// `merge` entries name for that member before the `member-revoke` — and every
// entry past that head is reported. A revoked member the Owner never merged
// has no accepted history.
//
// Pure verify-core: strings and PEMs in, no fs. The fs-reading package verifier
// (`evidencePackage.ts`) and the app supply the chain texts.

export interface SharedCaseMemberChain {
  installationId: string
  jsonl: string
}

// The member chains of a Case this one was forked from
// (`lineage/<sourceCaseId>/manifest.<installationId>.jsonl`). The source
// Owner's chain is not among them: it is the history the fork's own chain
// continues.
export interface SharedCaseLineage {
  sourceCaseId: string
  members: SharedCaseMemberChain[]
}

export interface SharedCaseInput {
  // The Owner's chain and the key it is verified under: the trust anchor.
  owner: { jsonl: string; publicKeyPem: string }
  // Every other member chain, as received (`manifest.<installationId>.jsonl`).
  members: SharedCaseMemberChain[]
  // The member chains of every Case an `import` in the Owner's chain names.
  lineage?: SharedCaseLineage[]
}

export type SharedCaseOutcome =
  | 'pass'
  // A chain failed on its own: the underlying ChainVerifyResult says where.
  | 'chain-broken'
  // A chain holds an entry from a newer schema. Not a tamper verdict (X25).
  | 'verifier-too-old'
  // The Owner's membership entries do not form a roster this verifier can use,
  // a membership entry was written outside the Owner's chain, or a chain
  // belongs to another Case.
  | 'roster-invalid'
  // A chain is present for an installation no `member-add` names.
  | 'unknown-member'
  // The roster names a member whose chain was not supplied. A revoked member
  // the Owner never merged is the one exception: the Owner never held it.
  | 'member-chain-missing'
  // A revoked member's chain holds an entry past the head the Owner merged
  // before revoking it.
  | 'entry-after-revocation'
  // A `merge` names a head that is absent from that member's chain or differs.
  | 'merge-head-mismatch'
  // Two Exhibit entries resolve to one citation, or an entry claims a code
  // that is not its writer's. Not one chain numbering two Exhibits alike,
  // which is an Integrity Exception (X48).
  | 'citation-collision'

export interface SharedCaseMember {
  installationId: string
  memberCode: string
  operatorName: string
  publicKeyPem: string
  role: 'owner' | 'member'
  // Index in the Owner's chain of the `member-add`.
  addedAt: number
  // Index in the Owner's chain of the `member-revoke`, when revoked.
  revokedAt?: number
  // The highest index of this member's chain the Owner had merged before
  // revoking it. Undefined when never merged. Meaningful only when revoked.
  acceptedHeadIndex?: number
}

export interface SharedCaseCitation {
  citation: string
  installationId: string
  // Index in that member's chain of the entry the citation resolves to.
  index: number
  exhibitId: string
  // Set when the citation was made in a Case this one was forked from.
  sourceCaseId?: string
}

export interface SharedCaseExclusion {
  exhibitId: string
  authorInstallationId: string
  reason?: string
  // Index in the Owner's chain of the `exclude`.
  index: number
  // When the Owner wrote the `exclude`, and the name it wrote under.
  timestamp: string
  operatorName: string
  // Set when the Owner of a Case this one was forked from wrote it.
  sourceCaseId?: string
}

// The roster of a Case this one was forked from.
export interface SharedCaseLineageRoster {
  sourceCaseId: string
  members: SharedCaseMember[]
}

export interface SharedCaseFinding {
  outcome: Exclude<SharedCaseOutcome, 'pass'>
  // The chain the finding is about, when it is about one. The Owner's chain
  // is named by the Owner's installation id, or `owner` before the roster
  // names one.
  installationId?: string
  index?: number
  reason: string
}

export interface SharedCaseVerifyResult {
  // True iff there are no findings.
  valid: boolean
  // The first finding's outcome, or `pass`.
  outcome: SharedCaseOutcome
  reason?: string
  // Every finding, in the order the walk met them, `verifier-too-old` last.
  // Verification stops when the Owner's chain fails, and before the
  // cross-chain checks when a chain is unreadable; a remote chain's own
  // failure ends the checks on that chain and no other.
  findings: SharedCaseFinding[]
  owner: ChainVerifyResult
  memberChains: Map<string, ChainVerifyResult>
  members: SharedCaseMember[]
  citations: Map<string, SharedCaseCitation>
  exclusions: SharedCaseExclusion[]
  // Every Case this one was forked from, nearest first.
  lineage: SharedCaseLineageRoster[]
  // The Shared Case's id, as the Owner's own `member-add` states it. Absent
  // for a Case with no roster.
  caseId?: string
  // The accepted entries of every chain that verified, by installation id (the
  // Owner's under `owner` when no roster names it). A revoked member's stop at
  // the head the Owner had merged. What a caller binds artifacts against. A
  // lineage chain is keyed `<sourceCaseId>/<installationId>`: one installation
  // can hold a chain in both Cases.
  entries: Map<string, ManifestEntry[]>
  // The key `entries` holds the caller's trusted chain under. Set by
  // `verifySharedCaseReplica` once it knows which member the local chain is.
  localInstallationId?: string
  // Set when `verifier-too-old` is the ONLY kind of finding: the entry this
  // build could not read. A definite failure found beside it is a verdict this
  // build did reach, and is never downgraded to "too old".
  unsupported?: UnsupportedEntry
}

type MergeEntry = Extract<ManifestEntry, { type: 'merge' }>
type ImportEntry = Extract<ManifestEntry, { type: 'import' }>

// The manifest schema that introduced Shared Cases: what a verifier has to
// read to walk one, and what a package of one names as its requirement.
export const SHARED_CASE_SCHEMA_VERSION = 4

// The entry types schema 4 introduced. A chain carrying any of them is part
// of a Shared Case; the package verifier keys its walk on this set.
export const SHARED_CASE_ENTRY_TYPES: ReadonlySet<ManifestEntry['type']> = new Set([
  'member-add',
  'member-revoke',
  'merge',
  'exclude'
])

// The subset only the Owner writes.
const MEMBERSHIP_TYPES: ReadonlySet<ManifestEntry['type']> = new Set([
  'member-add',
  'member-revoke',
  'exclude'
])

// Parses a chain `verifyManifestChainText` has already verified. Every line of
// a valid chain parsed under the same schema during verification, so a line
// that does not parse here cannot occur; the throw is a guard, not a verdict.
function parseVerifiedChain(jsonl: string): ManifestEntry[] {
  return jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const parsed = ManifestEntrySchema.safeParse(JSON.parse(line))
      if (!parsed.success) throw new Error(`verified chain failed to parse at index ${index}`)
      return parsed.data
    })
}

// The first `count` lines of a chain, as a chain text of its own.
function chainPrefix(jsonl: string, count: number): string {
  const lines = jsonl
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(0, count)
  return lines.length === 0 ? '' : lines.join('\n') + '\n'
}

// The chain's last `import`: where this Case's own entries begin.
function lastImportOf(entries: ManifestEntry[]): ImportEntry | undefined {
  let last: ImportEntry | undefined
  for (const entry of entries) if (entry.type === 'import') last = entry
  return last
}

// The entries of this Case: from the last `import` on, or all of them.
function currentSegment(entries: ManifestEntry[]): ManifestEntry[] {
  const cut = lastImportOf(entries)?.index ?? 0
  return entries.filter((e) => e.index >= cut)
}

// PEM comparison tolerant of the line-ending and trailing-newline differences
// a key acquires between being written to disk and being embedded in JSON.
function samePem(a: string, b: string): boolean {
  const normalize = (pem: string): string => pem.replace(/\r\n/g, '\n').trim()
  return normalize(a) === normalize(b)
}

interface Roster {
  ownerId?: string
  // The Shared Case's id: the one the Owner's own `member-add` states. A
  // joiner adopts it, so every member chain's current entries carry it.
  caseId?: string
  members: SharedCaseMember[]
  findings: SharedCaseFinding[]
  exclusions: SharedCaseExclusion[]
}

// Builds the roster from the Owner's verified chain in chain order. Every rule
// here is one the Owner's writer holds at write time; verification re-checks
// them because a chain is the record, not the writer.
function buildRoster(entries: ManifestEntry[], ownerPublicKeyPem: string): Roster {
  const members: SharedCaseMember[] = []
  const findings: SharedCaseFinding[] = []
  const exclusions: SharedCaseExclusion[] = []
  let ownerId: string | undefined
  let caseId: string | undefined
  const fail = (index: number, reason: string): void => {
    findings.push({ outcome: 'roster-invalid', installationId: ownerId ?? 'owner', index, reason })
  }
  const byId = (id: string): SharedCaseMember | undefined =>
    members.find((m) => m.installationId === id)

  for (const entry of entries) {
    if (entry.type === 'member-add') {
      const { index, memberInstallationId, memberCode, role } = entry
      if (members.length === 0) {
        // The first member-add names the Owner and fixes the Owner's code. Its
        // key must be the one this chain verified under: a chain naming a
        // different Owner key is not the Owner's statement about itself.
        if (role !== 'owner') {
          fail(index, `first member-add has role '${role}', expected 'owner'`)
          continue
        }
        if (!samePem(entry.memberPublicKeyPem, ownerPublicKeyPem)) {
          fail(
            index,
            "the Owner's member-add carries a key other than the one its chain verified under"
          )
          continue
        }
        ownerId = memberInstallationId
        caseId = entry.caseId
      } else if (role === 'owner') {
        fail(index, `a second member-add with role 'owner' (${memberInstallationId})`)
        continue
      }
      if (byId(memberInstallationId)) {
        // Re-adding a revoked installation is not defined for v1: a second
        // record would give one installation two codes and two histories.
        fail(
          index,
          `member-add for an installation already on the roster (${memberInstallationId})`
        )
        continue
      }
      if (members.some((m) => m.memberCode === memberCode)) {
        // A code is a citation prefix and is never reused, revoked or not.
        fail(index, `member-add reuses Member Code ${memberCode}`)
        continue
      }
      const sameKey = members.find((m) => samePem(m.publicKeyPem, entry.memberPublicKeyPem))
      if (sameKey) {
        // The key is the member's identity: one chain under a shared key would
        // verify as either member and take either code.
        fail(
          index,
          `member-add for ${memberInstallationId} carries the key of ${sameKey.installationId}`
        )
        continue
      }
      members.push({
        installationId: memberInstallationId,
        memberCode,
        operatorName: entry.memberOperatorName,
        publicKeyPem: entry.memberPublicKeyPem,
        role,
        addedAt: index
      })
    } else if (entry.type === 'member-revoke') {
      const { index, memberInstallationId } = entry
      const member = byId(memberInstallationId)
      if (!member) {
        fail(index, `member-revoke for an installation not on the roster (${memberInstallationId})`)
      } else if (member.revokedAt !== undefined) {
        fail(index, `member-revoke for an installation already revoked (${memberInstallationId})`)
      } else if (member.role === 'owner') {
        fail(index, 'member-revoke names the Owner')
      } else {
        member.revokedAt = index
        member.acceptedHeadIndex = acceptedHeadBefore(entries, index, memberInstallationId)
      }
    } else if (entry.type === 'exclude') {
      const { index, exhibitId, authorInstallationId, reason, timestamp, operatorName } = entry
      if (!byId(authorInstallationId)) {
        fail(index, `exclude names an author not on the roster (${authorInstallationId})`)
        continue
      }
      const exclusion = { exhibitId, authorInstallationId, index, timestamp, operatorName }
      exclusions.push(reason === undefined ? exclusion : { ...exclusion, reason })
    }
  }
  return { ownerId, caseId, members, findings, exclusions }
}

// The first entry of a verified chain's CURRENT segment that names another
// Case. Entries before the last `import` are the source Case's history and
// carry its id by design; everything from that `import` on is this Case's.
function foreignCaseEntry(entries: ManifestEntry[], caseId: string): ManifestEntry | undefined {
  const lastImport = entries.reduce((at, e) => (e.type === 'import' ? e.index : at), 0)
  return entries.find((e) => e.index >= lastImport && e.caseId !== caseId)
}

// The highest head index the Owner's `merge` entries before `before` name for
// `installationId`: the accepted history of a member about to be revoked.
function acceptedHeadBefore(
  entries: ManifestEntry[],
  before: number,
  installationId: string
): number | undefined {
  let accepted: number | undefined
  for (const entry of entries) {
    if (entry.index >= before) break
    if (entry.type !== 'merge') continue
    for (const head of entry.heads) {
      if (head.installationId !== installationId) continue
      if (accepted === undefined || head.index > accepted) accepted = head.index
    }
  }
  return accepted
}

/**
 * Verifies a Shared Case: the Owner's chain under the supplied key, each remote
 * member chain under the key its `member-add` carries, every `merge` head, and
 * every Exhibit citation.
 *
 * A Case with no `member-add` entries has one member: its citations carry no
 * prefix, and any remote chain supplied is `unknown-member`.
 *
 * A Case forked from another verifies that one too, from the Owner chain's
 * history before its last `import` and the lineage chains supplied for it.
 */
export function verifySharedCase(input: SharedCaseInput): SharedCaseVerifyResult {
  return verifyCase(input, false)
}

// `nested` is set for a source Case verified from a fork's history: the check
// that every supplied lineage belongs to some `import` runs once, at the top,
// where every `import` in the chain is in view.
function verifyCase(input: SharedCaseInput, nested: boolean): SharedCaseVerifyResult {
  const findings: SharedCaseFinding[] = []
  const memberChains = new Map<string, ChainVerifyResult>()
  const citations = new Map<string, SharedCaseCitation>()
  const entriesById = new Map<string, ManifestEntry[]>()
  const lineage: SharedCaseLineageRoster[] = []
  const lineageEntries = new Map<string, ManifestEntry[]>()
  const lineageExclusions: SharedCaseExclusion[] = []
  let lineageUnsupported: UnsupportedEntry | undefined
  const finish = (
    owner: ChainVerifyResult,
    roster: Pick<Roster, 'members' | 'exclusions' | 'caseId'>,
    unsupported?: UnsupportedEntry
  ): SharedCaseVerifyResult => {
    // A definite finding leads: `outcome` must not read "too old" when this
    // build also proved a failure.
    findings.sort(
      (a, b) => Number(a.outcome === 'verifier-too-old') - Number(b.outcome === 'verifier-too-old')
    )
    const first = findings[0]
    const candidate = unsupported ?? lineageUnsupported
    const definite = findings.some((f) => f.outcome !== 'verifier-too-old')
    for (const [key, accepted] of lineageEntries) entriesById.set(key, accepted)
    return {
      valid: findings.length === 0,
      outcome: first?.outcome ?? 'pass',
      ...(first ? { reason: first.reason } : {}),
      findings,
      owner,
      memberChains,
      members: roster.members,
      citations,
      exclusions: [...roster.exclusions, ...lineageExclusions],
      lineage,
      entries: entriesById,
      ...(roster.caseId !== undefined ? { caseId: roster.caseId } : {}),
      ...(candidate && !definite ? { unsupported: candidate } : {})
    }
  }
  const empty = { members: [], exclusions: [] }

  // 1. The Owner's chain, under the trust anchor. Nothing else is read until it
  // verifies: the roster comes from it, and a roster read off a broken chain
  // would hand a forger the keys every later check trusts.
  const owner = verifyManifestChainText(input.owner.jsonl, {
    publicKeyPem: input.owner.publicKeyPem
  })
  if (owner.unsupported) {
    findings.push({
      outcome: 'verifier-too-old',
      installationId: 'owner',
      index: owner.unsupported.index,
      reason: owner.reason ?? 'verifier too old'
    })
    return finish(owner, empty, owner.unsupported)
  }
  if (!owner.valid) {
    findings.push({
      outcome: 'chain-broken',
      installationId: 'owner',
      ...(owner.brokenAt !== undefined ? { index: owner.brokenAt } : {}),
      reason: `Owner chain: ${owner.reason ?? 'broken'}`
    })
    return finish(owner, empty)
  }
  const ownerEntries = parseVerifiedChain(input.owner.jsonl)
  const roster = buildRoster(currentSegment(ownerEntries), input.owner.publicKeyPem)
  findings.push(...roster.findings)
  const { ownerId, caseId, members } = roster
  if (caseId !== undefined) {
    const foreign = foreignCaseEntry(ownerEntries, caseId)
    if (foreign) {
      findings.push({
        outcome: 'roster-invalid',
        installationId: ownerId ?? 'owner',
        index: foreign.index,
        reason: `entry ${foreign.index} of the Owner's chain names Case ${foreign.caseId}, the Shared Case is ${caseId}`
      })
    }
  }
  const memberById = new Map(members.map((m) => [m.installationId, m]))

  const lineageInput = input.lineage ?? []
  if (!nested) {
    const named = new Set(
      ownerEntries.flatMap((e) => (e.type === 'import' ? [e.sourceCaseId] : []))
    )
    for (const { sourceCaseId } of lineageInput) {
      if (named.has(sourceCaseId)) continue
      findings.push({
        outcome: 'roster-invalid',
        reason: `lineage chains supplied for Case ${sourceCaseId}, which no import in the Owner's chain names`
      })
    }
  }

  // 1b. The Case this one was forked from: the Owner chain's history before
  // its last `import`, verified as a Shared Case under the key that `import`
  // names. The chain walk above already verified that history under the same
  // key, anchored through the `import` the trusted key signed. It runs when
  // the history was shared or lineage chains were supplied for it; a history
  // with neither is a single-member Case and reads as it always has.
  const lastImport = lastImportOf(ownerEntries)
  const history = lastImport ? ownerEntries.filter((e) => e.index < lastImport.index) : []
  const forked =
    lastImport !== undefined &&
    history.length > 0 &&
    (lineageInput.length > 0 || history.some((e) => e.type === 'member-add'))
  if (lastImport && forked) {
    const { sourceCaseId, sourceInstallationId, sourcePublicKeyPem, index } = lastImport
    const supplied = lineageInput.find((l) => l.sourceCaseId === sourceCaseId)
    const source = verifyCase(
      {
        owner: { jsonl: chainPrefix(input.owner.jsonl, index), publicKeyPem: sourcePublicKeyPem },
        members: supplied?.members ?? [],
        lineage: lineageInput.filter((l) => l !== supplied)
      },
      true
    )
    for (const finding of source.findings) {
      findings.push({ ...finding, reason: `lineage Case ${sourceCaseId}: ${finding.reason}` })
    }
    lineageUnsupported = source.unsupported
    // The source Owner's entries are this chain's own history, already in it.
    const sourceOwner = source.members.find((m) => m.role === 'owner')?.installationId
    // The import names the Case and the Owner its verified history
    // establishes. The history's key is bound by the chain walk; its Case id
    // and Owner are not, and an import relabelling them would attribute the
    // source Case's Exhibits to another.
    const establishedCaseId = source.caseId ?? lastImportOf(history)?.caseId
    if (establishedCaseId !== undefined && establishedCaseId !== sourceCaseId) {
      findings.push({
        outcome: 'roster-invalid',
        installationId: ownerId ?? 'owner',
        index,
        reason: `import at index ${index} names source Case ${sourceCaseId}, its history is Case ${establishedCaseId}`
      })
    }
    if (sourceOwner !== undefined && sourceOwner !== sourceInstallationId) {
      findings.push({
        outcome: 'roster-invalid',
        installationId: ownerId ?? 'owner',
        index,
        reason: `import at index ${index} names source installation ${sourceInstallationId}, the source Case's Owner is ${sourceOwner}`
      })
    }
    for (const [id, accepted] of source.entries) {
      if (id !== (sourceOwner ?? 'owner')) lineageEntries.set(`${sourceCaseId}/${id}`, accepted)
    }
    for (const [id, result] of source.memberChains) {
      memberChains.set(`${sourceCaseId}/${id}`, result)
    }
    for (const [key, citation] of source.citations) {
      citations.set(`${sourceCaseId}/${key}`, { sourceCaseId, ...citation })
    }
    for (const exclusion of source.exclusions) {
      lineageExclusions.push({ sourceCaseId, ...exclusion })
    }
    lineage.push({ sourceCaseId, members: source.members }, ...source.lineage)
  }

  // 2. Each remote chain under its member's key.
  // Verified entries by chain, the input to the cross-chain checks. The
  // Owner's are keyed by its installation id, or `owner` when no roster names
  // one: a single-member Case still resolves its own citations.
  entriesById.set(ownerId ?? 'owner', ownerEntries)
  const seenIds = new Set<string>()
  // Every chain is walked before "too old" is decided, so an unreadable chain
  // met first cannot hide a broken one met after it, or the reverse.
  let firstUnsupported: UnsupportedEntry | undefined
  for (const chain of input.members) {
    const { installationId } = chain
    if (seenIds.has(installationId) || installationId === ownerId) {
      findings.push({
        outcome: 'roster-invalid',
        installationId,
        reason: `two chains supplied for installation ${installationId}`
      })
      continue
    }
    seenIds.add(installationId)
    const member = memberById.get(installationId)
    if (!member) {
      findings.push({
        outcome: 'unknown-member',
        installationId,
        reason:
          members.length === 0
            ? `chain for installation ${installationId} in a Case with no member-add entries`
            : `no member-add names installation ${installationId}`
      })
      continue
    }
    const result = verifyManifestChainText(chain.jsonl, { publicKeyPem: member.publicKeyPem })
    memberChains.set(installationId, result)
    if (result.unsupported) {
      findings.push({
        outcome: 'verifier-too-old',
        installationId,
        index: result.unsupported.index,
        reason: result.reason ?? 'verifier too old'
      })
      firstUnsupported ??= result.unsupported
      continue
    }
    if (!result.valid) {
      findings.push({
        outcome: 'chain-broken',
        installationId,
        ...(result.brokenAt !== undefined ? { index: result.brokenAt } : {}),
        reason: `chain of ${installationId} (${member.memberCode}): ${result.reason ?? 'broken'}`
      })
      continue
    }
    const entries = parseVerifiedChain(chain.jsonl)
    const foreign = caseId === undefined ? undefined : foreignCaseEntry(entries, caseId)
    if (foreign) {
      // Verified under the member's key, and so genuinely that member's — but
      // of another Case. None of it is accepted: not as a merge target, not
      // as a citation.
      findings.push({
        outcome: 'roster-invalid',
        installationId,
        index: foreign.index,
        reason: `entry ${foreign.index} of ${installationId} (${member.memberCode}) names Case ${foreign.caseId}, the Shared Case is ${caseId}`
      })
      continue
    }
    // A revoked member's entries past what the Owner accepted are reported
    // below and NOT accepted: they satisfy no merge head and claim no
    // citation. Everything the Owner merged before the revocation stands.
    entriesById.set(
      installationId,
      member.revokedAt === undefined
        ? entries
        : entries.slice(0, (member.acceptedHeadIndex ?? -1) + 1)
    )

    // Membership is the Owner's to write. A member chain that carries any of
    // it is not forged — it verified under that member's key — but the roster
    // it implies is not one this verifier will use.
    const membership = entries.find((e) => MEMBERSHIP_TYPES.has(e.type))
    if (membership) {
      findings.push({
        outcome: 'roster-invalid',
        installationId,
        index: membership.index,
        reason: `${membership.type} entry written outside the Owner's chain`
      })
    }

    if (member.revokedAt !== undefined) {
      const late = entries.find(
        (e) => member.acceptedHeadIndex === undefined || e.index > member.acceptedHeadIndex
      )
      if (late) {
        const accepted =
          member.acceptedHeadIndex === undefined
            ? 'the Owner merged nothing from it before revoking it'
            : `the Owner merged up to index ${member.acceptedHeadIndex} before revoking it`
        findings.push({
          outcome: 'entry-after-revocation',
          installationId,
          index: late.index,
          reason: `entry ${late.index} of ${installationId} (${member.memberCode}) is after its revocation: ${accepted}`
        })
      }
    }
  }

  // A chain for every member the Owner could have held one for. A revoked
  // member with no accepted head was never merged, so the Owner never had it.
  for (const member of members) {
    if (member.role === 'owner' || seenIds.has(member.installationId)) continue
    if (member.revokedAt !== undefined && member.acceptedHeadIndex === undefined) continue
    findings.push({
      outcome: 'member-chain-missing',
      installationId: member.installationId,
      reason: `no chain supplied for member ${member.installationId} (${member.memberCode})`
    })
  }

  // An unreadable chain leaves the cross-chain checks nothing sound to say: a
  // merge naming it would read as a mismatch this build cannot actually judge.
  // It is "too old" only when nothing definite was found; otherwise the
  // findings stand as the verdict.
  if (firstUnsupported) {
    const definite = findings.some((f) => f.outcome !== 'verifier-too-old')
    return finish(owner, roster, definite ? undefined : firstUnsupported)
  }

  // The entries this Case wrote. A forked Owner chain's history was walked as
  // the source Case in 1b, and its merges and citations are that Case's.
  const walked = new Map(entriesById)
  if (forked) walked.set(ownerId ?? 'owner', currentSegment(ownerEntries))

  // 3. Every merge head, in every verified chain.
  for (const [writerId, entries] of walked) {
    for (const entry of entries) {
      if (entry.type !== 'merge') continue
      checkMergeHeads(writerId, entry, entriesById, findings)
    }
  }

  // 4. Citations. A code is the entry's own, or its writer's from the roster;
  // a Case with no roster has one member and no prefix.
  for (const [writerId, entries] of walked) {
    const writerCode = memberById.get(writerId)?.memberCode
    for (const entry of entries) {
      if (entry.type === 'exhibit') {
        const { exhibitId, exhibitNumber, memberCode, index } = entry
        if (memberCode !== undefined && memberCode !== writerCode) {
          findings.push({
            outcome: 'citation-collision',
            installationId: writerId,
            index,
            reason:
              writerCode === undefined
                ? `exhibit entry ${index} claims Member Code ${memberCode} in a Case with no roster`
                : `exhibit entry ${index} of ${writerId} claims Member Code ${memberCode}, its writer's is ${writerCode}`
          })
          continue
        }
        resolveCitation({ installationId: writerId, index, exhibitId }, exhibitNumber, writerCode)
      } else if (entry.type === 'capture' && entry.exhibitNumber !== undefined) {
        // A Capture ingested since X46 carries its number on its own entry.
        const at = { installationId: writerId, index: entry.index, exhibitId: entry.captureId }
        resolveCitation(at, entry.exhibitNumber, writerCode)
      } else if (entry.type === 'renumber') {
        for (const { exhibitId, exhibitNumber } of entry.assignments) {
          const at = { installationId: writerId, index: entry.index, exhibitId }
          resolveCitation(at, exhibitNumber, writerCode)
        }
      }
    }
  }

  // 5. Every exclusion names an Exhibit its stated author's accepted chain
  // holds. Skipped for an author whose chain is absent or failed: that is
  // already a finding, and the target cannot be judged without the chain.
  for (const exclusion of roster.exclusions) {
    const authored = entriesById.get(exclusion.authorInstallationId)
    if (!authored) continue
    const found = authored.some(
      (e) =>
        (e.type === 'exhibit' && e.exhibitId === exclusion.exhibitId) ||
        (e.type === 'capture' && e.captureId === exclusion.exhibitId)
    )
    if (!found) {
      findings.push({
        outcome: 'roster-invalid',
        installationId: ownerId ?? 'owner',
        index: exclusion.index,
        reason: `exclude at index ${exclusion.index} names Exhibit ${exclusion.exhibitId}, which the chain of ${exclusion.authorInstallationId} does not hold`
      })
    }
  }

  return finish(owner, roster)

  function resolveCitation(
    at: Omit<SharedCaseCitation, 'citation'>,
    exhibitNumber: number,
    code: string | undefined
  ): void {
    const citation = code === undefined ? String(exhibitNumber) : `${code}-${exhibitNumber}`
    const existing = citations.get(citation)
    // One chain numbering two Exhibits alike is X48's Integrity Exception, not
    // a failed walk: the first assignment keeps the citation here, and the
    // repeat is reported by the X48 check over that chain.
    if (existing?.installationId === at.installationId && existing.exhibitId !== at.exhibitId) {
      return
    }
    if (existing) {
      // One citation, one ENTRY. A second entry for the same Exhibit id can
      // state another path or hash, and a reader could not tell which governs.
      findings.push({
        outcome: 'citation-collision',
        installationId: at.installationId,
        index: at.index,
        reason:
          existing.exhibitId === at.exhibitId
            ? `citation ${citation} resolves to two entries for exhibit ${at.exhibitId} (index ${existing.index} of ${existing.installationId} and index ${at.index} of ${at.installationId})`
            : `citation ${citation} resolves to exhibits ${existing.exhibitId} and ${at.exhibitId}`
      })
      return
    }
    citations.set(citation, { citation, ...at })
  }
}

function checkMergeHeads(
  writerId: string,
  entry: MergeEntry,
  entriesById: Map<string, ManifestEntry[]>,
  findings: SharedCaseFinding[]
): void {
  for (const head of entry.heads) {
    const target = entriesById.get(head.installationId)
    const found = target?.[head.index]
    if (head.installationId === writerId) {
      // A `merge` records what a sync session brought in from ANOTHER member.
      // A head naming the writer's own chain states nothing — and in a Case
      // with no roster, where the Owner's entries are keyed by the literal
      // `owner`, a merge naming `owner` would otherwise resolve against the
      // writer's own earlier entries and pass (#1518 review).
      findings.push({
        outcome: 'merge-head-mismatch',
        installationId: writerId,
        index: entry.index,
        reason: `merge entry ${entry.index} of ${writerId} names its own chain as a head`
      })
    } else if (!target) {
      findings.push({
        outcome: 'merge-head-mismatch',
        installationId: writerId,
        index: entry.index,
        reason: `merge entry ${entry.index} of ${writerId} names installation ${head.installationId}, whose chain is not present or did not verify`
      })
    } else if (!found) {
      findings.push({
        outcome: 'merge-head-mismatch',
        installationId: writerId,
        index: entry.index,
        reason: `merge entry ${entry.index} of ${writerId} names index ${head.index} of ${head.installationId}, which has ${target.length} entries`
      })
    } else if (found.entryHash !== head.entryHash) {
      findings.push({
        outcome: 'merge-head-mismatch',
        installationId: writerId,
        index: entry.index,
        reason: `merge entry ${entry.index} of ${writerId} names index ${head.index} of ${head.installationId} with a hash that differs from the entry there`
      })
    }
  }
}

export interface SharedCaseReplicaInput {
  // The chain of the installation whose key the caller trusts: the local
  // install, or the member that exported a package. The trust anchor.
  local: { jsonl: string; publicKeyPem: string }
  // Every other chain the replica holds, as received. One of them is the
  // Owner's when the local installation is not the Owner.
  others: SharedCaseMemberChain[]
  // The member chains of every Case this one was forked from.
  lineage?: SharedCaseLineage[]
}

// What a raw, unverified scan of a chain file yields: enough to LOCATE the
// Owner's chain and the key it names, never enough to trust either.
interface OwnerClaim {
  installationId: string
  jsonl: string
  // Line position of the `member-add` with role `owner`.
  index: number
  publicKeyPem: string
}

// A chain's raw lines, and where its current segment starts: the line of its
// last `import`, or 0. A fork's history before that names its source Case's
// roster, which says nothing about who this Case's Owner is.
function rawSegment(jsonl: string): { lines: string[]; start: number } {
  const lines = jsonl.split('\n').filter((line) => line.trim().length > 0)
  let start = 0
  lines.forEach((line, index) => {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return
    }
    if (raw !== null && typeof raw === 'object' && (raw as { type?: unknown }).type === 'import') {
      start = index
    }
  })
  return { lines, start }
}

function readOwnerClaim(chain: SharedCaseMemberChain): OwnerClaim | undefined {
  const { lines, start } = rawSegment(chain.jsonl)
  for (let index = start; index < lines.length; index++) {
    let raw: unknown
    try {
      raw = JSON.parse(lines[index])
    } catch {
      return undefined
    }
    if (raw === null || typeof raw !== 'object') return undefined
    const { type, role, memberInstallationId, memberPublicKeyPem } = raw as Record<string, unknown>
    if (type !== 'member-add') continue
    if (
      role === 'owner' &&
      memberInstallationId === chain.installationId &&
      typeof memberPublicKeyPem === 'string'
    ) {
      return { ...chain, index, publicKeyPem: memberPublicKeyPem }
    }
    return undefined
  }
  return undefined
}

/**
 * Verifies a Shared Case from any member's replica. When the local chain is
 * the Owner's this is `verifySharedCase` as is. Otherwise the Owner's chain is
 * one of the others, and its key is trusted only once it is anchored to the
 * local key: the local chain must carry a `merge` naming a head of the Owner's
 * chain at or past the Owner's own `member-add`, so the line that names the
 * key is bound, through the hash chain, to a hash the local key signed. The
 * roster then names the local installation by the key its chain verified
 * under, and the local chain is verified again as the member it is.
 *
 * Nothing an unverified line says decides a verdict: the raw scan only
 * LOCATES the Owner's chain and the key it claims, and `verifySharedCase`
 * verifies that chain under that key before reading anything from it.
 */
export function verifySharedCaseReplica(input: SharedCaseReplicaInput): SharedCaseVerifyResult {
  const { local, others, lineage = [] } = input
  const asOwner = (): SharedCaseVerifyResult => {
    const result = verifySharedCase({ owner: local, members: others, lineage })
    const ownerId = result.members.find((m) => m.role === 'owner')?.installationId
    return { ...result, localInstallationId: ownerId ?? 'owner' }
  }
  const localChain = verifyManifestChainText(local.jsonl, { publicKeyPem: local.publicKeyPem })
  if (!localChain.valid) return asOwner()
  const localEntries = parseVerifiedChain(local.jsonl)
  // Only this Case's roster says who its Owner is: a fork carries its source
  // Case's `member-add` entries as history.
  if (currentSegment(localEntries).some((e) => e.type === 'member-add')) return asOwner()

  const claims = others.map(readOwnerClaim).filter((c): c is OwnerClaim => c !== undefined)
  if (claims.length === 0) return asOwner()
  const unanchored = (reason: string): SharedCaseVerifyResult => ({
    valid: false,
    outcome: 'roster-invalid',
    reason,
    findings: [{ outcome: 'roster-invalid', installationId: 'local', reason }],
    owner: localChain,
    memberChains: new Map(),
    members: [],
    citations: new Map(),
    exclusions: [],
    lineage: [],
    entries: new Map()
  })
  if (claims.length > 1) {
    return unanchored(
      `two chains claim the Owner (${claims.map((c) => c.installationId).join(', ')})`
    )
  }
  const [claim] = claims
  let anchor: { index: number; entryHash: string } | undefined
  for (const entry of localEntries) {
    if (entry.type !== 'merge') continue
    for (const head of entry.heads) {
      if (head.installationId !== claim.installationId) continue
      if (anchor === undefined || head.index > anchor.index) anchor = head
    }
  }
  if (anchor === undefined) {
    return unanchored(
      `no merge in the local chain names the Owner's chain (${claim.installationId}), so its key cannot be anchored`
    )
  }
  if (anchor.index < claim.index) {
    return unanchored(
      `the local chain's merge of the Owner's chain stops at index ${anchor.index}, before the Owner's member-add at index ${claim.index}`
    )
  }
  // The local installation is whichever roster member the Owner named with
  // the local key. Read raw here to name the chain; verifySharedCase verifies
  // the roster and the local chain under it, so a wrong claim fails there.
  const localId = readMemberIdForKey(claim.jsonl, local.publicKeyPem)
  if (localId === undefined) {
    return unanchored("no member-add in the Owner's chain carries the local key")
  }
  const result = verifySharedCase({
    owner: { jsonl: claim.jsonl, publicKeyPem: claim.publicKeyPem },
    members: [
      { installationId: localId, jsonl: local.jsonl },
      ...others.filter((o) => o.installationId !== claim.installationId)
    ],
    lineage
  })
  return { ...result, localInstallationId: localId }
}

function readMemberIdForKey(jsonl: string, publicKeyPem: string): string | undefined {
  const { lines, start } = rawSegment(jsonl)
  for (const line of lines.slice(start)) {
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      return undefined
    }
    if (raw === null || typeof raw !== 'object') return undefined
    const { type, memberInstallationId, memberPublicKeyPem } = raw as Record<string, unknown>
    if (
      type === 'member-add' &&
      typeof memberInstallationId === 'string' &&
      typeof memberPublicKeyPem === 'string' &&
      samePem(memberPublicKeyPem, publicKeyPem)
    ) {
      return memberInstallationId
    }
  }
  return undefined
}
