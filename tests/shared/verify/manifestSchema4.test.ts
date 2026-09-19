import { describe, it, expect } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import {
  buildTrustedTimeIndexFromEntries,
  canonicalStringify,
  verifyManifestChainText,
  verifySharedCase,
  verifySharedCaseReplica,
  SHARED_CASE_ENTRY_TYPES
} from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema, MEMBER_CODE_PATTERN } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'

// Known-answer tests for manifest schema 4: Shared Cases (#1509,
// docs/specs/2026-09-19-collaborative-cases-design.md). The answers frozen here
// are the ones a recipient of a Shared Case relies on:
//   1. the four new entry types parse, and the two extended ones keep every
//      schema-3 body's canonical bytes — `memberCode` and `subject` are
//      omitted, never defaulted;
//   2. a two-member Case verifies, and every citation resolves to exactly one
//      `<Member Code>-<n>`; a single-member Case with no `member-add` has no
//      prefix and verifies exactly as before;
//   3. each non-pass outcome is reported by name and at the entry it is about:
//      a revoked member's later entry, a forged remote entry, a `merge` naming
//      a head that is absent or differs, a chain nobody added, a citation that
//      resolves twice;
//   4. an `exclude` annotates and leaves the pass outcome alone;
//   5. the package verifier walks an enclosed Shared Case and names the same
//      outcomes, so the standalone verifier built from it does too.
// The schema-3 verifier's answer to a schema-4 chain ("verifier too old", not
// a broken chain) is pinned in manifestSchema4TooOld.test.ts, which mocks the
// read ceiling back to 3.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const OWNER_ID = 'inst-owner'
const MEMBER_ID = 'inst-member'
const OPERATOR = { operatorId: OWNER_ID, operatorName: 'Casey Operator', toolVersion: '0.5.0' }
const MEMBER_OPERATOR = {
  operatorId: MEMBER_ID,
  operatorName: 'Robin Member',
  toolVersion: '0.5.0'
}

interface KeyPair {
  publicKey: string
  privateKey: string
}

function keyPair(): KeyPair {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
}

const signWith =
  (key: KeyPair) =>
  (entryHash: string): string =>
    createSign('sha256').update(entryHash).sign(key.privateKey, 'base64')

// The member's key is generated once per run; the Owner signs with the
// harness's installation key, exactly as the app would.
const MEMBER_KEY = keyPair()

function entryHashOf(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

interface BuiltChain {
  jsonl: string
  hashes: string[]
}

// Builds a signed JSONL chain from bodies, filling index and prevHash the way
// appendManifestEntry does. Returns the entry hashes so a `merge` in another
// chain can name a head by hash.
function buildChain(
  bodies: Record<string, unknown>[],
  sign: (entryHash: string) => string = signEntryHash
): BuiltChain {
  let prevHash = ''
  const hashes: string[] = []
  const lines = bodies.map((body, index) => {
    const full = { ...body, index, prevHash }
    const entryHash = entryHashOf(full)
    prevHash = entryHash
    hashes.push(entryHash)
    return JSON.stringify({ ...full, entryHash, signature: sign(entryHash) })
  })
  return { jsonl: lines.join('\n') + '\n', hashes }
}

const memberAdd = (
  id: string,
  code: string,
  pem: string,
  role: 'owner' | 'member',
  minute: number
): Record<string, unknown> => ({
  type: 'member-add',
  caseId: CASE_ID,
  memberInstallationId: id,
  memberPublicKeyPem: pem,
  memberCode: code,
  memberOperatorName: role === 'owner' ? OPERATOR.operatorName : MEMBER_OPERATOR.operatorName,
  nodeId: `node-${id}`,
  role,
  timestamp: `2026-09-19T12:${String(minute).padStart(2, '0')}:00.000Z`,
  ...OPERATOR,
  schemaVersion: 4
})

const memberRevoke = (id: string, minute: number): Record<string, unknown> => ({
  type: 'member-revoke',
  caseId: CASE_ID,
  memberInstallationId: id,
  timestamp: `2026-09-19T12:${String(minute).padStart(2, '0')}:00.000Z`,
  ...OPERATOR,
  schemaVersion: 4
})

const merge = (
  heads: Array<{ installationId: string; index: number; entryHash: string }>,
  minute: number,
  operator = OPERATOR
): Record<string, unknown> => ({
  type: 'merge',
  caseId: CASE_ID,
  heads: heads.map((h) => ({ ...h, entriesReceived: h.index + 1 })),
  timestamp: `2026-09-19T12:${String(minute).padStart(2, '0')}:00.000Z`,
  ...operator,
  schemaVersion: 4
})

const exclude = (exhibitId: string, minute: number, reason?: string): Record<string, unknown> => ({
  type: 'exclude',
  caseId: CASE_ID,
  exhibitId,
  authorInstallationId: MEMBER_ID,
  ...(reason === undefined ? {} : { reason }),
  timestamp: `2026-09-19T12:${String(minute).padStart(2, '0')}:00.000Z`,
  ...OPERATOR,
  schemaVersion: 4
})

const exhibit = (
  n: number,
  operator = OPERATOR,
  over: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'exhibit',
  exhibitId: `${operator.operatorId}-exhibit-${n}`,
  caseId: CASE_ID,
  kind: 'document',
  origin: 'manual-upload',
  name: `statement-${n}.pdf`,
  exhibitNumber: n,
  path: `${CASE_ID}/documents/${operator.operatorId}-exhibit-${n}.pdf`,
  contentHash: createHash('sha256').update(`${operator.operatorId}-${n}`).digest('hex'),
  sizeBytes: 2048,
  timestamp: `2026-09-19T12:${String(30 + n).padStart(2, '0')}:00.000Z`,
  ...operator,
  schemaVersion: 3,
  ...over
})

const OWNER_ADD = (): Record<string, unknown> =>
  memberAdd(OWNER_ID, 'CO', getPublicKeyPem(), 'owner', 0)
const MEMBER_ADD = (): Record<string, unknown> =>
  memberAdd(MEMBER_ID, 'RM', MEMBER_KEY.publicKey, 'member', 1)

// The member's chain: two Exhibits, the second stating its own code.
function memberChain(sign = signWith(MEMBER_KEY)): BuiltChain {
  return buildChain(
    [exhibit(1, MEMBER_OPERATOR), exhibit(2, MEMBER_OPERATOR, { memberCode: 'RM' })],
    sign
  )
}

// A two-member Case as the Owner's replica holds it: the Owner added itself
// and the member, committed one Exhibit, and merged the member's chain head.
function twoMemberCase(member = memberChain()) {
  const owner = buildChain([
    OWNER_ADD(),
    MEMBER_ADD(),
    exhibit(1),
    merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40)
  ])
  return {
    owner,
    member,
    input: {
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    }
  }
}

describe('manifest schema 4 — the schema', () => {
  it('reads up to schema version 4', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(4)
  })

  it('parses each new entry type, pinned at 4', () => {
    for (const body of [
      OWNER_ADD(),
      memberRevoke(MEMBER_ID, 5),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: 'a'.repeat(64) }], 6),
      exclude('x', 7, 'duplicate of CO-1')
    ]) {
      const full = { ...body, index: 0, prevHash: '', entryHash: 'f'.repeat(64) }
      expect(ManifestEntrySchema.safeParse(full).success, body.type as string).toBe(true)
      expect(ManifestEntrySchema.safeParse({ ...full, schemaVersion: 3 }).success).toBe(false)
      expect(ManifestEntrySchema.safeParse({ ...full, extra: 1 }).success).toBe(false)
    }
  })

  it('bounds a Member Code to one to three characters from [A-Z0-9]', () => {
    for (const code of ['A', 'RM', 'AB1', '9']) expect(MEMBER_CODE_PATTERN.test(code)).toBe(true)
    for (const code of ['', 'ABCD', 'ab', 'A-B', 'A B']) {
      expect(MEMBER_CODE_PATTERN.test(code), code).toBe(false)
      const add = {
        ...OWNER_ADD(),
        memberCode: code,
        index: 0,
        prevHash: '',
        entryHash: 'f'.repeat(64)
      }
      expect(ManifestEntrySchema.safeParse(add).success, code).toBe(false)
      const ex = {
        ...exhibit(1, OPERATOR, { memberCode: code }),
        index: 0,
        prevHash: '',
        entryHash: 'f'.repeat(64)
      }
      expect(ManifestEntrySchema.safeParse(ex).success, code).toBe(false)
    }
  })

  it('keeps a schema-3 exhibit body and hash unchanged, and hashes memberCode when present', () => {
    // `memberCode` is optional with no default: the parsed body of an entry
    // that omits it is byte-identical to the schema-3 body, so its chain hash
    // is unchanged. Present, it is part of the signed body.
    const bare = { ...exhibit(1), index: 0, prevHash: '' }
    const parsed = ManifestEntrySchema.parse({ ...bare, entryHash: entryHashOf(bare) })
    expect('memberCode' in parsed).toBe(false)
    expect(canonicalStringify(bare)).not.toContain('memberCode')
    const coded = { ...bare, memberCode: 'CO' }
    expect(entryHashOf(coded)).not.toBe(entryHashOf(bare))
  })

  it('parses a timestamp with subject entry and leaves the content form unchanged', () => {
    const base = {
      type: 'timestamp',
      caseId: CASE_ID,
      captureContentHash: 'a'.repeat(64),
      timestamp: '2026-09-19T13:00:00.000Z',
      ...OPERATOR,
      index: 0,
      prevHash: '',
      schemaVersion: 2
    }
    const content = ManifestEntrySchema.parse({ ...base, entryHash: entryHashOf(base) })
    expect('subject' in content).toBe(false)
    const entry = { ...base, subject: 'entry', schemaVersion: 4 }
    expect(ManifestEntrySchema.safeParse({ ...entry, entryHash: entryHashOf(entry) }).success).toBe(
      true
    )
    expect(
      ManifestEntrySchema.safeParse({ ...base, subject: 'exhibit', entryHash: 'f'.repeat(64) })
        .success
    ).toBe(false)
  })

  it('does not read an entry-subject stamp as trusted time for any content', () => {
    // The stamped hash is a Manifest Entry's, not an Exhibit's: a capture whose
    // content hash happened to equal it must not be reported rfc3161 off it.
    const hash = 'a'.repeat(64)
    const entries = [
      { type: 'capture', contentHash: hash, schemaVersion: 2 },
      { type: 'timestamp', subject: 'entry', captureContentHash: hash, tsaToken: 'AAAA' }
    ]
    expect(buildTrustedTimeIndexFromEntries(entries).get(hash)).toEqual({ trustedTime: 'pending' })
  })
})

describe('verifySharedCase — a two-member Case', () => {
  it('passes, with every citation resolved to <memberCode>-<n>', () => {
    const { input } = twoMemberCase()
    const result = verifySharedCase(input)
    expect(result.findings).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.outcome).toBe('pass')
    expect(result.owner.valid).toBe(true)
    expect(result.memberChains.get(MEMBER_ID)?.valid).toBe(true)
    expect(result.members.map((m) => [m.installationId, m.memberCode, m.role])).toEqual([
      [OWNER_ID, 'CO', 'owner'],
      [MEMBER_ID, 'RM', 'member']
    ])
    expect([...result.citations.keys()].sort()).toEqual(['CO-1', 'RM-1', 'RM-2'])
    expect(result.citations.get('RM-1')).toEqual({
      citation: 'RM-1',
      installationId: MEMBER_ID,
      index: 0,
      exhibitId: `${MEMBER_ID}-exhibit-1`
    })
  })

  it('still verifies each chain on its own through verifyManifestChainText', () => {
    // The single-chain verifier is unchanged: the Owner's chain verifies under
    // the Owner's key and the member's under the member's, and neither knows
    // about the other.
    const { owner, member } = twoMemberCase()
    expect(verifyManifestChainText(owner.jsonl, { publicKeyPem: getPublicKeyPem() }).valid).toBe(
      true
    )
    expect(
      verifyManifestChainText(member.jsonl, { publicKeyPem: MEMBER_KEY.publicKey }).valid
    ).toBe(true)
    expect(verifyManifestChainText(member.jsonl, { publicKeyPem: getPublicKeyPem() }).reason).toBe(
      'Invalid signature'
    )
  })

  it('verifies a single-member Case with no member-add and no prefix', () => {
    const owner = buildChain([exhibit(1), exhibit(2)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.valid).toBe(true)
    expect(result.members).toEqual([])
    expect([...result.citations.keys()]).toEqual(['1', '2'])
  })

  it('annotates an exclude without changing the pass outcome', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40),
      exclude(`${MEMBER_ID}-exhibit-2`, 41, 'duplicate of CO-1')
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.valid).toBe(true)
    expect(result.exclusions).toEqual([
      {
        exhibitId: `${MEMBER_ID}-exhibit-2`,
        authorInstallationId: MEMBER_ID,
        reason: 'duplicate of CO-1',
        index: 3
      }
    ])
    // The excluded Exhibit's citation still resolves: exports list the
    // exclusion, they do not omit the entry.
    expect(result.citations.has('RM-2')).toBe(true)
  })
})

describe('verifySharedCase — non-pass outcomes, each by name', () => {
  it('reports a revoked member’s entry past the head the Owner had merged', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: member.hashes[0] }], 40),
      memberRevoke(MEMBER_ID, 41)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe('entry-after-revocation')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 1 })
    expect(result.reason).toContain('merged up to index 0')
    expect(result.members[1]).toMatchObject({ revokedAt: 3, acceptedHeadIndex: 0 })
    // The chain itself is intact: the member signed it. The verdict is about
    // membership, not tampering.
    expect(result.memberChains.get(MEMBER_ID)?.valid).toBe(true)
  })

  it('reports every entry of a revoked member the Owner never merged', () => {
    const member = memberChain()
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), memberRevoke(MEMBER_ID, 41)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.outcome).toBe('entry-after-revocation')
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 0 })
    expect(result.reason).toContain('merged nothing')
  })

  it('reports a forged remote entry as that chain broken, not as the Case tampered elsewhere', () => {
    // A chain for the member signed by a key that is not the one the Owner's
    // member-add carries: the member's key is the only one that verifies it.
    const forged = memberChain(signWith(keyPair()))
    const { input } = twoMemberCase(forged)
    const result = verifySharedCase(input)
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe('chain-broken')
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 0 })
    expect(result.reason).toContain('Invalid signature')
    expect(result.owner.valid).toBe(true)
    expect(result.memberChains.get(MEMBER_ID)?.brokenAt).toBe(0)
  })

  it('reports an edited remote entry as that chain broken', () => {
    const member = memberChain()
    const lines = member.jsonl.trim().split('\n')
    lines[1] = lines[1].replace('statement-2.pdf', 'other-statement.pdf')
    const { input } = twoMemberCase({ jsonl: lines.join('\n') + '\n', hashes: member.hashes })
    const result = verifySharedCase(input)
    expect(result.outcome).toBe('chain-broken')
    expect(result.reason).toContain('Entry hash mismatch')
  })

  it('reports a merge naming a head the member chain does not have', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 5, entryHash: 'a'.repeat(64) }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe('merge-head-mismatch')
    expect(result.findings[0]).toMatchObject({ installationId: OWNER_ID, index: 2 })
    expect(result.reason).toContain('index 5')
    expect(result.reason).toContain('has 2 entries')
  })

  it('reports a merge whose head hash differs from the entry at that index', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: 'b'.repeat(64) }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.outcome).toBe('merge-head-mismatch')
    expect(result.reason).toContain('hash that differs')
  })

  it('reports a merge naming a member whose chain is not present', () => {
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: 'a'.repeat(64) }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.outcome).toBe('merge-head-mismatch')
    expect(result.reason).toContain('not present')
  })

  it('checks a member’s merge naming the Owner’s head the same way', () => {
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), exhibit(1)])
    const good = buildChain(
      [
        merge(
          [{ installationId: OWNER_ID, index: 2, entryHash: owner.hashes[2] }],
          50,
          MEMBER_OPERATOR
        )
      ],
      signWith(MEMBER_KEY)
    )
    const bad = buildChain(
      [
        merge(
          [{ installationId: OWNER_ID, index: 2, entryHash: 'c'.repeat(64) }],
          50,
          MEMBER_OPERATOR
        )
      ],
      signWith(MEMBER_KEY)
    )
    const verify = (member: BuiltChain) =>
      verifySharedCase({
        owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
        members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
      })
    expect(verify(good).valid).toBe(true)
    const result = verify(bad)
    expect(result.outcome).toBe('merge-head-mismatch')
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 0 })
  })

  it('reports a chain for an installation no member-add names', () => {
    const member = memberChain()
    const owner = buildChain([OWNER_ADD(), exhibit(1)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.outcome).toBe('unknown-member')
    expect(result.reason).toContain(`no member-add names installation ${MEMBER_ID}`)
    // Nothing in that chain was verified, so nothing in it is cited.
    expect(result.memberChains.has(MEMBER_ID)).toBe(false)
    expect([...result.citations.keys()]).toEqual(['CO-1'])
  })

  it('reports a chain supplied to a Case that has no roster at all', () => {
    const owner = buildChain([exhibit(1)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: memberChain().jsonl }]
    })
    expect(result.outcome).toBe('unknown-member')
    expect(result.reason).toContain('no member-add entries')
    // The Owner's own citations still resolve, unprefixed: the stray chain
    // contributed nothing, the Case is otherwise the single-member one.
    expect([...result.citations.keys()]).toEqual(['1'])
  })

  it('does not accept a revoked member’s late entries as merge heads or citations', () => {
    // A third member merged the revoked member's chain past what the Owner
    // accepted: that head now points at an entry the Case does not accept.
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: member.hashes[0] }], 40),
      memberRevoke(MEMBER_ID, 41),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 42)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.findings.map((f) => f.outcome)).toEqual([
      'entry-after-revocation',
      'merge-head-mismatch'
    ])
    expect(result.citations.has('RM-1')).toBe(true)
    expect(result.citations.has('RM-2')).toBe(false)
  })

  it('reports an exhibit claiming another member’s code', () => {
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR, { memberCode: 'CO' }), exhibit(2, MEMBER_OPERATOR)],
      signWith(MEMBER_KEY)
    )
    const { input } = twoMemberCase(member)
    const result = verifySharedCase(input)
    expect(result.outcome).toBe('citation-collision')
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 0 })
    expect(result.reason).toContain("claims Member Code CO, its writer's is RM")
  })

  it('reports two exhibits resolving to one citation', () => {
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR), exhibit(1, MEMBER_OPERATOR, { exhibitId: 'other' })],
      signWith(MEMBER_KEY)
    )
    const { input } = twoMemberCase(member)
    const result = verifySharedCase(input)
    expect(result.outcome).toBe('citation-collision')
    expect(result.reason).toContain('citation RM-1 resolves to exhibits')
  })

  it('reports the Owner’s chain broken before reading any roster from it', () => {
    const member = memberChain()
    const { owner } = twoMemberCase(member)
    const lines = owner.jsonl.trim().split('\n')
    lines[1] = lines[1].replace('"memberCode":"RM"', '"memberCode":"XX"')
    const result = verifySharedCase({
      owner: { jsonl: lines.join('\n') + '\n', publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.outcome).toBe('chain-broken')
    expect(result.findings).toEqual([
      {
        outcome: 'chain-broken',
        installationId: 'owner',
        index: 1,
        reason: 'Owner chain: Entry hash mismatch'
      }
    ])
    expect(result.members).toEqual([])
    expect(result.memberChains.size).toBe(0)
  })

  it('reports verifier-too-old from either chain, and not as tampering', () => {
    const future = { ...exhibit(3), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 }
    const member = buildChain([exhibit(1, MEMBER_OPERATOR), future], signWith(MEMBER_KEY))
    const { input } = twoMemberCase(member)
    const result = verifySharedCase(input)
    expect(result.outcome).toBe('verifier-too-old')
    expect(result.unsupported).toMatchObject({
      index: 1,
      schemaVersionSeen: MANIFEST_SCHEMA_VERSION + 1
    })
    expect(result.reason).toContain('verifier too old')
    expect(result.findings.some((f) => f.outcome === 'chain-broken')).toBe(false)

    const owner = buildChain([OWNER_ADD(), future])
    const fromOwner = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(fromOwner.outcome).toBe('verifier-too-old')
    expect(fromOwner.findings[0]).toMatchObject({ installationId: 'owner', index: 1 })
  })
})

describe('verifySharedCase — the roster', () => {
  const verifyOwner = (bodies: Record<string, unknown>[], members: BuiltChain[] = []) =>
    verifySharedCase({
      owner: { jsonl: buildChain(bodies).jsonl, publicKeyPem: getPublicKeyPem() },
      members: members.map((m) => ({ installationId: MEMBER_ID, jsonl: m.jsonl }))
    })

  it('requires the first member-add to name the Owner under the chain’s own key', () => {
    expect(verifyOwner([MEMBER_ADD()]).reason).toContain("role 'member', expected 'owner'")
    const otherKey = memberAdd(OWNER_ID, 'CO', keyPair().publicKey, 'owner', 0)
    expect(verifyOwner([otherKey]).reason).toContain(
      'a key other than the one its chain verified under'
    )
    expect(verifyOwner([MEMBER_ADD()]).outcome).toBe('roster-invalid')
  })

  it('refuses a second Owner, a reused code and a re-added installation', () => {
    const secondOwner = memberAdd('inst-c', 'C', keyPair().publicKey, 'owner', 2)
    expect(verifyOwner([OWNER_ADD(), secondOwner]).reason).toContain(
      "second member-add with role 'owner'"
    )
    const reusedCode = memberAdd('inst-c', 'RM', keyPair().publicKey, 'member', 2)
    expect(verifyOwner([OWNER_ADD(), MEMBER_ADD(), reusedCode]).reason).toContain(
      'reuses Member Code RM'
    )
    const readded = memberAdd(MEMBER_ID, 'R2', MEMBER_KEY.publicKey, 'member', 3)
    expect(
      verifyOwner([OWNER_ADD(), MEMBER_ADD(), memberRevoke(MEMBER_ID, 2), readded]).reason
    ).toContain('already on the roster')
  })

  it('refuses a revoke of an unknown, an already revoked, or the Owner installation', () => {
    expect(verifyOwner([OWNER_ADD(), memberRevoke(MEMBER_ID, 1)]).reason).toContain(
      'not on the roster'
    )
    expect(
      verifyOwner([
        OWNER_ADD(),
        MEMBER_ADD(),
        memberRevoke(MEMBER_ID, 2),
        memberRevoke(MEMBER_ID, 3)
      ]).reason
    ).toContain('already revoked')
    expect(verifyOwner([OWNER_ADD(), memberRevoke(OWNER_ID, 1)]).reason).toContain(
      'names the Owner'
    )
  })

  it('refuses an exclude naming an author not on the roster', () => {
    const result = verifyOwner([OWNER_ADD(), exclude('x', 5)])
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain(`author not on the roster (${MEMBER_ID})`)
    expect(result.exclusions).toEqual([])
  })

  it('refuses two chains for one installation', () => {
    const member = memberChain()
    const result = verifyOwner([OWNER_ADD(), MEMBER_ADD()], [member, member])
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('two chains supplied')
  })

  it('reports a membership entry written outside the Owner’s chain', () => {
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR), { ...memberRevoke(OWNER_ID, 9), ...MEMBER_OPERATOR }],
      signWith(MEMBER_KEY)
    )
    const result = verifyOwner([OWNER_ADD(), MEMBER_ADD()], [member])
    expect(result.outcome).toBe('roster-invalid')
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID, index: 1 })
    expect(result.reason).toContain("member-revoke entry written outside the Owner's chain")
  })
})

describe('verifySharedCaseReplica — from a member’s replica', () => {
  // The member's replica: its own chain (signed with its key, the anchor) and
  // the Owner's chain as received. The member merged the Owner's head.
  function memberReplica(ownerBodies: Record<string, unknown>[], mergeIndex?: number) {
    const owner = buildChain(ownerBodies)
    const head = mergeIndex ?? owner.hashes.length - 1
    const local = buildChain(
      [
        exhibit(1, MEMBER_OPERATOR),
        merge(
          [{ installationId: OWNER_ID, index: head, entryHash: owner.hashes[head] }],
          50,
          MEMBER_OPERATOR
        )
      ],
      signWith(MEMBER_KEY)
    )
    return {
      owner,
      local,
      input: {
        local: { jsonl: local.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
        others: [{ installationId: OWNER_ID, jsonl: owner.jsonl }]
      }
    }
  }

  it('locates the Owner’s chain, anchors its key through the local merge, and passes', () => {
    const { input } = memberReplica([OWNER_ADD(), MEMBER_ADD(), exhibit(1)])
    const result = verifySharedCaseReplica(input)
    expect(result.findings).toEqual([])
    expect(result.valid).toBe(true)
    expect(result.members.map((m) => m.installationId)).toEqual([OWNER_ID, MEMBER_ID])
    expect(result.memberChains.get(MEMBER_ID)?.valid).toBe(true)
    expect([...result.citations.keys()].sort()).toEqual(['CO-1', 'RM-1'])
  })

  it('is verifySharedCase when the local chain is the Owner’s', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40)
    ])
    const result = verifySharedCaseReplica({
      local: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      others: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.valid).toBe(true)
    expect(result.members).toHaveLength(2)
  })

  it('refuses an Owner chain the local chain never merged', () => {
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD()])
    const local = buildChain([exhibit(1, MEMBER_OPERATOR)], signWith(MEMBER_KEY))
    const result = verifySharedCaseReplica({
      local: { jsonl: local.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      others: [{ installationId: OWNER_ID, jsonl: owner.jsonl }]
    })
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('no merge in the local chain names the Owner')
    expect(result.members).toEqual([])
  })

  it('refuses an anchor that stops before the Owner’s member-add', () => {
    const { input } = memberReplica([exhibit(1), OWNER_ADD(), MEMBER_ADD()], 0)
    const result = verifySharedCaseReplica(input)
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('stops at index 0, before the Owner')
  })

  it('reports an Owner chain rewritten under the anchor as merge-head-mismatch', () => {
    // The member merged a genuine Owner head; the enclosed Owner chain was
    // then rewritten with a forger's key on the Owner's member-add. Its hash at
    // the merged index no longer matches what the member signed.
    const { input, owner } = memberReplica([OWNER_ADD(), MEMBER_ADD(), exhibit(1)])
    const forger = keyPair()
    const rewritten = buildChain(
      [memberAdd(OWNER_ID, 'CO', forger.publicKey, 'owner', 0), MEMBER_ADD(), exhibit(1)],
      signWith(forger)
    )
    expect(rewritten.hashes[2]).not.toBe(owner.hashes[2])
    const result = verifySharedCaseReplica({
      ...input,
      others: [{ installationId: OWNER_ID, jsonl: rewritten.jsonl }]
    })
    expect(result.valid).toBe(false)
    expect(result.findings.map((f) => f.outcome)).toContain('merge-head-mismatch')
  })

  it('refuses two chains that each claim the Owner', () => {
    const { input, owner } = memberReplica([OWNER_ADD(), MEMBER_ADD()])
    const other = buildChain([memberAdd('inst-c', 'C', keyPair().publicKey, 'owner', 0)])
    const result = verifySharedCaseReplica({
      ...input,
      others: [
        { installationId: OWNER_ID, jsonl: owner.jsonl },
        { installationId: 'inst-c', jsonl: other.jsonl }
      ]
    })
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('two chains claim the Owner')
  })

  it('refuses an Owner chain whose roster does not carry the local key', () => {
    const stranger = memberAdd(MEMBER_ID, 'RM', keyPair().publicKey, 'member', 1)
    const { input } = memberReplica([OWNER_ADD(), stranger])
    const result = verifySharedCaseReplica(input)
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('carries the local key')
  })

  it('falls back to the single-chain walk when no chain claims the Owner', () => {
    const local = buildChain([exhibit(1, MEMBER_OPERATOR)], signWith(MEMBER_KEY))
    const result = verifySharedCaseReplica({
      local: { jsonl: local.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      others: [{ installationId: 'inst-x', jsonl: memberChain().jsonl }]
    })
    expect(result.outcome).toBe('unknown-member')
    const broken = verifySharedCaseReplica({
      local: { jsonl: local.jsonl, publicKeyPem: getPublicKeyPem() },
      others: []
    })
    expect(broken.outcome).toBe('chain-broken')
  })

  it('names the four schema-4 entry types', () => {
    expect([...SHARED_CASE_ENTRY_TYPES].sort()).toEqual([
      'exclude',
      'member-add',
      'member-revoke',
      'merge'
    ])
  })
})

describe('verifyEvidencePackage — an enclosed Shared Case', () => {
  // The package layout step 3 of the build order ships: the exporter's chain as
  // manifest.jsonl, every other member's as manifest.<installationId>.jsonl.
  // The index is minimal because only the `shared case` rows are under test.
  function writePackage(owner: BuiltChain, member?: BuiltChain): string {
    const dir = mkdtempSync(join(tmpdir(), 'bb-shared-pkg-'))
    writeFileSync(join(dir, 'manifest.jsonl'), owner.jsonl)
    writeFileSync(join(dir, 'signing-public-key.pem'), getPublicKeyPem())
    if (member) writeFileSync(join(dir, `manifest.${MEMBER_ID}.jsonl`), member.jsonl)
    writeFileSync(
      join(dir, 'evidence.json'),
      JSON.stringify({
        schemaVersion: 2,
        verificationMaterials: {
          manifestPath: 'manifest.jsonl',
          manifestHeadIndex: owner.hashes.length - 1,
          manifestHeadHash: owner.hashes[owner.hashes.length - 1],
          signingPublicKeyPath: 'signing-public-key.pem'
        },
        captures: [],
        exhibits: [],
        artifacts: []
      })
    )
    return dir
  }

  const sharedRows = (dir: string) =>
    verifyEvidencePackage(dir).checks.filter((c) => c.name === 'shared case')

  it('walks the member chains and passes a good two-member Case', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40)
    ])
    const dir = writePackage(owner, member)
    try {
      const rows = sharedRows(dir)
      expect(rows).toEqual([
        {
          name: 'shared case',
          status: 'pass',
          reason: `2 member(s): CO=${OWNER_ID}, RM=${MEMBER_ID}`
        }
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names each non-pass outcome in a FAIL row', () => {
    const member = memberChain()
    const cases: Array<[string, BuiltChain, BuiltChain | undefined]> = [
      [
        'merge-head-mismatch',
        buildChain([
          OWNER_ADD(),
          MEMBER_ADD(),
          merge([{ installationId: MEMBER_ID, index: 7, entryHash: 'a'.repeat(64) }], 40)
        ]),
        member
      ],
      [
        'entry-after-revocation',
        buildChain([OWNER_ADD(), MEMBER_ADD(), memberRevoke(MEMBER_ID, 41)]),
        member
      ],
      ['unknown-member', buildChain([OWNER_ADD()]), member],
      ['chain-broken', buildChain([OWNER_ADD(), MEMBER_ADD()]), memberChain(signWith(keyPair()))]
    ]
    for (const [outcome, owner, remote] of cases) {
      const dir = writePackage(owner, remote)
      try {
        const result = verifyEvidencePackage(dir)
        expect(result.pass, outcome).toBe(false)
        const rows = result.checks.filter((c) => c.name === 'shared case')
        expect(
          rows.map((r) => r.status),
          outcome
        ).toEqual(['fail'])
        expect(rows[0].reason, outcome).toContain(`${outcome}: `)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('walks a package a non-Owner member exported', () => {
    // manifest.jsonl is the exporting member's chain under the package key;
    // the Owner's chain is enclosed beside it and anchored by the member's merge.
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), exhibit(1)])
    const local = buildChain(
      [
        exhibit(1, MEMBER_OPERATOR),
        merge(
          [{ installationId: OWNER_ID, index: 2, entryHash: owner.hashes[2] }],
          50,
          MEMBER_OPERATOR
        )
      ],
      signWith(MEMBER_KEY)
    )
    const dir = mkdtempSync(join(tmpdir(), 'bb-shared-pkg-'))
    try {
      writeFileSync(join(dir, 'manifest.jsonl'), local.jsonl)
      writeFileSync(join(dir, 'signing-public-key.pem'), MEMBER_KEY.publicKey)
      writeFileSync(join(dir, `manifest.${OWNER_ID}.jsonl`), owner.jsonl)
      writeFileSync(
        join(dir, 'evidence.json'),
        JSON.stringify({
          schemaVersion: 2,
          verificationMaterials: {
            manifestPath: 'manifest.jsonl',
            manifestHeadIndex: 1,
            manifestHeadHash: local.hashes[1],
            signingPublicKeyPath: 'signing-public-key.pem'
          },
          captures: [],
          exhibits: [],
          artifacts: []
        })
      )
      expect(sharedRows(dir)).toEqual([
        {
          name: 'shared case',
          status: 'pass',
          reason: `2 member(s): CO=${OWNER_ID}, RM=${MEMBER_ID}`
        }
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists an exclusion as an annotation and keeps the pass', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40),
      exclude(`${MEMBER_ID}-exhibit-1`, 41, 'outside scope')
    ])
    const dir = writePackage(owner, member)
    try {
      const result = verifyEvidencePackage(dir)
      expect(sharedRows(dir)[0].status).toBe('pass')
      const annotation = result.checks.find(
        (c) => c.name === `exhibit ${MEMBER_ID}-exhibit-1 excluded`
      )
      expect(annotation).toEqual({
        name: `exhibit ${MEMBER_ID}-exhibit-1 excluded`,
        status: 'skip',
        reason: `excluded by the Owner at index 3 (author ${MEMBER_ID}) — outside scope`
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not walk a Case with no membership entries and no member chains', () => {
    const dir = writePackage(buildChain([exhibit(1)]))
    try {
      expect(sharedRows(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a member chain from a newer schema as verifier too old', () => {
    const future = { ...exhibit(3, MEMBER_OPERATOR), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 }
    const member = buildChain([exhibit(1, MEMBER_OPERATOR), future], signWith(MEMBER_KEY))
    const dir = writePackage(buildChain([OWNER_ADD(), MEMBER_ADD()]), member)
    try {
      const result = verifyEvidencePackage(dir)
      expect(result.pass).toBe(false)
      expect(result.unsupported?.reason).toContain('verifier-too-old: ')
      expect(result.unsupported?.reason).toContain('verifier too old')
      expect(result.checks.some((c) => c.status === 'fail')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
