import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendManifestEntry,
  initManifest,
  verifyManifestChain,
  MIN_READER_SCHEMA_VERSION
} from '@main/services/manifest'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema, MANIFEST_ENTRY_TYPES } from '@shared/schemas'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'

// Known-answer tests for manifest schema 3 (ADR-0023, rulings X17/X18/X24/X25).
//
// Four answers are frozen here, and each one is a claim a recipient relies on:
//   1. schema-2 entries canonicalize and hash to the SAME bytes after the bump,
//      so every package already in the world still verifies (the digests below
//      were computed before this change and must never be regenerated);
//   2. the three new entry types parse and a chain containing each verifies;
//   3. an entry this build cannot read reports "verifier too old" and NEVER a
//      tamper verdict — the false accusation X25 exists to prevent;
//   4. `deletion` and `timestamp` bind any Exhibit, not only a Capture.
//
// If a frozen digest fails, the canonical body of that entry type changed and
// every chain already written with it is now unverifiable — that is the finding,
// not the test.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const OPERATOR = {
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0'
}

// A schema-2 capture body exactly as appendManifestEntry wrote it before this
// change: index 0, no prevHash, signature and entryHash excluded from the body.
const CAPTURE_BODY = {
  type: 'capture',
  captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
  caseId: CASE_ID,
  url: 'https://example.com/page',
  timestamp: '2026-06-01T12:00:00.000Z',
  contentHash: 'a'.repeat(64),
  screenshotHash: 'b'.repeat(64),
  textHash: 'c'.repeat(64),
  sizeBytes: 123456,
  ...OPERATOR,
  index: 0,
  prevHash: '',
  schemaVersion: 2
}

const EXHIBIT_ID = '0196f7a2-aaaa-bbbb-cccc-000000000010'
const EXHIBIT_CONTENT_HASH = 'd'.repeat(64)

const EXHIBIT_BODY = {
  type: 'exhibit',
  exhibitId: EXHIBIT_ID,
  caseId: CASE_ID,
  kind: 'document',
  origin: 'manual-upload',
  name: 'witness-statement.pdf',
  exhibitNumber: 7,
  path: `documents/${EXHIBIT_ID}.pdf`,
  contentHash: EXHIBIT_CONTENT_HASH,
  sizeBytes: 2048,
  timestamp: '2026-06-01T12:05:00.000Z',
  ...OPERATOR,
  index: 0,
  prevHash: '',
  schemaVersion: 3
}

const DERIVATION_BODY = {
  type: 'derivation',
  caseId: CASE_ID,
  parentExhibitId: EXHIBIT_ID,
  parentContentHash: EXHIBIT_CONTENT_HASH,
  derivation: 'pdf-metadata',
  derivationToolVersion: '0.4.0',
  outputHash: 'e'.repeat(64),
  outputPath: `documents/${EXHIBIT_ID}_pdf-metadata.json`,
  timestamp: '2026-06-01T12:06:00.000Z',
  ...OPERATOR,
  index: 0,
  prevHash: '',
  schemaVersion: 3
}

const RENUMBER_BODY = {
  type: 'renumber',
  caseId: CASE_ID,
  assignments: [
    { exhibitId: '0196f7a2-aaaa-bbbb-cccc-000000000001', exhibitNumber: 1, manifestIndex: 0 },
    // No manifestIndex: a pre-v11 Capture with no Manifest Entry, numbered
    // after every anchored one (X41). The number is a citation aid there and
    // never an anchoring claim.
    { exhibitId: '0196f7a2-aaaa-bbbb-cccc-000000000009', exhibitNumber: 2 }
  ],
  timestamp: '2026-06-01T12:07:00.000Z',
  ...OPERATOR,
  index: 0,
  prevHash: '',
  schemaVersion: 3
}

// Frozen answers: sha256 over the canonical JSON of each body above. Schema 3
// touches neither the canonical-JSON recipe nor the capture entry's fields, so
// the schema-2 digest is the one the pre-bump tree produced for the same body —
// the backward-verification claim, pinned again on real frozen package bytes by
// preScopeFixture.test.ts. Never regenerate these: a digest that has to move
// means the canonical body of that entry type changed, and every chain already
// written with it stops verifying.
const FROZEN_ENTRY_HASHES = {
  capture: 'c993dd9744c9f98bc096939e5d37c7f5b0490b47098dd961a01def5cc2a68ebf',
  exhibit: 'a3088330cefd3f04fe332992d9597cacebf6760c68f528a10b944465fc085431',
  derivation: 'ce3e175420475fcc8e8b4086d51df1f9e5282716affade0d2ec1268ac04b5221',
  renumber: 'eb23edc7c967c8f6e3114df29f49bc0d989c5cfcc2aa1734f6f1c72ade0b0485'
}

function entryHashOf(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

// Builds a signed JSONL chain from bodies, filling index/prevHash the way
// appendManifestEntry does. Each body keeps its own schemaVersion so a chain can
// mix v2 and v3 entries, which is the normal state of a Case that predates the
// Exhibit model.
function buildChain(bodies: Record<string, unknown>[]): string {
  let prevHash = ''
  return (
    bodies
      .map((body, index) => {
        const full = { ...body, index, prevHash }
        const entryHash = entryHashOf(full)
        prevHash = entryHash
        return JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) })
      })
      .join('\n') + '\n'
  )
}

function verify(jsonl: string) {
  return verifyManifestChainText(jsonl, { publicKeyPem: getPublicKeyPem() })
}

describe('manifest schema 3 — frozen entry hashes', () => {
  it('leaves the canonical body and hash of a schema-2 capture entry unchanged', () => {
    // Backward verification: the bump must not touch the bytes a v2 chain was
    // hashed over, or every package already delivered fails.
    expect(entryHashOf(CAPTURE_BODY)).toBe(FROZEN_ENTRY_HASHES.capture)
    const parsed = ManifestEntrySchema.safeParse({ ...CAPTURE_BODY, entryHash: 'f'.repeat(64) })
    expect(parsed.success).toBe(true)
  })

  it('pins the canonical hash of each new entry type', () => {
    expect(entryHashOf(EXHIBIT_BODY)).toBe(FROZEN_ENTRY_HASHES.exhibit)
    expect(entryHashOf(DERIVATION_BODY)).toBe(FROZEN_ENTRY_HASHES.derivation)
    expect(entryHashOf(RENUMBER_BODY)).toBe(FROZEN_ENTRY_HASHES.renumber)
  })
})

describe('manifest schema 3 — the schema', () => {
  it('reads up to schema version 3', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(3)
  })

  it('knows exactly the nine entry types', () => {
    // Frozen list: adding a type without deciding how a stale verifier meets it
    // fails here, which is the whole point of the too-old screen below.
    expect([...MANIFEST_ENTRY_TYPES].sort()).toEqual([
      'archive-export',
      'capture',
      'deletion',
      'derivation',
      'exhibit',
      'export',
      'import',
      'renumber',
      'timestamp'
    ])
  })

  it('parses each new entry type', () => {
    for (const body of [EXHIBIT_BODY, DERIVATION_BODY, RENUMBER_BODY]) {
      const parsed = ManifestEntrySchema.safeParse({ ...body, entryHash: 'f'.repeat(64) })
      expect(parsed.success).toBe(true)
    }
  })

  it('rejects a v3 entry type that claims a schema version below 3', () => {
    const parsed = ManifestEntrySchema.safeParse({
      ...EXHIBIT_BODY,
      schemaVersion: 2,
      entryHash: 'f'.repeat(64)
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts an exhibit kind and origin this build has never heard of', () => {
    // The verifier's vocabulary must not decide whether a chain verifies: a
    // future kind is a newer writer, not a forgery (X25's ground, X24's shape).
    const parsed = ManifestEntrySchema.safeParse({
      ...EXHIBIT_BODY,
      kind: 'audio',
      origin: 'sftp-collection',
      entryHash: 'f'.repeat(64)
    })
    expect(parsed.success).toBe(true)
  })
})

describe('manifest schema 3 — writing stays readable by a schema-2 verifier', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema3-write-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  it('stamps every entry type this build writes at the minimum reader version', () => {
    // X25's sequencing: this reader ships before anything writes a v3 entry, so
    // nothing it writes may demand a v3 reader. Every value is also within what
    // this build can read back.
    for (const version of Object.values(MIN_READER_SCHEMA_VERSION)) {
      expect(version).toBe(2)
      expect(version).toBeLessThanOrEqual(MANIFEST_SCHEMA_VERSION)
    }
  })

  it('appends a capture entry at schemaVersion 2, not the read ceiling', () => {
    appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: 'cap-0',
      caseId: CASE_ID,
      url: 'https://example.com/0',
      timestamp: '2026-06-01T12:00:00.000Z',
      contentHash: 'a'.repeat(64),
      sizeBytes: 10,
      ...OPERATOR
    })
    const [line] = readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8').trim().split('\n')
    expect((JSON.parse(line) as { schemaVersion: number }).schemaVersion).toBe(2)
  })
})

describe('manifest schema 3 — chains', () => {
  it('verifies a chain holding a capture, an exhibit, a derivation and a renumber', () => {
    const chain = verify(buildChain([CAPTURE_BODY, EXHIBIT_BODY, DERIVATION_BODY, RENUMBER_BODY]))
    expect(chain.valid).toBe(true)
    expect(chain.unsupported).toBeUndefined()
    // The Capture is still the only thing bound as a capture: an exhibit entry
    // anchors its own bytes and does not masquerade as one.
    expect(chain.captureHashesByIndex.get(0)).toBe('a'.repeat(64))
    expect(chain.captureHashesByIndex.has(1)).toBe(false)
  })

  it('verifies a deletion and a timestamp that target a non-capture Exhibit', () => {
    // ADR-0023 consequences (X26, X29): both entry types bind any Exhibit id and
    // any anchored Content Hash, and the fields keep their capture-era names so
    // legacy canonical bodies are untouched.
    const chain = verify(
      buildChain([
        EXHIBIT_BODY,
        {
          type: 'timestamp',
          caseId: CASE_ID,
          captureContentHash: EXHIBIT_CONTENT_HASH,
          timestamp: '2026-06-01T12:08:00.000Z',
          ...OPERATOR,
          schemaVersion: 3
        },
        {
          type: 'deletion',
          captureId: EXHIBIT_ID,
          caseId: CASE_ID,
          timestamp: '2026-06-01T12:09:00.000Z',
          contentHash: EXHIBIT_CONTENT_HASH,
          reason: 'withdrawn by the discloser',
          ...OPERATOR,
          schemaVersion: 3
        }
      ])
    )
    expect(chain.valid).toBe(true)
    expect(chain.unsupported).toBeUndefined()
  })

  it('still reports real tampering as tampering', () => {
    // The too-old screen must not become a way to launder a broken chain: an
    // edited body is still an entry hash mismatch.
    const lines = buildChain([CAPTURE_BODY, EXHIBIT_BODY]).trim().split('\n')
    lines[1] = lines[1].replace('witness-statement.pdf', 'other-statement.pdf')
    const chain = verify(lines.join('\n') + '\n')
    expect(chain.valid).toBe(false)
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(1)
    expect(chain.reason).toBe('Entry hash mismatch')
  })
})

describe('manifest schema 3 — the verifier-too-old outcome', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema3-toonew-'))
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  // A chain whose second entry is written by a Birdbrain newer than this build:
  // an entry type this verifier has never heard of.
  const futureTypeChain = (): string =>
    buildChain([
      CAPTURE_BODY,
      {
        type: 'annotation-burn',
        caseId: CASE_ID,
        somethingNew: 'from a later schema',
        timestamp: '2026-06-01T12:10:00.000Z',
        ...OPERATOR,
        schemaVersion: 4
      }
    ])

  it('reports an unknown entry type as verifier-too-old, not as a broken chain', () => {
    const chain = verify(
      buildChain([
        CAPTURE_BODY,
        {
          type: 'annotation-burn',
          caseId: CASE_ID,
          timestamp: '2026-06-01T12:10:00.000Z',
          ...OPERATOR,
          schemaVersion: 3
        }
      ])
    )
    expect(chain.valid).toBe(false)
    expect(chain.brokenAt).toBeUndefined()
    expect(chain.unsupported).toEqual({
      index: 1,
      entryType: 'annotation-burn',
      schemaVersionSeen: 3,
      supportedSchemaVersion: 3
    })
    expect(chain.reason).toContain('verifier too old')
    expect(chain.reason).toContain("'annotation-burn'")
    expect(chain.reason).not.toContain('Invalid entry shape')
  })

  it('reports a newer schemaVersion on a known type as verifier-too-old', () => {
    const chain = verify(buildChain([CAPTURE_BODY, { ...CAPTURE_BODY, schemaVersion: 4 }]))
    expect(chain.valid).toBe(false)
    expect(chain.brokenAt).toBeUndefined()
    expect(chain.unsupported?.schemaVersionSeen).toBe(4)
    expect(chain.unsupported?.supportedSchemaVersion).toBe(3)
    // Names the version seen AND the version supported, so a recipient holding a
    // stale verifier can tell what they need.
    expect(chain.reason).toContain('schema version 4')
    expect(chain.reason).toContain('supports up to schema version 3')
    expect(chain.reason).toContain('verifier too old')
  })

  it('reports a typeless entry from a newer schema without inventing a type', () => {
    const chain = verify(
      buildChain([CAPTURE_BODY, { caseId: CASE_ID, ...OPERATOR, schemaVersion: 9 }])
    )
    expect(chain.unsupported).toEqual({
      index: 1,
      schemaVersionSeen: 9,
      supportedSchemaVersion: 3
    })
    expect(chain.reason).toContain('states schema version 9')
    expect(chain.reason).toContain('verifier too old')
  })

  it('still calls a non-object line a malformed shape, not a newer schema', () => {
    // The screen reads `type` and `schemaVersion` off an object. A scalar or an
    // array carries neither and is simply malformed — reporting it as "verifier
    // too old" would excuse a corrupt manifest.
    const chain = verify(buildChain([CAPTURE_BODY]) + 'null\n')
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(1)
    expect(chain.reason).toBe('Invalid entry shape')
  })

  it('reports the same outcome through the main-process wrapper', () => {
    initManifest(caseDir)
    writeFileSync(join(caseDir, MANIFEST_FILENAME), futureTypeChain(), 'utf-8')
    const chain = verifyManifestChain(caseDir)
    expect(chain.valid).toBe(false)
    expect(chain.brokenAt).toBeUndefined()
    expect(chain.unsupported?.entryType).toBe('annotation-burn')
    expect(chain.reason).toContain('verifier too old')
  })

  it('reports the same outcome through the package verifier, with no failed check', () => {
    writeFileSync(join(caseDir, 'manifest.jsonl'), futureTypeChain(), 'utf-8')
    writeFileSync(join(caseDir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
    const result = verifyEvidencePackage(caseDir)
    expect(result.pass).toBe(false)
    expect(result.unsupported?.reason).toContain('verifier too old')
    expect(result.notVerifiable).toBeUndefined()
    // Verification stops at the chain: every later check would be derived from
    // the entries below the unreadable one and would read as tampering.
    expect(result.checks.every((check) => check.status !== 'fail')).toBe(true)
  })

  it('still fails a package whose chain this build CAN read', () => {
    // The control for the check above: without a future entry the same minimal
    // directory fails on its missing index, so the outcome above is the screen
    // doing its job and not an early return that swallows everything.
    writeFileSync(join(caseDir, 'manifest.jsonl'), buildChain([CAPTURE_BODY]), 'utf-8')
    writeFileSync(join(caseDir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
    const result = verifyEvidencePackage(caseDir)
    expect(result.pass).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.checks.some((check) => check.status === 'fail')).toBe(true)
  })
})
