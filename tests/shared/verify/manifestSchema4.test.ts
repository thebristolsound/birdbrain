import { describe, it, expect } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import {
  buildTrustedTimeIndexFromEntries,
  canonicalStringify,
  findRepeatedExhibitNumbers,
  verifyManifestChainText,
  verifySharedCase,
  verifySharedCaseReplica,
  SHARED_CASE_ENTRY_TYPES
} from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema, MEMBER_CODE_PATTERN } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import {
  lineageChainPath,
  memberChainPath,
  parseChainPath
} from '../../../src/packages/evidence-package-layout/index'
import { VERIFY_RUNBOOK } from '@main/services/verifyRunbook'
import { HAS_JQ } from '../../helpers/jq'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'

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
  // `memberCode` is a schema-4 field: an entry carrying it is stamped 4, which
  // is what makes a schema-3 verifier answer "too old" and not "broken".
  schemaVersion: over.memberCode === undefined ? 3 : 4,
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

  it('refuses memberCode and subject on an entry stamped below 4', () => {
    // A schema-3 verifier's strict shapes have neither field, so it would call
    // such an entry broken, not "too old" (X25). This reader refuses it too.
    const coded = { ...exhibit(1), memberCode: 'CO', index: 0, prevHash: '', schemaVersion: 3 }
    expect(ManifestEntrySchema.safeParse({ ...coded, entryHash: entryHashOf(coded) }).success).toBe(
      false
    )
    for (const schemaVersion of [2, 3]) {
      const stamp = {
        type: 'timestamp',
        caseId: CASE_ID,
        captureContentHash: 'a'.repeat(64),
        subject: 'entry',
        timestamp: '2026-09-19T13:00:00.000Z',
        ...OPERATOR,
        index: 0,
        prevHash: '',
        schemaVersion
      }
      expect(
        ManifestEntrySchema.safeParse({ ...stamp, entryHash: entryHashOf(stamp) }).success
      ).toBe(false)
    }
  })

  it('does not read a stamp whose subject no schema defines as trusted time', () => {
    // These helpers read LENIENT records — raw manifest lines before the
    // strict parse — so an unknown value must not fall through to `content`
    // and stamp evidence the chain walk goes on to reject (#1518 review).
    const hash = 'a'.repeat(64)
    const entries = [
      { type: 'capture', contentHash: hash, schemaVersion: 2 },
      { type: 'timestamp', subject: 'exhibit', captureContentHash: hash, tsaToken: 'AAAA' }
    ]
    expect(buildTrustedTimeIndexFromEntries(entries).get(hash)).toEqual({ trustedTime: 'pending' })
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
        index: 3,
        timestamp: '2026-09-19T12:41:00.000Z',
        operatorName: OPERATOR.operatorName
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
    // The missing chain is a finding of its own, and the merge that names it
    // is still reported.
    expect(result.outcome).toBe('member-chain-missing')
    const mismatch = result.findings.find((f) => f.outcome === 'merge-head-mismatch')
    expect(mismatch?.reason).toContain('not present')
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

  it('leaves one chain numbering two exhibits alike to the X48 report, not a failed walk', () => {
    // Before X48 this was `citation-collision`, a FAIL. A number a member's own
    // chain issued twice is an Integrity Exception: both entries verify, and
    // what fails is a citation of the number, which the repeated-number check
    // over that chain reports. The first assignment keeps the citation.
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR), exhibit(1, MEMBER_OPERATOR, { exhibitId: 'other' })],
      signWith(MEMBER_KEY)
    )
    const { input } = twoMemberCase(member)
    const result = verifySharedCase(input)
    expect(result.findings).toEqual([])
    expect(result.outcome).toBe('pass')
    expect(result.citations.get('RM-1')?.exhibitId).toBe(`${MEMBER_ID}-exhibit-1`)
    expect(findRepeatedExhibitNumbers(result.entries.get(MEMBER_ID)!)).toEqual([
      { exhibitNumber: 1, exhibitIds: [`${MEMBER_ID}-exhibit-1`, 'other'], indices: [0, 1] }
    ])
  })

  it('resolves a capture entry’s own number as a citation (X46)', () => {
    const capture = {
      type: 'capture',
      captureId: 'member-capture',
      caseId: CASE_ID,
      url: 'https://example.com/member',
      timestamp: '2026-09-19T12:20:00.000Z',
      contentHash: 'c'.repeat(64),
      exhibitNumber: 3,
      sizeBytes: 10,
      ...MEMBER_OPERATOR,
      schemaVersion: 3
    }
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR), exhibit(2, MEMBER_OPERATOR), capture],
      signWith(MEMBER_KEY)
    )
    const result = verifySharedCase(twoMemberCase(member).input)
    expect(result.findings).toEqual([])
    expect(result.citations.get('RM-3')).toMatchObject({
      installationId: MEMBER_ID,
      index: 2,
      exhibitId: 'member-capture'
    })
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

describe('verifySharedCase — what a roster member owes', () => {
  const THIRD_ID = 'inst-third'
  const THIRD_KEY = keyPair()
  const THIRD_OPERATOR = { operatorId: THIRD_ID, operatorName: 'Sam Third', toolVersion: '0.5.0' }
  const THIRD_ADD = (): Record<string, unknown> =>
    memberAdd(THIRD_ID, 'ST', THIRD_KEY.publicKey, 'member', 2)

  it('reports a merge head naming its own writer’s chain', () => {
    // A `merge` records what a session brought in from ANOTHER member.
    const owner = buildChain([OWNER_ADD(), exhibit(1)])
    const selfNamed = buildChain([
      OWNER_ADD(),
      exhibit(1),
      merge([{ installationId: OWNER_ID, index: 1, entryHash: owner.hashes[1] }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: selfNamed.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.outcome).toBe('merge-head-mismatch')
    expect(result.reason).toContain('names its own chain as a head')
  })

  it('reports a merge naming the literal owner key in a Case with no roster', () => {
    // With no `member-add`, the Owner's entries are keyed by the literal
    // `owner`; a merge naming it must not resolve against the writer's own
    // earlier entries and pass as a zero-member Shared Case (#1518 review).
    const first = buildChain([exhibit(1)])
    const chain = buildChain([
      exhibit(1),
      merge([{ installationId: 'owner', index: 0, entryHash: first.hashes[0] }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: chain.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe('merge-head-mismatch')
  })

  it('reports a roster member whose chain was not supplied', () => {
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), exhibit(1)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.findings.map((f) => f.outcome)).toEqual(['member-chain-missing'])
    expect(result.findings[0]).toMatchObject({ installationId: MEMBER_ID })
  })

  it('does not ask for the chain of a revoked member the Owner never merged', () => {
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), memberRevoke(MEMBER_ID, 41)])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.valid).toBe(true)
  })

  it('refuses a member chain whose current entries name another Case', () => {
    const otherCase = '0196f7a2-aaaa-bbbb-cccc-00000000ffff'
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR, { caseId: otherCase })],
      signWith(MEMBER_KEY)
    )
    const { input } = twoMemberCase(member)
    const result = verifySharedCase({
      ...input,
      owner: {
        ...input.owner,
        jsonl: buildChain([
          OWNER_ADD(),
          MEMBER_ADD(),
          merge([{ installationId: MEMBER_ID, index: 0, entryHash: member.hashes[0] }], 40)
        ]).jsonl
      }
    })
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain(`names Case ${otherCase}`)
    // Nothing of the foreign chain is accepted: no citation, no merge target.
    expect(result.citations.has('RM-1')).toBe(false)
    expect(result.entries.has(MEMBER_ID)).toBe(false)
    expect(result.findings.map((f) => f.outcome)).toContain('merge-head-mismatch')
  })

  it('accepts a member chain whose imported history names its source Case', () => {
    // Entries before an `import` are the source Case's, under the source key;
    // only what the member wrote from the import on must name this Case.
    const sourceKey = keyPair()
    const sourceCase = '0196f7a2-aaaa-bbbb-cccc-00000000eeee'
    let signed = 0
    const member = buildChain(
      [
        exhibit(1, MEMBER_OPERATOR, { caseId: sourceCase, exhibitNumber: 7 }),
        {
          type: 'import',
          caseId: CASE_ID,
          sourceCaseId: sourceCase,
          sourceInstallationId: 'inst-source',
          sourcePublicKeyPem: sourceKey.publicKey,
          packageHash: 'c'.repeat(64),
          idMapSha256: 'd'.repeat(64),
          verificationResult: {
            overallValid: true,
            chainValid: true,
            artifactCount: 0,
            artifactFailureCount: 0,
            captureCount: 0,
            captureHashFailureCount: 0
          },
          timestamp: '2026-09-19T12:20:00.000Z',
          ...MEMBER_OPERATOR,
          schemaVersion: 2
        },
        exhibit(1, MEMBER_OPERATOR)
      ],
      (entryHash) => signWith(signed++ === 0 ? sourceKey : MEMBER_KEY)(entryHash)
    )
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 2, entryHash: member.hashes[2] }], 40)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.findings).toEqual([])
  })

  it('refuses an Owner chain whose own entries name another Case', () => {
    const owner = buildChain([OWNER_ADD(), exhibit(1, OPERATOR, { caseId: 'another-case' })])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: []
    })
    expect(result.outcome).toBe('roster-invalid')
    expect(result.reason).toContain('names Case another-case')
  })

  it('reports two entries for one citation even when they name one Exhibit', () => {
    const member = buildChain(
      [exhibit(1, MEMBER_OPERATOR), exhibit(1, MEMBER_OPERATOR, { contentHash: 'b'.repeat(64) })],
      signWith(MEMBER_KEY)
    )
    const result = verifySharedCase(twoMemberCase(member).input)
    expect(result.outcome).toBe('citation-collision')
    expect(result.reason).toContain('resolves to two entries for exhibit')
  })

  it('reports an exclude naming an Exhibit its stated author does not hold', () => {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      exhibit(1),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40),
      // The Owner's own Exhibit, attributed to the member.
      exclude(`${OWNER_ID}-exhibit-1`, 41)
    ])
    const result = verifySharedCase({
      owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
      members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }]
    })
    expect(result.outcome).toBe('roster-invalid')
    expect(result.findings[0]).toMatchObject({ index: 4 })
    expect(result.reason).toContain(`the chain of ${MEMBER_ID} does not hold`)
  })

  it('keeps a proven failure when another chain is from a newer schema, in either order', () => {
    const future = { ...exhibit(2, THIRD_OPERATOR), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 }
    const tooNew = buildChain([exhibit(1, THIRD_OPERATOR), future], signWith(THIRD_KEY))
    const forged = memberChain(signWith(keyPair()))
    const owner = buildChain([OWNER_ADD(), MEMBER_ADD(), THIRD_ADD()])
    const chains = [
      { installationId: THIRD_ID, jsonl: tooNew.jsonl },
      { installationId: MEMBER_ID, jsonl: forged.jsonl }
    ]
    for (const members of [chains, [...chains].reverse()]) {
      const result = verifySharedCase({
        owner: { jsonl: owner.jsonl, publicKeyPem: getPublicKeyPem() },
        members
      })
      // "Too old" is never the verdict once this build has proved tampering.
      expect(result.outcome).toBe('chain-broken')
      expect(result.unsupported).toBeUndefined()
      expect(result.findings.map((f) => f.outcome)).toEqual(['chain-broken', 'verifier-too-old'])
    }
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
    const sharedKey = memberAdd('inst-c', 'C', MEMBER_KEY.publicKey, 'member', 2)
    expect(verifyOwner([OWNER_ADD(), MEMBER_ADD(), sharedKey]).reason).toContain(
      `carries the key of ${MEMBER_ID}`
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
          reason: `manifest schema 4; 2 member(s): CO=${OWNER_ID}, RM=${MEMBER_ID}`
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
      ['member-chain-missing', buildChain([OWNER_ADD(), MEMBER_ADD()]), undefined],
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

  it('binds a remote member’s Exhibit to the bytes the package encloses', () => {
    // The member's verified chain says RM-1 exists, so the package owes its
    // file exactly as it owes the exporter's own (#1518 review).
    const member = buildChain([exhibit(1, MEMBER_OPERATOR)], signWith(MEMBER_KEY))
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: member.hashes[0] }], 40)
    ])
    const exhibitId = `${MEMBER_ID}-exhibit-1`
    const rowFor = (dir: string) =>
      verifyEvidencePackage(dir).checks.find((c) => c.name === `exhibit ${exhibitId}`)

    const missing = writePackage(owner, member)
    const present = writePackage(owner, member)
    try {
      expect(rowFor(missing)).toMatchObject({ status: 'fail' })
      expect(rowFor(missing)?.reason).toContain('Exhibit RM-1 (document)')

      mkdirSync(join(present, 'documents'))
      writeFileSync(join(present, 'documents', `${exhibitId}.pdf`), `${MEMBER_ID}-1`)
      expect(rowFor(present)).toMatchObject({ status: 'pass' })
    } finally {
      rmSync(missing, { recursive: true, force: true })
      rmSync(present, { recursive: true, force: true })
    }
  })

  it('walks a package whose only schema-4 signal is an exhibit’s memberCode', () => {
    // The entry claims a citation prefix, and only a roster says whose it is:
    // the single-chain path would keep the prefix unvalidated (#1518 review).
    const owner = buildChain([exhibit(1, OPERATOR, { memberCode: 'CO' })])
    const dir = writePackage(owner)
    try {
      const rows = sharedRows(dir)
      expect(rows.map((r) => r.status)).toEqual(['fail'])
      expect(rows[0].reason).toContain('citation-collision: ')
      expect(rows[0].reason).toContain('a Case with no roster')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not let one member’s deletion remove another member’s Exhibit', () => {
    const member = buildChain([exhibit(1, MEMBER_OPERATOR)], signWith(MEMBER_KEY))
    const exhibitId = `${MEMBER_ID}-exhibit-1`
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      merge([{ installationId: MEMBER_ID, index: 0, entryHash: member.hashes[0] }], 40),
      {
        type: 'deletion',
        captureId: exhibitId,
        caseId: CASE_ID,
        contentHash: createHash('sha256').update(`${MEMBER_ID}-1`).digest('hex'),
        reason: 'not mine to delete',
        timestamp: '2026-09-19T12:45:00.000Z',
        ...OPERATOR,
        schemaVersion: 3
      }
    ])
    const dir = writePackage(owner, member)
    try {
      const result = verifyEvidencePackage(dir)
      const chainRow = result.checks.find((c) => c.name === 'manifest chain')
      expect(chainRow?.status).toBe('pass')
      // Still owed: the file is absent, and the row says so.
      expect(result.checks.find((c) => c.name === `exhibit ${exhibitId}`)?.status).toBe('fail')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a proven failure as FAIL beside a chain from a newer schema', () => {
    const thirdKey = keyPair()
    const future = { ...exhibit(1, MEMBER_OPERATOR), schemaVersion: MANIFEST_SCHEMA_VERSION + 1 }
    const tooNew = buildChain([future], signWith(thirdKey))
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      memberAdd('inst-third', 'ST', thirdKey.publicKey, 'member', 2)
    ])
    const dir = writePackage(owner, memberChain(signWith(keyPair())))
    try {
      writeFileSync(join(dir, 'manifest.inst-third.jsonl'), tooNew.jsonl)
      const result = verifyEvidencePackage(dir)
      expect(result.unsupported).toBeUndefined()
      const rows = result.checks.filter((c) => c.name === 'shared case')
      expect(rows.map((r) => [r.status, r.reason?.split(':')[0]])).toEqual([
        ['fail', 'chain-broken'],
        ['skip', 'verifier-too-old']
      ])

      // Alone, the unreadable chain is "too old" and not a verdict.
      writeFileSync(join(dir, `manifest.${MEMBER_ID}.jsonl`), memberChain().jsonl)
      expect(verifyEvidencePackage(dir).unsupported?.reason).toContain('verifier-too-old')
    } finally {
      rmSync(dir, { recursive: true, force: true })
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
          reason: `manifest schema 4; 2 member(s): CO=${OWNER_ID}, RM=${MEMBER_ID}`
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
        reason: `excluded by ${OPERATOR.operatorName} (the Owner) at 2026-09-19T12:41:00.000Z, index 3 (author ${MEMBER_ID}) — outside scope`
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

describe('verifySharedCase — a Case forked from a replica', () => {
  // A fork continues the source Owner's chain behind an `import` naming the
  // Owner's key, signed by the installation that forked it; the source Case's
  // other member chains travel as lineage (#1511). Here the member forks.
  const FORK_ID = '0196f7a2-aaaa-bbbb-cccc-00000000f0f0'
  const FORK_OPERATOR = { ...MEMBER_OPERATOR, operatorName: 'Robin Forker' }

  const importEntry = (
    caseId: string,
    sourceCaseId: string,
    sourceInstallationId: string,
    sourcePublicKeyPem: string,
    operator = FORK_OPERATOR
  ): Record<string, unknown> => ({
    type: 'import',
    caseId,
    sourceCaseId,
    sourceInstallationId,
    sourcePublicKeyPem,
    packageHash: 'c'.repeat(64),
    idMapSha256: 'd'.repeat(64),
    verificationResult: {
      overallValid: true,
      chainValid: true,
      artifactCount: 0,
      artifactFailureCount: 0,
      captureCount: 0,
      captureHashFailureCount: 0
    },
    timestamp: '2026-09-27T09:00:00.000Z',
    ...operator,
    schemaVersion: 2
  })

  // The bodies of a chain continued past `base`, each signed by `sign`.
  function extend(
    base: BuiltChain,
    bodies: Record<string, unknown>[],
    sign: (entryHash: string) => string
  ): BuiltChain {
    let prevHash = base.hashes.at(-1) ?? ''
    const hashes = [...base.hashes]
    const lines = bodies.map((body, i) => {
      const full = { ...body, index: base.hashes.length + i, prevHash }
      const entryHash = entryHashOf(full)
      prevHash = entryHash
      hashes.push(entryHash)
      return JSON.stringify({ ...full, entryHash, signature: sign(entryHash) })
    })
    return { jsonl: base.jsonl + lines.join('\n') + '\n', hashes }
  }

  function forkFixture(ownerExtra: Record<string, unknown>[] = []) {
    const member = memberChain()
    const owner = buildChain([
      OWNER_ADD(),
      MEMBER_ADD(),
      exhibit(1),
      merge([{ installationId: MEMBER_ID, index: 1, entryHash: member.hashes[1] }], 40),
      ...ownerExtra
    ])
    const fork = extend(
      owner,
      [
        importEntry(FORK_ID, CASE_ID, OWNER_ID, getPublicKeyPem()),
        exhibit(1, FORK_OPERATOR, { caseId: FORK_ID, exhibitId: 'fork-exhibit-1' })
      ],
      signWith(MEMBER_KEY)
    )
    const lineage = [
      { sourceCaseId: CASE_ID, members: [{ installationId: MEMBER_ID, jsonl: member.jsonl }] }
    ]
    return { owner, member, fork, lineage }
  }

  it('verifies the source Case from the history before the import, and passes', () => {
    const { fork, lineage } = forkFixture()
    const result = verifySharedCase({
      owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      members: [],
      lineage
    })
    expect(result.findings).toEqual([])
    // The fork has one member until it is shared again.
    expect(result.members).toEqual([])
    expect(result.lineage.map((l) => [l.sourceCaseId, l.members.map((m) => m.memberCode)])).toEqual(
      [[CASE_ID, ['CO', 'RM']]]
    )
    // Source citations keep their prefix and their Case; the fork's own
    // Exhibit 1 cites bare beside them without colliding.
    const cited = [...result.citations.values()].map((c) => [c.citation, c.sourceCaseId])
    expect(cited).toEqual(
      expect.arrayContaining([
        ['CO-1', CASE_ID],
        ['RM-1', CASE_ID],
        ['RM-2', CASE_ID],
        ['1', undefined]
      ])
    )
    expect(result.entries.get(`${CASE_ID}/${MEMBER_ID}`)).toHaveLength(2)
  })

  it('passes from the replica walk a package verifier runs', () => {
    const { fork, lineage } = forkFixture()
    const result = verifySharedCaseReplica({
      local: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      others: [],
      lineage
    })
    expect(result.findings).toEqual([])
    expect(result.lineage).toHaveLength(1)
  })

  it('names the source Case in a finding about a lineage chain', () => {
    const { fork } = forkFixture()
    const forged = buildChain(
      [exhibit(1, MEMBER_OPERATOR), exhibit(2, MEMBER_OPERATOR, { memberCode: 'RM' })],
      signWith(keyPair())
    )
    const result = verifySharedCase({
      owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      members: [],
      lineage: [
        { sourceCaseId: CASE_ID, members: [{ installationId: MEMBER_ID, jsonl: forged.jsonl }] }
      ]
    })
    expect(result.valid).toBe(false)
    expect(result.outcome).toBe('chain-broken')
    expect(result.reason).toMatch(new RegExp(`^lineage Case ${CASE_ID}: chain of ${MEMBER_ID}`))
  })

  it('asks for the source Case’s member chains', () => {
    const { fork } = forkFixture()
    const result = verifySharedCase({
      owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      members: []
    })
    expect(result.outcome).toBe('member-chain-missing')
    expect(result.reason).toContain(`lineage Case ${CASE_ID}: `)
  })

  it('refuses lineage chains for a Case no import names', () => {
    const { fork, lineage } = forkFixture()
    const stray = { sourceCaseId: 'another-case', members: lineage[0].members }
    const result = verifySharedCase({
      owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      members: [],
      lineage: [...lineage, stray]
    })
    expect(result.findings.map((f) => f.outcome)).toEqual(['roster-invalid'])
    expect(result.reason).toContain('another-case')
  })

  it('refuses a fork whose import names a key other than the source Owner’s', () => {
    const { owner, lineage } = forkFixture()
    const fork = extend(
      owner,
      [importEntry(FORK_ID, CASE_ID, OWNER_ID, MEMBER_KEY.publicKey)],
      signWith(MEMBER_KEY)
    )
    const result = verifySharedCase({
      owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
      members: [],
      lineage
    })
    // The chain walk verifies the history under the key the import names, so
    // a wrong key fails there, before any roster is read.
    expect(result.outcome).toBe('chain-broken')
  })

  it('refuses an import that names another source Case or Owner than its history', () => {
    const { owner, lineage } = forkFixture()
    for (const [sourceCaseId, sourceInstallationId, named] of [
      ['some-other-case', OWNER_ID, 'source Case some-other-case'],
      [CASE_ID, MEMBER_ID, `source installation ${MEMBER_ID}`]
    ]) {
      const fork = extend(
        owner,
        [importEntry(FORK_ID, sourceCaseId, sourceInstallationId, getPublicKeyPem())],
        signWith(MEMBER_KEY)
      )
      const result = verifySharedCase({
        owner: { jsonl: fork.jsonl, publicKeyPem: MEMBER_KEY.publicKey },
        members: [],
        lineage: [{ ...lineage[0], sourceCaseId }]
      })
      expect(result.findings.map((f) => f.outcome)).toContain('roster-invalid')
      expect(result.findings.map((f) => f.reason).join('\n')).toContain(named)
    }
  })

  // The fork shared again by the member that forked it, as a third member's
  // replica holds it: the forking member's chain is now the Owner's.
  function resharedFixture() {
    const { fork, member, lineage } = forkFixture()
    const THIRD_KEY = keyPair()
    const THIRD = { operatorId: 'inst-third', operatorName: 'Sam Third', toolVersion: '0.5.0' }
    const again = { caseId: FORK_ID, ...FORK_OPERATOR }
    const reshared = extend(
      fork,
      [
        { ...memberAdd(MEMBER_ID, 'RF', MEMBER_KEY.publicKey, 'owner', 50), ...again },
        { ...memberAdd(THIRD.operatorId, 'ST', THIRD_KEY.publicKey, 'member', 51), ...again }
      ],
      signWith(MEMBER_KEY)
    )
    const ownerHead = reshared.hashes.length - 1
    const third = buildChain(
      [
        exhibit(1, THIRD, { caseId: FORK_ID }),
        {
          ...merge(
            [
              { installationId: MEMBER_ID, index: ownerHead, entryHash: reshared.hashes[ownerHead] }
            ],
            52,
            THIRD
          ),
          caseId: FORK_ID
        }
      ],
      signWith(THIRD_KEY)
    )
    return { THIRD, THIRD_KEY, member, lineage, reshared, ownerHead, third }
  }

  it('verifies a fork shared again from a member’s replica', () => {
    const { THIRD, THIRD_KEY, lineage, reshared, third } = resharedFixture()
    const result = verifySharedCaseReplica({
      local: { jsonl: third.jsonl, publicKeyPem: THIRD_KEY.publicKey },
      others: [{ installationId: MEMBER_ID, jsonl: reshared.jsonl }],
      lineage
    })
    expect(result.findings).toEqual([])
    expect(result.localInstallationId).toBe(THIRD.operatorId)
    expect(result.members.map((m) => [m.memberCode, m.role])).toEqual([
      ['RF', 'owner'],
      ['ST', 'member']
    ])
  })

  it('verifies a fork of a fork, one source Case per import', () => {
    const { fork, lineage } = forkFixture()
    const THIRD_KEY = keyPair()
    const THIRD = { operatorId: 'inst-third', operatorName: 'Sam Third', toolVersion: '0.5.0' }
    const second = extend(
      fork,
      [importEntry('fork-of-fork', FORK_ID, MEMBER_ID, MEMBER_KEY.publicKey, THIRD)],
      signWith(THIRD_KEY)
    )
    const result = verifySharedCase({
      owner: { jsonl: second.jsonl, publicKeyPem: THIRD_KEY.publicKey },
      members: [],
      lineage
    })
    expect(result.findings).toEqual([])
    expect(result.lineage.map((l) => [l.sourceCaseId, l.members.length])).toEqual([
      [FORK_ID, 0],
      [CASE_ID, 2]
    ])
  })

  it('carries a source Owner’s exclusion with its Case, and the package lists it', () => {
    const { fork, member } = forkFixture([exclude(`${MEMBER_ID}-exhibit-1`, 42, 'off topic')])
    const dir = mkdtempSync(join(tmpdir(), 'bb-fork-pkg-'))
    try {
      writeFileSync(join(dir, 'manifest.jsonl'), fork.jsonl)
      writeFileSync(join(dir, 'signing-public-key.pem'), MEMBER_KEY.publicKey)
      mkdirSync(join(dir, 'lineage', CASE_ID), { recursive: true })
      writeFileSync(join(dir, lineageChainPath(CASE_ID, MEMBER_ID)), member.jsonl)
      writeFileSync(join(dir, 'evidence.json'), JSON.stringify({ schemaVersion: 2, captures: [] }))
      const result = verifyEvidencePackage(dir)
      expect(result.checks.find((c) => c.name === 'shared case')).toEqual({
        name: 'shared case',
        status: 'pass',
        reason:
          `manifest schema 4; 0 member(s); forked from Case ${CASE_ID}, ` +
          `2 member(s): CO=${OWNER_ID}, RM=${MEMBER_ID}`
      })
      expect(
        result.checks.find((c) => c.name === `exhibit ${MEMBER_ID}-exhibit-1 excluded`)
      ).toEqual({
        name: `exhibit ${MEMBER_ID}-exhibit-1 excluded`,
        status: 'skip',
        reason:
          `excluded by ${OPERATOR.operatorName} (the Owner of Case ${CASE_ID}) at ` +
          `2026-09-19T12:42:00.000Z, index 4 (author ${MEMBER_ID}) — off topic`
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // The Shared Case blocks of the shipped VERIFY.md, run under bash over the
  // chain files `files` names, the way a reader runs them in a package.
  function runbookOver(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'bb-fork-runbook-'))
    try {
      for (const [path, jsonl] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), jsonl)
      }
      const blocks = extractRunbookBlocks(VERIFY_RUNBOOK).filter((b) =>
        b.section.startsWith('Shared Case packages')
      )
      expect(blocks).toHaveLength(2)
      const run = runRunbookBlocks(blocks, { cwd: dir })
      expect([run.failedBlock, run.stderr]).toEqual([null, ''])
      return run.stdout
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it.skipIf(!HAS_JQ)('resolves a fork’s history merges against its lineage chains', () => {
    const { fork, member } = forkFixture()
    const out = runbookOver({
      'manifest.jsonl': fork.jsonl,
      [lineageChainPath(CASE_ID, MEMBER_ID)]: member.jsonl
    })
    expect(out.split('\n').filter(Boolean)).toEqual([
      `${CASE_ID} CO owner ${OWNER_ID}`,
      `${CASE_ID} RM member ${MEMBER_ID}`,
      `head OK: ${MEMBER_ID} #1`
    ])
  })

  it.skipIf(!HAS_JQ)(
    'resolves each merge of a re-shared fork in its own Case when one member is in both',
    () => {
      const { member, reshared, ownerHead, third } = resharedFixture()
      const out = runbookOver({
        'manifest.jsonl': third.jsonl,
        [memberChainPath(MEMBER_ID)]: reshared.jsonl,
        [lineageChainPath(CASE_ID, MEMBER_ID)]: member.jsonl
      })
      const lines = out.split('\n').filter(Boolean)
      expect(lines.filter((l) => !l.startsWith('head '))).toEqual([
        `${CASE_ID} CO owner ${OWNER_ID}`,
        `${CASE_ID} RM member ${MEMBER_ID}`,
        `${FORK_ID} RF owner ${MEMBER_ID}`,
        `${FORK_ID} ST member inst-third`
      ])
      expect(lines.filter((l) => l.startsWith('head ')).sort()).toEqual(
        [`head OK: ${MEMBER_ID} #${ownerHead}`, `head OK: ${MEMBER_ID} #1`].sort()
      )
    }
  )

  it.skipIf(!HAS_JQ)('still reports a history merge whose lineage head was edited', () => {
    const { fork, member } = forkFixture()
    const edited = member.jsonl.replace(member.hashes[1], 'f'.repeat(64))
    const out = runbookOver({
      'manifest.jsonl': fork.jsonl,
      [lineageChainPath(CASE_ID, MEMBER_ID)]: edited
    })
    expect(out).toContain(`head MISMATCH: ${MEMBER_ID} #1`)
  })

  it('reads the lineage directory by the Package Layout’s names only', () => {
    expect(parseChainPath(memberChainPath(MEMBER_ID))).toEqual({ installationId: MEMBER_ID })
    expect(parseChainPath(lineageChainPath(CASE_ID, MEMBER_ID))).toEqual({
      installationId: MEMBER_ID,
      sourceCaseId: CASE_ID
    })
    for (const name of [
      'manifest.jsonl',
      'manifest..jsonl',
      'lineage/../manifest.x.jsonl',
      'lineage/a/b/manifest.x.jsonl',
      'other/a/manifest.x.jsonl',
      'manifest.a\\b.jsonl'
    ]) {
      expect(parseChainPath(name)).toBeNull()
    }
  })
})
