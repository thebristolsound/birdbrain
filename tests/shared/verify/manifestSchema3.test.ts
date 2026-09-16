import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendManifestEntry,
  initManifest,
  readEntries,
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
// Six answers are frozen here, and each one is a claim a recipient relies on:
//   1. schema-2 entries canonicalize and hash to the SAME bytes after the bump,
//      so every package already in the world still verifies (the digests below
//      were computed before this change and must never be regenerated);
//   2. the three new entry types parse and a chain containing each verifies;
//   3. an entry this build cannot read reports "verifier too old" and NEVER a
//      tamper verdict — the false accusation X25 exists to prevent;
//   4. `deletion` and `timestamp` bind any Exhibit, not only a Capture;
//   5. that verdict is not for sale: an entry claiming a newer schema is still
//      reported as tampering unless it links, hashes and verifies as a genuine
//      newer writer's entry does;
//   6. an Exhibit or Derived File this build cannot bind to bytes is reported
//      as a SKIP naming the ticket that binds it, never passed over in silence.
//
// If a frozen digest fails, the canonical body of that entry type changed and
// every chain already written with it is now unverifiable — that is the finding,
// not the test.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const CAPTURE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000001'
const OPERATOR = {
  operatorId: 'op-1',
  operatorName: 'Casey Operator',
  toolVersion: '0.4.0'
}

// A schema-2 capture body exactly as appendManifestEntry wrote it before this
// change: index 0, no prevHash, signature and entryHash excluded from the body.
const CAPTURE_BODY = {
  type: 'capture',
  captureId: CAPTURE_ID,
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
    // X25's sequencing. The v1/v2 types must never demand a v3 reader: a
    // verifier already in a recipient's hands understands their shape
    // perfectly, and stamping the read ceiling on them would make every capture
    // written after a version bump unreadable to it.
    //
    // The v3 types (#1147, #1148) are the exception the constant exists to
    // express. None of `exhibit`, `derivation` or `renumber` has a v1 or v2
    // form, so no reader below 3 can make sense of one and stamping lower
    // would invite it to try. They stamp 3 only because `803v` shipped the
    // reader that reports a too-new entry as "verifier too old" instead of as
    // a broken chain.
    const v3Types = new Set(['exhibit', 'derivation', 'renumber'])
    for (const [type, version] of Object.entries(MIN_READER_SCHEMA_VERSION)) {
      expect(version).toBe(v3Types.has(type) ? 3 : 2)
      expect(version).toBeLessThanOrEqual(MANIFEST_SCHEMA_VERSION)
    }
  })

  it('clamps a per-entry reader override between the type minimum and the read ceiling', () => {
    const base = {
      type: 'timestamp' as const,
      caseId: CASE_ID,
      captureContentHash: 'a'.repeat(64),
      timestamp: '2026-06-01T12:00:00.000Z',
      operatorId: 'op',
      operatorName: 'Op',
      toolVersion: '0.1.0'
    }
    appendManifestEntry(caseDir, base, { minReaderSchemaVersion: 1 })
    appendManifestEntry(caseDir, base, { minReaderSchemaVersion: 3 })
    appendManifestEntry(caseDir, base, { minReaderSchemaVersion: 99 })
    const versions = readEntries(readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8'))
      .slice(-3)
      .map((line) => line.schemaVersion)
    // 1 cannot lower a v2 type; 99 cannot pass what this build can read.
    expect(versions).toEqual([2, 3, MANIFEST_SCHEMA_VERSION])
    expect(verifyManifestChain(caseDir).valid).toBe(true)
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

  it('reports an unknown type that states no schema version at all', () => {
    // A newer writer that renamed or dropped the field is still a newer writer.
    // The message says so rather than naming a version nobody stated.
    const chain = verify(
      buildChain([CAPTURE_BODY, { type: 'exhibit-bundle', caseId: CASE_ID, ...OPERATOR }])
    )
    expect(chain.unsupported).toEqual({
      index: 1,
      entryType: 'exhibit-bundle',
      supportedSchemaVersion: 3
    })
    expect(chain.reason).toContain('states no schema version')
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

describe('manifest schema 3 — the too-old verdict is not for sale', () => {
  // The outcome above carries an exculpation ("not a tamper verdict"), so the
  // price of reaching it has to be the case's signing key. Every case here is a
  // manifest edit that claims a newer schema, and every one is still reported as
  // the tamper verdict this build would have given before the outcome existed.

  it('reports a tampered entry that also claims a newer schema as tampering', () => {
    // Edit an entry and bump its schemaVersion out of range in the same line:
    // the entry's own hash is checked before the too-old verdict is reported, so
    // the bump buys nothing.
    const lines = buildChain([CAPTURE_BODY, EXHIBIT_BODY]).trim().split('\n')
    lines[1] = lines[1]
      .replace('witness-statement.pdf', 'other-statement.pdf')
      .replace('"schemaVersion":3', '"schemaVersion":99')
    const chain = verify(lines.join('\n') + '\n')
    expect(chain.valid).toBe(false)
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(1)
    expect(chain.reason).toBe('Entry hash mismatch')
  })

  it('reports a planted future entry with a recomputed hash but no signature', () => {
    // Recomputing an entry hash needs no key, so the hash check alone would let
    // anyone append a line and silence the verifier. The signature is what makes
    // the verdict unreachable without the key.
    const chain = buildChain([CAPTURE_BODY])
    const lines = chain.trim().split('\n')
    const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
    const body = {
      type: 'exhibit-bundle',
      caseId: CASE_ID,
      ...OPERATOR,
      schemaVersion: 4,
      index: head.index + 1,
      prevHash: head.entryHash
    }
    const planted = JSON.stringify({ ...body, entryHash: entryHashOf(body) })
    const result = verify(chain + planted + '\n')
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid signature')
  })

  it('refuses a deeply nested unreadable entry with a verdict, not a stack overflow', () => {
    // An unreadable entry is the one body canonicalStringify is handed without a
    // strict-schema parse in front of it, and it recurses per nesting level.
    // Nesting deep enough to exhaust the stack costs no signing key, so without
    // the depth guard this line throws out of verifyManifestChainText and every
    // caller gets an exception where a ChainVerifyResult is the contract — the
    // standalone verifier prints a generic error instead of a tamper report.
    // 20000 is chosen to sit well past the depth that actually overflows
    // (measured at roughly 10000 on Node 20), so the guard and not the stack is
    // what stops it. The line is assembled as text because JSON.stringify
    // recurses too.
    const chain = buildChain([CAPTURE_BODY])
    const head = JSON.parse(chain.trim().split('\n')[0]) as { index: number; entryHash: string }
    const nested = '['.repeat(20000) + '0' + ']'.repeat(20000)
    const planted =
      `{"type":"exhibit-bundle","caseId":${JSON.stringify(CASE_ID)},` +
      `"index":${head.index + 1},"prevHash":${JSON.stringify(head.entryHash)},` +
      `"schemaVersion":4,"nested":${nested},` +
      `"entryHash":"${'f'.repeat(64)}","signature":"unchecked"}`
    const result = verify(chain + planted + '\n')
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Entry too deeply nested')
  })

  it('reports a future entry that does not continue the chain as tampering', () => {
    const lines = buildChain([CAPTURE_BODY, { ...EXHIBIT_BODY, schemaVersion: 4 }])
      .trim()
      .split('\n')
    const head = JSON.parse(lines[0]) as { entryHash: string }
    lines[1] = lines[1].replace(`"prevHash":"${head.entryHash}"`, `"prevHash":"${'0'.repeat(64)}"`)
    const chain = verify(lines.join('\n') + '\n')
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(1)
    expect(chain.reason).toBe('Chain link broken')
  })

  it('reports a forged manifest self-keyed by a planted import line as tampering', () => {
    // The invariant: nothing an unverified line says may influence a verdict.
    // A two-line manifest — an unreadable entry signed with a key the forger
    // generated, then an import line embedding that key's pem — must not buy
    // the too-old exculpation: the line after the unreadable entry is never
    // read, so the unreadable entry verifies under the case key alone, and the
    // forger's signature fails it.
    const forger = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const body = {
      type: 'exhibit-bundle',
      caseId: CASE_ID,
      ...OPERATOR,
      schemaVersion: 99,
      index: 0,
      prevHash: ''
    }
    const entryHash = entryHashOf(body)
    const forgedLine = JSON.stringify({
      ...body,
      entryHash,
      signature: createSign('sha256').update(entryHash).sign(forger.privateKey, 'base64')
    })
    const importLine = JSON.stringify({
      type: 'import',
      schemaVersion: 99,
      sourcePublicKeyPem: forger.publicKey
    })
    const chain = verify([forgedLine, importLine].join('\n') + '\n')
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(0)
    expect(chain.reason).toBe('Invalid signature')
  })

  it('reports an appended unreadable import line as broken there, accusing no genuine entry', () => {
    // The inverse harm: an unsigned unreadable import line appended to a
    // genuine chain must not re-key the entries preceding it — that would
    // report 'Invalid signature' on an untouched, correctly signed entry, the
    // false accusation X25 forbids. The genuine entries verify, and the verdict
    // lands on the appended line, which sits nowhere the chain vouches for.
    const appended = JSON.stringify({
      type: 'import',
      schemaVersion: 99,
      sourcePublicKeyPem: 'not the case key'
    })
    const chain = verify(buildChain([CAPTURE_BODY, EXHIBIT_BODY]) + appended + '\n')
    expect(chain.unsupported).toBeUndefined()
    expect(chain.brokenAt).toBe(2)
    expect(chain.reason).toBe('Index mismatch')
  })

  it('does not re-key the preceding entries from a line after the unreadable one', () => {
    // A genuine chain ending in a genuine unreadable entry, with a forged
    // import line appended after it. Nothing at or after the unreadable entry
    // is read, so the forged pem influences nothing: the verdict stays
    // too-old, decided at the genuine unreadable entry.
    const chain = buildChain([CAPTURE_BODY, { ...EXHIBIT_BODY, schemaVersion: 4 }])
    const appended = JSON.stringify({
      type: 'import',
      schemaVersion: 99,
      sourcePublicKeyPem: 'a pem the forger chose'
    })
    const result = verify(chain + appended + '\n')
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported?.index).toBe(1)
    expect(result.reason).toContain('verifier too old')
  })

  it('reports a tamper before the unreadable entry, phase by phase', () => {
    // Every keyless check preceding the unreadable entry still fires: the
    // too-old verdict is decided only after the whole prefix holds. One case
    // per phase-A check, plus the phase-C signature check on a prefix entry.
    const unreadable = { ...EXHIBIT_BODY, schemaVersion: 4 }

    // Index mismatch: the first entry claims a position it does not occupy.
    const misplacedBody = { ...CAPTURE_BODY, index: 5, prevHash: '' }
    const misplacedHash = entryHashOf(misplacedBody)
    const misplaced = JSON.stringify({
      ...misplacedBody,
      entryHash: misplacedHash,
      signature: signEntryHash(misplacedHash)
    })
    const unreadableAfter = (prevHash: string, index: number): string => {
      const body = { ...unreadable, index, prevHash }
      const entryHash = entryHashOf(body)
      return JSON.stringify({ ...body, entryHash, signature: signEntryHash(entryHash) })
    }
    const indexCase = verify([misplaced, unreadableAfter(misplacedHash, 1)].join('\n') + '\n')
    expect(indexCase.unsupported).toBeUndefined()
    expect(indexCase.brokenAt).toBe(0)
    expect(indexCase.reason).toBe('Index mismatch')

    // Chain link broken: the second entry does not link to the first.
    const first = buildChain([CAPTURE_BODY]).trim()
    const mislinkedBody = { ...EXHIBIT_BODY, index: 1, prevHash: '0'.repeat(64) }
    const mislinkedHash = entryHashOf(mislinkedBody)
    const mislinked = JSON.stringify({
      ...mislinkedBody,
      entryHash: mislinkedHash,
      signature: signEntryHash(mislinkedHash)
    })
    const linkCase = verify([first, mislinked, unreadableAfter(mislinkedHash, 2)].join('\n') + '\n')
    expect(linkCase.unsupported).toBeUndefined()
    expect(linkCase.brokenAt).toBe(1)
    expect(linkCase.reason).toBe('Chain link broken')

    // Entry hash mismatch: a readable entry edited after signing.
    const editedLines = buildChain([CAPTURE_BODY, EXHIBIT_BODY, unreadable]).trim().split('\n')
    editedLines[0] = editedLines[0].replace('example.com/page', 'evil.example/page')
    const hashCase = verify(editedLines.join('\n') + '\n')
    expect(hashCase.unsupported).toBeUndefined()
    expect(hashCase.brokenAt).toBe(0)
    expect(hashCase.reason).toBe('Entry hash mismatch')

    // Schema version downgrade: a v1 entry after a signed v2 entry.
    const downgradeCase = verify(
      buildChain([CAPTURE_BODY, { ...CAPTURE_BODY, schemaVersion: 1 }, unreadable])
    )
    expect(downgradeCase.unsupported).toBeUndefined()
    expect(downgradeCase.brokenAt).toBe(1)
    expect(downgradeCase.reason).toBe('Schema version downgrade')

    // Phase C: a preceding entry signed by no key the chain anchors.
    const stranger = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const strangerBody = { ...CAPTURE_BODY, index: 0, prevHash: '' }
    const strangerHash = entryHashOf(strangerBody)
    const strangerLine = JSON.stringify({
      ...strangerBody,
      entryHash: strangerHash,
      signature: createSign('sha256').update(strangerHash).sign(stranger.privateKey, 'base64')
    })
    const sigCase = verify([strangerLine, unreadableAfter(strangerHash, 1)].join('\n') + '\n')
    expect(sigCase.unsupported).toBeUndefined()
    expect(sigCase.brokenAt).toBe(0)
    expect(sigCase.reason).toBe('Invalid signature')
  })

  it('does not report the lines below an unreadable entry', () => {
    // The other side of the same rule: once this build has met an entry it
    // cannot read, the verdict is decided AT that entry. A malformed line
    // further down is not a finding this build is in a position to make, and it
    // must not turn "verifier too old" into a tamper verdict either.
    const chain = buildChain([CAPTURE_BODY, { ...EXHIBIT_BODY, schemaVersion: 4 }])
    const result = verify(chain + 'not json at all\n{"type":"capture"}\n')
    expect(result.brokenAt).toBeUndefined()
    expect(result.unsupported?.index).toBe(1)
    expect(result.reason).toContain('verifier too old')
  })

  it('keeps an imported segment verifying under an import entry from a newer schema', () => {
    // The other half of the same change: entries are verified BEFORE the
    // too-old verdict, so the key that covers an imported segment has to be
    // resolved even when the import boundary itself is unreadable. The source
    // key is taken off the boundary only AFTER the boundary verifies under the
    // case's own key — verified data, not an unverified line's word — and with
    // it the source entries verify instead of reporting 'Invalid signature',
    // the false accusation X25 exists to prevent.
    const source = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const sourceBody = { ...CAPTURE_BODY, index: 0, prevHash: '' }
    const sourceHash = entryHashOf(sourceBody)
    const sourceLine = JSON.stringify({
      ...sourceBody,
      entryHash: sourceHash,
      signature: createSign('sha256').update(sourceHash).sign(source.privateKey, 'base64')
    })
    const importBody = {
      type: 'import',
      caseId: CASE_ID,
      sourceCaseId: 'case-src',
      sourceInstallationId: 'inst-a',
      sourcePublicKeyPem: source.publicKey,
      packageHash: 'a'.repeat(64),
      idMapSha256: 'b'.repeat(64),
      somethingNew: 'from a later schema',
      timestamp: '2026-06-01T12:20:00.000Z',
      ...OPERATOR,
      index: 1,
      prevHash: sourceHash,
      schemaVersion: 4
    }
    const importHash = entryHashOf(importBody)
    const importLine = JSON.stringify({
      ...importBody,
      entryHash: importHash,
      signature: signEntryHash(importHash)
    })
    const chain = verify([sourceLine, importLine].join('\n') + '\n')
    expect(chain.brokenAt).toBeUndefined()
    expect(chain.reason).toContain('verifier too old')
    expect(chain.unsupported?.index).toBe(1)
    expect(chain.unsupported?.schemaVersionSeen).toBe(4)
  })
})

describe('manifest schema 3 — Exhibit entries a package verifier cannot bind', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema3-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  it('reports an unbound Exhibit and Derived File as a SKIP naming 803e', () => {
    // This build reads `exhibit` and `derivation` entries and binds no bytes to
    // them — 803e (#1156) is what ships and verifies Exhibit files. A silent
    // PASS over a package holding them would read as "everything the chain
    // anchors was verified" (X44's dishonest third option), so each one is named
    // in the report. A SKIP and not a FAIL: the package is not at fault for
    // being newer than the verifier (X25).
    const mhtml = Buffer.from('<html><body>packaged</body></html>')
    const contentHash = createHash('sha256').update(mhtml).digest('hex')
    const capture = {
      type: 'capture',
      captureId: CAPTURE_ID,
      caseId: CASE_ID,
      url: 'https://example.com/page',
      timestamp: '2026-06-01T12:00:00.000Z',
      contentHash,
      sizeBytes: mhtml.length,
      ...OPERATOR,
      schemaVersion: 2
    }
    const jsonl = buildChain([capture, EXHIBIT_BODY, DERIVATION_BODY])
    const lines = jsonl.trim().split('\n')
    const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
    writeFileSync(join(pkgDir, 'manifest.jsonl'), jsonl, 'utf-8')
    writeFileSync(join(pkgDir, 'signing-public-key.pem'), getPublicKeyPem(), 'utf-8')
    mkdirSync(join(pkgDir, 'pages'), { recursive: true })
    writeFileSync(join(pkgDir, 'pages', `${CAPTURE_ID}.mhtml`), mhtml)
    writeFileSync(
      join(pkgDir, 'evidence.json'),
      JSON.stringify({
        schemaVersion: 1,
        verificationMaterials: {
          manifestPath: 'manifest.jsonl',
          manifestHeadIndex: head.index,
          manifestHeadHash: head.entryHash,
          signingPublicKeyPath: 'signing-public-key.pem'
        },
        captures: [
          {
            id: CAPTURE_ID,
            mhtmlPath: `pages/${CAPTURE_ID}.mhtml`,
            mhtmlSha256: contentHash,
            timestampTokenPaths: []
          }
        ],
        artifacts: []
      }),
      'utf-8'
    )

    const result = verifyEvidencePackage(pkgDir)
    const exhibit = result.checks.find((check) => check.name === `exhibit ${EXHIBIT_ID}`)
    expect(exhibit?.status).toBe('skip')
    expect(exhibit?.reason).toContain('Exhibit 7')
    expect(exhibit?.reason).toContain('803e')
    const derivation = result.checks.find((check) => check.name.startsWith('derivation '))
    expect(derivation?.status).toBe('skip')
    expect(derivation?.reason).toContain('803e')
    // The rest of the package is intact, so the verdict stays PASS: what changed
    // is that the PASS now says out loud which anchored items it did not bind.
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
  })
})
