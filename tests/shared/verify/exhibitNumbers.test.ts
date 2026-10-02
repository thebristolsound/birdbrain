import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import {
  canonicalStringify,
  describeRepeatedExhibitNumber,
  exhibitNumberSequences,
  findRepeatedExhibitNumbers,
  highestIssuedExhibitNumber,
  verifyManifestChainText
} from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { packageHash } from '@shared/verify/packageHash'

// Known-answer tests for Exhibit Numbers as the chain records them (#1270,
// rulings X45, X46, X48). Three answers are frozen here, one per chain shape
// the brief names:
//
//   1. DELETION THEN COMMIT. Exhibits 1, 2 and 3 committed, 3 deleted: the
//      next number is 4, because a deletion removes no assignment (X45).
//   2. PRE-CHANGE CHAIN. `capture` entries carrying no number and one
//      `renumber`: the chain verifies unchanged and its highest number is the
//      renumber's (X46 amends schema 3 in place, so nothing written before it
//      stops parsing).
//   3. REPEATED NUMBER. Two anchoring entries assigning one number to two
//      Exhibits: an Integrity Exception naming both, and the package still
//      PASSes, because nothing was altered (X48).
//
// If one of these answers moves, a Case's next citation or a verifier's
// verdict on an existing package changed. That is the finding, not the test.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const OPERATOR = { operatorId: 'op-1', operatorName: 'Casey Operator', toolVersion: '0.4.0' }

const hashOf = (text: string): string => createHash('sha256').update(text).digest('hex')

function capture(id: string, exhibitNumber?: number): Record<string, unknown> {
  return {
    type: 'capture',
    captureId: id,
    caseId: CASE_ID,
    url: `https://example.com/${id}`,
    timestamp: '2026-09-20T10:00:00.000Z',
    contentHash: hashOf(id),
    ...(exhibitNumber === undefined ? {} : { exhibitNumber }),
    sizeBytes: id.length,
    ...OPERATOR,
    schemaVersion: exhibitNumber === undefined ? 2 : 3
  }
}

function exhibit(id: string, exhibitNumber: number): Record<string, unknown> {
  return {
    type: 'exhibit',
    exhibitId: id,
    caseId: CASE_ID,
    kind: 'document',
    origin: 'manual-upload',
    name: `${id}.pdf`,
    exhibitNumber,
    path: `${CASE_ID}/documents/${id}.pdf`,
    contentHash: hashOf(id),
    sizeBytes: id.length,
    timestamp: '2026-09-20T10:05:00.000Z',
    ...OPERATOR,
    schemaVersion: 3
  }
}

function deletion(id: string): Record<string, unknown> {
  return {
    type: 'deletion',
    captureId: id,
    caseId: CASE_ID,
    timestamp: '2026-09-20T10:10:00.000Z',
    contentHash: hashOf(id),
    ...OPERATOR,
    schemaVersion: 2
  }
}

function renumber(assignments: Array<[string, number, number?]>): Record<string, unknown> {
  return {
    type: 'renumber',
    caseId: CASE_ID,
    assignments: assignments.map(([exhibitId, exhibitNumber, manifestIndex]) => ({
      exhibitId,
      exhibitNumber,
      ...(manifestIndex === undefined ? {} : { manifestIndex })
    })),
    timestamp: '2026-09-20T10:15:00.000Z',
    ...OPERATOR,
    schemaVersion: 3
  }
}

// Fills index and prevHash the way appendManifestEntry does and signs each
// entry with this installation's key.
function signedLines(bodies: Record<string, unknown>[]): string[] {
  let prevHash = ''
  return bodies.map((body, index) => {
    const full = { ...body, index, prevHash }
    const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
    prevHash = entryHash
    return JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) })
  })
}

function parsedChain(bodies: Record<string, unknown>[]): Record<string, unknown>[] {
  return signedLines(bodies).map((line) => JSON.parse(line) as Record<string, unknown>)
}

const verify = (lines: string[]) =>
  verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })

describe('Exhibit Numbers — known answers (#1270)', () => {
  it('KAT 1: after 1, 2, 3 and the deletion of 3, the next number is 4', () => {
    const bodies = [capture('c1', 1), capture('c2', 2), capture('c3', 3), deletion('c3')]
    expect(verify(signedLines(bodies)).valid).toBe(true)
    const entries = parsedChain(bodies)
    expect(highestIssuedExhibitNumber(entries) + 1).toBe(4)

    // And once 4 is committed the chain states both facts: 3 was deleted, 4
    // is assigned, and no number names two Exhibits.
    const committed = parsedChain([...bodies, exhibit('e4', 4)])
    expect(exhibitNumberSequences(committed)).toEqual([
      [
        { exhibitId: 'c1', exhibitNumber: 1, index: 0 },
        { exhibitId: 'c2', exhibitNumber: 2, index: 1 },
        { exhibitId: 'c3', exhibitNumber: 3, index: 2 },
        { exhibitId: 'e4', exhibitNumber: 4, index: 4 }
      ]
    ])
    expect(committed[3]).toMatchObject({ type: 'deletion', captureId: 'c3' })
    expect(findRepeatedExhibitNumbers(committed)).toEqual([])
  })

  it('KAT 2: a pre-change chain verifies and numbers from its renumber', () => {
    const bodies = [
      capture('c1'),
      capture('c2'),
      renumber([
        ['c1', 1, 0],
        ['c2', 2, 1],
        ['legacy-html', 3]
      ])
    ]
    expect(verify(signedLines(bodies)).valid).toBe(true)
    const entries = parsedChain(bodies)
    expect(highestIssuedExhibitNumber(entries)).toBe(3)
    expect(findRepeatedExhibitNumbers(entries)).toEqual([])
  })

  it('KAT 3: two entries numbering two Exhibits alike are one Integrity Exception', () => {
    // The shape the MAX + 1 read produced: Capture 3 numbered by the renumber,
    // deleted, and the number issued again to a committed document.
    const bodies = [
      capture('c1'),
      capture('c2'),
      capture('c3'),
      renumber([
        ['c1', 1, 0],
        ['c2', 2, 1],
        ['c3', 3, 2]
      ]),
      deletion('c3'),
      exhibit('doc', 3)
    ]
    expect(verify(signedLines(bodies)).valid).toBe(true)
    const [repeat] = findRepeatedExhibitNumbers(parsedChain(bodies))
    expect(repeat).toEqual({ exhibitNumber: 3, exhibitIds: ['c3', 'doc'], indices: [3, 5] })
    expect(describeRepeatedExhibitNumber(repeat)).toBe(
      'Integrity Exception: Exhibit Number 3 is assigned to 2 exhibits (c3, doc) by the ' +
        'entries at index 3, 5, so a citation of that number does not name one exhibit. ' +
        'This is not a tamper verdict.'
    )
  })
})

describe('Exhibit Numbers — what counts as an assignment', () => {
  it('does not count one Exhibit carrying one number on two entries as a repeat', () => {
    // A renumber written before X46 listed every Exhibit of the Case, a
    // committed document included, so its number appears twice for one id.
    const entries = parsedChain([exhibit('doc', 1), renumber([['doc', 1]])])
    expect(findRepeatedExhibitNumbers(entries)).toEqual([])
    expect(highestIssuedExhibitNumber(entries)).toBe(1)
  })

  it('reads a lenient line and ignores what is not a positive integer number', () => {
    const entries: Record<string, unknown>[] = [
      {},
      { type: 'capture', captureId: 'a', exhibitNumber: 0 },
      { type: 'capture', captureId: 'b', exhibitNumber: 2.5 },
      { type: 'exhibit', exhibitId: 'c', exhibitNumber: '9' },
      { type: 'exhibit', exhibitNumber: 9 },
      { type: 'exhibit', exhibitId: 'd', exhibitNumber: Number.MAX_SAFE_INTEGER + 1 },
      { type: 'renumber', assignments: 'none' },
      {
        type: 'renumber',
        assignments: [null, 7, { exhibitId: 'e' }, { exhibitId: 'f', exhibitNumber: 5 }]
      },
      { type: 'timestamp', exhibitNumber: 40 }
    ]
    expect(exhibitNumberSequences(entries)).toEqual([
      [{ exhibitId: 'f', exhibitNumber: 5, index: 7 }]
    ])
    expect(highestIssuedExhibitNumber([])).toBe(0)
  })

  it('restarts the sequence at a fork, whose earlier numbers are its members’', () => {
    // A fork continues the source Owner's chain behind an `import`; the rows
    // before it are stamped with their member authors, and the fork numbers
    // its own Exhibits from 1. Its own 1 is not a repeat of the source's.
    const entries: Record<string, unknown>[] = [
      { type: 'member-add', memberInstallationId: 'owner', role: 'owner' },
      { type: 'exhibit', exhibitId: 'source-1', exhibitNumber: 1 },
      { type: 'exhibit', exhibitId: 'source-2', exhibitNumber: 2 },
      { type: 'import', sourceCaseId: 'source' },
      { type: 'exhibit', exhibitId: 'fork-1', exhibitNumber: 1 }
    ]
    expect(exhibitNumberSequences(entries).map((s) => s.map((a) => a.exhibitId))).toEqual([
      ['source-1', 'source-2'],
      ['fork-1']
    ])
    expect(findRepeatedExhibitNumbers(entries)).toEqual([])
    expect(highestIssuedExhibitNumber(entries)).toBe(1)
    expect(highestIssuedExhibitNumber(entries.slice(0, 4))).toBe(0)
  })

  it('runs one sequence across an import of a Case nobody shared', () => {
    // The imported rows stay the importer's own, so its numbers continue the
    // source's, and reissuing one is a repeat like any other.
    const entries: Record<string, unknown>[] = [
      { type: 'exhibit', exhibitId: 'source-1', exhibitNumber: 1 },
      { type: 'import', sourceCaseId: 'source' },
      { type: 'exhibit', exhibitId: 'imported-1', exhibitNumber: 1 }
    ]
    expect(exhibitNumberSequences(entries)).toHaveLength(1)
    expect(findRepeatedExhibitNumbers(entries)).toEqual([
      { exhibitNumber: 1, exhibitIds: ['source-1', 'imported-1'], indices: [0, 2] }
    ])
  })

  it('reports each repeat in chain order', () => {
    const entries = parsedChain([
      exhibit('a', 2),
      exhibit('b', 1),
      exhibit('c', 1),
      exhibit('d', 2),
      exhibit('e', 2)
    ])
    expect(findRepeatedExhibitNumbers(entries)).toEqual([
      { exhibitNumber: 2, exhibitIds: ['a', 'd', 'e'], indices: [0, 3, 4] },
      { exhibitNumber: 1, exhibitIds: ['b', 'c'], indices: [1, 2] }
    ])
  })
})

describe('Exhibit Numbers — the standalone verifier (X48)', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-numbers-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const PAGE = Buffer.from('<html><body>numbered page</body></html>')
  const PAGE_HASH = createHash('sha256').update(PAGE).digest('hex')
  const DOCUMENT = Buffer.from('%PDF-1.7 numbered document')
  const DOCUMENT_HASH = createHash('sha256').update(DOCUMENT).digest('hex')

  // A package whose chain holds a Capture numbered on its own entry (X46), a
  // Capture deleted after the renumber gave it 2, and a document committed
  // under 2 again: the repeat X48 is about, written by hand so the verifier's
  // answer is not an echo of the exporter's.
  function writePackage(indexedCaptureNumber = 1): void {
    const bodies = [
      { ...capture('page', 1), contentHash: PAGE_HASH, sizeBytes: PAGE.length },
      capture('gone'),
      renumber([['gone', 2, 1]]),
      deletion('gone'),
      { ...exhibit('doc', 2), contentHash: DOCUMENT_HASH, sizeBytes: DOCUMENT.length }
    ]
    const exportBody = {
      type: 'export',
      caseId: CASE_ID,
      timestamp: '2026-09-20T11:00:00.000Z',
      ...OPERATOR,
      packageHash: packageHash([]),
      verificationResult: {
        overallValid: true,
        captureCount: 1,
        verifiedCount: 1,
        tamperedCount: 0,
        missingCount: 0
      },
      schemaVersion: 2
    }
    const lines = signedLines([...bodies, exportBody])
    const exportLine = lines.pop()!
    writeFileSync(join(pkgDir, 'manifest.jsonl'), lines.join('\n') + '\n')
    writeFileSync(join(pkgDir, 'export-entry.json'), exportLine)
    writeFileSync(join(pkgDir, 'signing-public-key.pem'), getPublicKeyPem())
    mkdirSync(join(pkgDir, 'pages'))
    writeFileSync(join(pkgDir, 'pages', 'page.mhtml'), PAGE)
    mkdirSync(join(pkgDir, 'documents'))
    writeFileSync(join(pkgDir, 'documents', 'doc.pdf'), DOCUMENT)
    const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
    writeFileSync(
      join(pkgDir, 'evidence.json'),
      JSON.stringify({
        schemaVersion: 2,
        verificationMaterials: {
          manifestPath: 'manifest.jsonl',
          manifestHeadIndex: head.index,
          manifestHeadHash: head.entryHash,
          signingPublicKeyPath: 'signing-public-key.pem'
        },
        captures: [
          {
            id: 'page',
            mhtmlPath: 'pages/page.mhtml',
            mhtmlSha256: PAGE_HASH,
            timestampTokenPaths: []
          }
        ],
        exhibits: [
          {
            id: 'page',
            kind: 'capture',
            origin: 'extension',
            exhibitNumber: indexedCaptureNumber,
            name: 'Page',
            contentHash: PAGE_HASH,
            path: 'pages/page.mhtml',
            derivedFiles: []
          },
          {
            id: 'doc',
            kind: 'document',
            origin: 'manual-upload',
            exhibitNumber: 2,
            name: 'doc.pdf',
            contentHash: DOCUMENT_HASH,
            path: 'documents/doc.pdf',
            derivedFiles: []
          }
        ],
        artifacts: []
      })
    )
  }

  it('reports the repeat as an exception naming both exhibits, and still passes', () => {
    writePackage()
    const result = verifyEvidencePackage(pkgDir)

    const exceptions = result.checks.filter((check) => check.status === 'exception')
    expect(exceptions).toEqual([
      {
        name: 'exhibit number 2',
        status: 'exception',
        reason: describeRepeatedExhibitNumber({
          exhibitNumber: 2,
          exhibitIds: ['gone', 'doc'],
          indices: [2, 4]
        })
      }
    ])
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
  })

  it('reconciles a capture row against the number on its own entry', () => {
    writePackage(9)
    const result = verifyEvidencePackage(pkgDir)
    const mismatch = result.checks.find(
      (check) => check.name === 'evidence.json exhibits' && check.status === 'fail'
    )
    expect(mismatch?.reason).toBe(
      'evidence.json records exhibitNumber `9` for exhibit page, but its signed entry records `1`'
    )
    expect(result.pass).toBe(false)
  })

  it('looks for no repeat on a chain that failed', () => {
    writePackage()
    // Broken AFTER both entries carrying 2, so the break-bounded entries still
    // hold the repeat: only the verdict keeps it from being read.
    const path = join(pkgDir, 'manifest.jsonl')
    writeFileSync(path, [...readLines(path), '{"type":"deletion"}'].join('\n') + '\n')

    const result = verifyEvidencePackage(pkgDir)
    expect(result.checks.find((check) => check.name === 'manifest chain')).toEqual({
      name: 'manifest chain',
      status: 'fail',
      reason: 'Invalid entry shape (at index 5)'
    })
    expect(result.checks.some((check) => check.status === 'exception')).toBe(false)
  })
})

function readLines(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
}
