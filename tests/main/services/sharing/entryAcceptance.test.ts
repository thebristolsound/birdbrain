import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import type { CaseMember } from '@shared/types'
import { ManifestEntrySchema } from '@shared/schemas'
import {
  acceptEntrySegment,
  foreignCaseEntry,
  nonEmptyLines
} from '@main/services/sharing/entryAcceptance'
import { appendFutureEntry } from '../../../helpers/futureManifestEntry'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'

// Acceptance of a remote member's chain segment (#1512): appended only when
// the stored chain plus the segment verifies as one chain under the member's
// key and the segment starts at the stored head; dropped whole otherwise. An
// entry from a newer schema stops the chain before it and is not a forgery.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000003'
const MEMBER_ID = 'installation-member-0001'

const otherKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
})

function exhibitBody(n: number, caseId = CASE_ID): Record<string, unknown> {
  return {
    type: 'exhibit',
    exhibitId: `x-${n}`,
    caseId,
    kind: 'document',
    origin: 'manual-upload',
    name: `doc-${n}.pdf`,
    exhibitNumber: n,
    path: `${caseId}/documents/x-${n}.pdf`,
    contentHash: String(n).repeat(64).slice(0, 64),
    sizeBytes: 1,
    timestamp: '2026-10-01T00:00:00.000Z',
    operatorId: MEMBER_ID,
    operatorName: 'Robin Member',
    toolVersion: '0.9.0',
    schemaVersion: 3
  }
}

// Signed lines continuing `prev`, by the harness key unless `sign` says otherwise.
function lines(
  bodies: Record<string, unknown>[],
  prev: { index: number; entryHash: string } | null = null,
  sign: (hash: string) => string = signEntryHash
): string[] {
  let prevHash = prev?.entryHash ?? ''
  let index = prev ? prev.index + 1 : 0
  return bodies.map((body) => {
    const full = { ...body, index, prevHash }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    prevHash = entryHash
    index += 1
    return JSON.stringify({ ...full, entryHash, signature: sign(entryHash) })
  })
}

const headOf = (line: string): { index: number; entryHash: string } => {
  const { index, entryHash } = JSON.parse(line) as { index: number; entryHash: string }
  return { index, entryHash }
}

describe('acceptEntrySegment', () => {
  let caseDir: string
  let member: CaseMember

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'bb-entry-acceptance-'))
    // The member signs with the harness key, so the future-entry helper can
    // sign for it too.
    member = {
      caseId: CASE_ID,
      installationId: MEMBER_ID,
      publicKeyPem: getPublicKeyPem(),
      memberCode: 'RM',
      operatorName: 'Robin Member',
      nodeId: 'node',
      role: 'member',
      addedAtIndex: 1,
      revokedAtIndex: null
    }
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const stored = (): string => readFileSync(join(caseDir, memberChainPath(MEMBER_ID)), 'utf-8')
  const accept = (fromIndex: number, segment: string[]) =>
    acceptEntrySegment({ caseDir, member, fromIndex, lines: segment })

  it('appends a verified first segment byte for byte and reports its head', () => {
    const segment = lines([exhibitBody(1), exhibitBody(2)])
    const result = accept(0, segment)
    expect(result).toEqual({
      outcome: 'accepted',
      appended: 2,
      head: headOf(segment[1]),
      lines: segment
    })
    expect(stored()).toBe(segment.join('\n') + '\n')
  })

  it('appends a segment that continues the stored head, and nothing for an empty one', () => {
    const first = lines([exhibitBody(1)])
    accept(0, first)
    expect(accept(1, [])).toEqual({
      outcome: 'accepted',
      appended: 0,
      head: headOf(first[0]),
      lines: []
    })
    const second = lines([exhibitBody(2)], headOf(first[0]))
    expect(accept(1, second)).toEqual({
      outcome: 'accepted',
      appended: 1,
      head: headOf(second[0]),
      lines: second
    })
    expect(nonEmptyLines(stored())).toEqual([...first, ...second])
  })

  // Scheduled review finding 1: a wire line is not a chain line. A blank
  // one, or one holding two entries, is split into entries before anything
  // is counted, so what is appended, reported and read back agree.
  it('counts entries, not wire lines, when a peer packs blanks or two entries into one', () => {
    const segment = lines([exhibitBody(1), exhibitBody(2), exhibitBody(3)])
    const result = accept(0, [' ', segment[0], '', `${segment[1]}\n${segment[2]}`])
    expect(result).toEqual({
      outcome: 'accepted',
      appended: 3,
      head: headOf(segment[2]),
      lines: segment
    })
    expect(stored()).toBe(segment.join('\n') + '\n')
  })

  it('refuses a segment that does not start at the stored head', () => {
    const first = lines([exhibitBody(1)])
    accept(0, first)
    const second = lines([exhibitBody(2)], headOf(first[0]))
    expect(accept(0, second)).toEqual({ outcome: 'not-contiguous', storedCount: 1 })
    expect(accept(2, second)).toEqual({ outcome: 'not-contiguous', storedCount: 1 })
    expect(nonEmptyLines(stored())).toEqual(first)
  })

  it('drops a segment whole when a line is signed by another key, edited, or unlinked', () => {
    const first = lines([exhibitBody(1)])
    accept(0, first)
    const forged = lines([exhibitBody(2), exhibitBody(3)], headOf(first[0]), (hash) =>
      createSign('sha256').update(hash).sign(otherKey.privateKey, 'base64')
    )
    expect(accept(1, forged)).toEqual({
      outcome: 'rejected',
      index: 1,
      reason: 'Invalid signature'
    })

    const genuine = lines([exhibitBody(2), exhibitBody(3)], headOf(first[0]))
    const edited = [genuine[0], genuine[1].replace('doc-3.pdf', 'doc-9.pdf')]
    expect(accept(1, edited)).toEqual({
      outcome: 'rejected',
      index: 2,
      reason: 'Entry hash mismatch'
    })

    const unlinked = lines([exhibitBody(2)], { index: 0, entryHash: 'f'.repeat(64) })
    expect(accept(1, unlinked)).toEqual({
      outcome: 'rejected',
      index: 1,
      reason: 'Chain link broken'
    })
    expect(accept(1, ['not json'])).toEqual({
      outcome: 'rejected',
      index: 1,
      reason: 'Invalid JSON'
    })
    expect(nonEmptyLines(stored())).toEqual(first)
  })

  // Which Case a chain names is judged over the whole chain by the session
  // (review finding 4, round two): the `import` that makes a source Case's
  // history legitimate may arrive on a later page, so a page is never
  // refused for it here.
  it('stores a verified entry that names another Case, and names the one the chain is for', () => {
    const segment = lines([exhibitBody(1), exhibitBody(2, 'another-case')])
    expect(accept(0, segment)).toEqual({
      outcome: 'accepted',
      appended: 2,
      head: headOf(segment[1]),
      lines: segment
    })
    const stored = nonEmptyLines(readFileSync(join(caseDir, memberChainPath(MEMBER_ID)), 'utf-8'))
    const entries = stored.map((line) => ManifestEntrySchema.parse(JSON.parse(line)))
    expect(foreignCaseEntry(entries, CASE_ID)?.index).toBe(1)
    expect(foreignCaseEntry(entries, 'another-case')?.index).toBe(0)
  })

  it('stops before an entry from a newer schema, keeps what verified, and resumes later', () => {
    const first = lines([exhibitBody(1)])
    const withFuture = nonEmptyLines(appendFutureEntry(first.join('\n') + '\n', CASE_ID))
    const future = withFuture[1]
    const beyond = lines([exhibitBody(3)], headOf(future))
    const result = accept(0, [...withFuture, ...beyond])
    expect(result).toMatchObject({
      outcome: 'newer-version',
      appended: 1,
      index: 1,
      head: headOf(first[0])
    })
    expect((result as { reason: string }).reason).toContain(
      `the entry states schema version ${MANIFEST_SCHEMA_VERSION + 1}`
    )
    expect(nonEmptyLines(stored())).toEqual(first)

    // The next session asks from the stored head again and meets the same
    // entry: still too new, still nothing appended.
    expect(accept(1, [future, ...beyond])).toMatchObject({
      outcome: 'newer-version',
      appended: 0,
      index: 1,
      head: headOf(first[0])
    })
    expect(nonEmptyLines(stored())).toEqual(first)
  })

  it('reports a newer-schema entry at the very start with no head', () => {
    const [future] = nonEmptyLines(
      appendFutureEntry(JSON.stringify({ index: -1, entryHash: '' }) + '\n', CASE_ID)
    ).slice(1)
    expect(accept(0, [future])).toMatchObject({
      outcome: 'newer-version',
      appended: 0,
      index: 0,
      head: null
    })
    expect(existsSync(join(caseDir, memberChainPath(MEMBER_ID)))).toBe(false)
  })
})
