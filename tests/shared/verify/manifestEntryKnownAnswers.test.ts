import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import type { AppendOptions, ManifestEntryInput } from '@main/services/manifest'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { canonicalStringify } from '@shared/verify'
import {
  ENGINE_BOUND_TLS,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD,
  engineFields
} from '../../helpers/captureEnginePackage'
import { EGRESS_FIELDS } from '../../helpers/egressPackage'
import { PERSONA_FIELDS, launchedFields, passiveFields } from '../../helpers/launchedBrowser'
import { LINK_FIELDS } from '../../helpers/linkProvenance'

// Known answers for the two halves of one rule, across every Manifest Entry
// type and every schema version this build reads: the schema version the
// writer puts on an entry (`appendManifestEntry`), and the lowest version at
// which the reader's strict schema admits that entry (`ManifestEntrySchema`).
// A writer that stamps below what the reader demands writes a chain its own
// verifier calls broken; one that stamps above it locks out verifiers already
// in recipients' hands.
//
// Two kinds of answer are pinned:
//   1. written by hand below: each case's stamp and the lowest version the
//      reader admits it at;
//   2. frozen in tests/fixtures/manifest/entryKnownAnswers.json: each case's
//      Entry Hash, every refusal the reader gives it at each version from 0 to
//      one past the ceiling, and what chain verification hands back for each
//      capture entry: its keys in order, and a digest of its values.
//
// The fixture was recorded at origin/main 2aac9a32, before the field rules
// moved into one module, and this file reads only `appendManifestEntry`,
// `ManifestEntrySchema` and `verifyManifestChain`. If a frozen answer fails,
// an entry already written now hashes, stamps or reads differently: that is
// the finding, not the test.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const TIME = '2026-06-01T12:00:00.000Z'
const OPERATOR = { operatorId: 'op-1', operatorName: 'Casey Operator', toolVersion: '0.4.0' }
const SOURCE_PEM = '-----BEGIN PUBLIC KEY-----\nZml4dHVyZQ==\n-----END PUBLIC KEY-----\n'

// The schema-2 capture body manifestSchema3.test.ts freezes, as an input.
const CAPTURE = {
  type: 'capture',
  captureId: '0196f7a2-aaaa-bbbb-cccc-000000000001',
  caseId: CASE_ID,
  url: 'https://example.com/page',
  timestamp: TIME,
  contentHash: 'a'.repeat(64),
  screenshotHash: 'b'.repeat(64),
  textHash: 'c'.repeat(64),
  sizeBytes: 123456,
  ...OPERATOR
}

// A Capture with a page archive only: no screenshot and no extracted text.
const BARE_CAPTURE = {
  type: 'capture',
  captureId: CAPTURE.captureId,
  caseId: CASE_ID,
  url: CAPTURE.url,
  timestamp: TIME,
  contentHash: CAPTURE.contentHash,
  sizeBytes: CAPTURE.sizeBytes,
  ...OPERATOR
}

const TIMESTAMP = {
  type: 'timestamp',
  caseId: CASE_ID,
  captureContentHash: 'a'.repeat(64),
  timestamp: TIME,
  // Not a literal: the secret scan reads a base64 string beside `tsaToken` as a
  // key.
  tsaToken: Buffer.from('fixture token').toString('base64'),
  ...OPERATOR
}

// The schema-3 exhibit body manifestSchema3.test.ts freezes, as an input.
const EXHIBIT = {
  type: 'exhibit',
  exhibitId: '0196f7a2-aaaa-bbbb-cccc-000000000010',
  caseId: CASE_ID,
  kind: 'document',
  origin: 'manual-upload',
  name: 'witness-statement.pdf',
  exhibitNumber: 7,
  path: 'documents/0196f7a2-aaaa-bbbb-cccc-000000000010.pdf',
  contentHash: 'd'.repeat(64),
  sizeBytes: 2048,
  timestamp: '2026-06-01T12:05:00.000Z',
  ...OPERATOR
}

const DELETION = {
  type: 'deletion',
  captureId: CAPTURE.captureId,
  caseId: CASE_ID,
  timestamp: TIME,
  contentHash: 'a'.repeat(64),
  reason: 'duplicate upload',
  ...OPERATOR
}

const DUPLICATE = {
  method: 'duplicate',
  duplicateOfCaptureId: '0196f7a2-aaaa-bbbb-cccc-000000000005',
  duplicatedAt: '2026-06-02T08:00:00.000Z'
}

const NO_TRANSACTION_RECORD = { present: false, reason: 'not-taken' }
const NO_PDF = { present: false, reason: 'failed' }

// The first slice's inventory with both optional files absent, so an entry
// can carry it with neither file's hash.
function inventory(parts: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...ENGINE_INVENTORY, transactionRecord: NO_TRANSACTION_RECORD, pdf: NO_PDF, ...parts }
}

// An inventory whose present Transaction Record carries one schema-7 member.
function recordWith(member: Record<string, unknown>): Record<string, unknown> {
  return {
    inventory: inventory({
      transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, ...member }
    }),
    transactionRecordHash: ENGINE_HASHES.transactionRecord
  }
}

interface KnownAnswer {
  name: string
  input: Record<string, unknown>
  opts?: AppendOptions
  // The schema version the writer puts on the entry.
  stamp: number
  // The lowest schema version at which the reader admits the entry. Equal to
  // the stamp, except where a type has an unsigned schema-1 form the reader
  // still reads (`capture`, `deletion`) or the caller raised the stamp.
  readFrom: number
}

function capture(name: string, fields: Record<string, unknown>, stamp: number): KnownAnswer {
  return { name: `capture: ${name}`, input: { ...CAPTURE, ...fields }, stamp, readFrom: stamp }
}

const KNOWN_ANSWERS: KnownAnswer[] = [
  // Every entry type, carrying no field a later schema added.
  { name: 'capture', input: CAPTURE, stamp: 2, readFrom: 1 },
  {
    name: 'capture: no screenshot or text',
    input: BARE_CAPTURE,
    stamp: 2,
    readFrom: 1
  },
  {
    name: 'capture: every schema-2 optional field',
    input: {
      ...CAPTURE,
      headers: { 'content-type': 'text/html' },
      httpStatus: 200,
      finalUrl: 'https://example.com/landed',
      method: 'background',
      supersedesCaptureId: '0196f7a2-aaaa-bbbb-cccc-000000000006',
      consentSuppression: 'filter-list'
    },
    stamp: 2,
    readFrom: 1
  },
  { name: 'capture: a Duplicate', input: { ...CAPTURE, ...DUPLICATE }, stamp: 2, readFrom: 1 },
  { name: 'deletion', input: DELETION, stamp: 2, readFrom: 1 },
  { name: 'timestamp', input: TIMESTAMP, stamp: 2, readFrom: 2 },
  {
    name: 'export',
    input: {
      type: 'export',
      caseId: CASE_ID,
      timestamp: TIME,
      ...OPERATOR,
      packageHash: 'd'.repeat(64),
      verificationResult: {
        overallValid: true,
        captureCount: 2,
        verifiedCount: 2,
        tamperedCount: 0,
        missingCount: 0
      },
      scope: 'selection',
      captureIds: [CAPTURE.captureId],
      exportClass: 'working-copy'
    },
    stamp: 2,
    readFrom: 2
  },
  {
    name: 'archive-export',
    input: {
      type: 'archive-export',
      caseId: CASE_ID,
      timestamp: TIME,
      ...OPERATOR,
      packageHash: 'd'.repeat(64)
    },
    stamp: 2,
    readFrom: 2
  },
  {
    name: 'import',
    input: {
      type: 'import',
      caseId: CASE_ID,
      sourceCaseId: '0196f7a2-aaaa-bbbb-cccc-000000000007',
      sourceInstallationId: '0196f7a2-aaaa-bbbb-cccc-000000000008',
      sourcePublicKeyPem: SOURCE_PEM,
      packageHash: 'd'.repeat(64),
      idMapSha256: 'e'.repeat(64),
      verificationResult: {
        overallValid: true,
        chainValid: true,
        artifactCount: 3,
        artifactFailureCount: 0,
        captureCount: 2,
        captureHashFailureCount: 0
      },
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 2,
    readFrom: 2
  },
  { name: 'exhibit', input: EXHIBIT, stamp: 3, readFrom: 3 },
  {
    name: 'derivation',
    input: {
      type: 'derivation',
      caseId: CASE_ID,
      parentExhibitId: EXHIBIT.exhibitId,
      parentContentHash: EXHIBIT.contentHash,
      derivation: 'thumbnail',
      derivationToolVersion: '0.4.0',
      derivationParameters: { width: 320, format: 'webp' },
      outputHash: 'f'.repeat(64),
      outputPath: `${CASE_ID}/thumbnails/${EXHIBIT.exhibitId}.webp`,
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 3,
    readFrom: 3
  },
  {
    name: 'renumber',
    input: {
      type: 'renumber',
      caseId: CASE_ID,
      assignments: [
        { exhibitId: CAPTURE.captureId, exhibitNumber: 1, manifestIndex: 0 },
        { exhibitId: '0196f7a2-aaaa-bbbb-cccc-000000000009', exhibitNumber: 2 }
      ],
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 3,
    readFrom: 3
  },
  {
    name: 'merge',
    input: {
      type: 'merge',
      caseId: CASE_ID,
      heads: [
        {
          installationId: '0196f7a2-aaaa-bbbb-cccc-000000000008',
          index: 3,
          entryHash: 'e'.repeat(64),
          entriesReceived: 4
        }
      ],
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 4,
    readFrom: 4
  },
  {
    name: 'member-add',
    input: {
      type: 'member-add',
      caseId: CASE_ID,
      memberInstallationId: '0196f7a2-aaaa-bbbb-cccc-000000000008',
      memberPublicKeyPem: SOURCE_PEM,
      memberCode: 'AB',
      memberOperatorName: 'Riley Member',
      nodeId: 'node-1',
      role: 'member',
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 4,
    readFrom: 4
  },
  {
    name: 'member-revoke',
    input: {
      type: 'member-revoke',
      caseId: CASE_ID,
      memberInstallationId: '0196f7a2-aaaa-bbbb-cccc-000000000008',
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 4,
    readFrom: 4
  },
  {
    name: 'exclude',
    input: {
      type: 'exclude',
      caseId: CASE_ID,
      exhibitId: EXHIBIT.exhibitId,
      authorInstallationId: '0196f7a2-aaaa-bbbb-cccc-000000000008',
      reason: 'privileged',
      timestamp: TIME,
      ...OPERATOR
    },
    stamp: 4,
    readFrom: 4
  },

  // A `capture` entry carrying a field or value a later schema added.
  capture('exhibitNumber', { exhibitNumber: 7 }, 3),
  capture('egressKind', { egressKind: 'proxy' }, 5),
  capture('egressKind and egressLabel', { egressKind: 'tor', egressLabel: 'Tor' }, 5),
  capture('userAgent', { userAgent: EGRESS_FIELDS.userAgent }, 5),
  capture('tlsSkipped', { tlsSkipped: 'egress-not-direct' }, 5),
  capture('every Egress field', EGRESS_FIELDS, 5),
  capture('inventory', { inventory: inventory() }, 6),
  capture('scrollToLoad', { scrollToLoad: ENGINE_SCROLL_TO_LOAD }, 6),
  capture(
    'transactionRecordHash',
    {
      inventory: inventory({ transactionRecord: ENGINE_INVENTORY.transactionRecord }),
      transactionRecordHash: ENGINE_HASHES.transactionRecord
    },
    6
  ),
  capture(
    'pdfHash',
    { inventory: inventory({ pdf: ENGINE_INVENTORY.pdf }), pdfHash: ENGINE_HASHES.pdf },
    6
  ),
  capture('boundTls', { boundTls: ENGINE_BOUND_TLS }, 6),
  capture('boundTlsAbsent', { boundTlsAbsent: 'not-https' }, 6),
  capture('every capture engine field', engineFields(), 6),
  capture('link provenance', LINK_FIELDS, 6),
  capture('method launched', { method: 'launched' }, 7),
  capture('method launched-passive', { method: 'launched-passive' }, 7),
  capture('browserProduct', { browserProduct: 'Chrome' }, 7),
  capture(
    'browserProduct and browserVersion',
    { browserProduct: 'Chrome', browserVersion: '150.0.7871.181' },
    7
  ),
  capture('browserFamily', { browserFamily: 'chromium' }, 7),
  capture('passiveRule on a Duplicate', { ...DUPLICATE, passiveRule: 'every-page' }, 7),
  capture(
    'a stage-2 Transaction Record absence',
    {
      inventory: inventory({
        transactionRecord: { present: false, reason: 'page-not-recorded' }
      })
    },
    7
  ),
  capture(
    'a stage-2 PDF absence',
    { inventory: inventory({ pdf: { present: false, reason: 'not-taken-passive' } }) },
    7
  ),
  capture('servedByServiceWorker', recordWith({ servedByServiceWorker: 15 }), 7),
  capture('requestBodiesWithheld', recordWith({ requestBodiesWithheld: 16 }), 7),
  capture('httpCacheDisabled', recordWith({ httpCacheDisabled: true }), 7),
  capture('personaId', { personaId: PERSONA_FIELDS.personaId }, 7),
  capture('both Persona fields', PERSONA_FIELDS, 7),
  capture('a clicked launched Capture', launchedFields(), 7),
  capture('a passive launched Capture', passiveFields('selector-match'), 7),
  // Fields of several schemas on one entry: the highest decides.
  capture('exhibitNumber and Egress', { exhibitNumber: 7, egressKind: 'proxy' }, 5),
  capture('exhibitNumber and link provenance', { exhibitNumber: 7, ...LINK_FIELDS }, 6),
  capture('Egress and capture engine', { ...EGRESS_FIELDS, ...engineFields() }, 6),
  capture('Egress and Persona', { ...EGRESS_FIELDS, ...PERSONA_FIELDS }, 7),
  capture(
    'a field of every schema',
    {
      exhibitNumber: 7,
      ...EGRESS_FIELDS,
      ...LINK_FIELDS,
      ...launchedFields()
    },
    7
  ),

  // The other two types with a field a later schema added.
  {
    name: 'timestamp: subject',
    input: { ...TIMESTAMP, subject: 'entry' },
    stamp: 4,
    readFrom: 4
  },
  { name: 'exhibit: memberCode', input: { ...EXHIBIT, memberCode: 'AB' }, stamp: 4, readFrom: 4 },
  { name: 'exhibit: personaId', input: { ...EXHIBIT, personaId: 'p-1' }, stamp: 7, readFrom: 7 },
  {
    name: 'exhibit: Persona and memberCode',
    input: { ...EXHIBIT, ...PERSONA_FIELDS, memberCode: 'AB' },
    stamp: 7,
    readFrom: 7
  },

  // A caller's own minimum: it raises the stamp, never lowers it, and never
  // passes what this build reads. It does not change what the reader admits.
  {
    name: 'deletion: caller asks for 3',
    input: DELETION,
    opts: { minReaderSchemaVersion: 3 },
    stamp: 3,
    readFrom: 1
  },
  {
    name: 'timestamp: caller asks for 3',
    input: TIMESTAMP,
    opts: { minReaderSchemaVersion: 3 },
    stamp: 3,
    readFrom: 2
  },
  {
    name: 'timestamp: subject, caller asks for 3',
    input: { ...TIMESTAMP, subject: 'entry' },
    opts: { minReaderSchemaVersion: 3 },
    stamp: 4,
    readFrom: 4
  },
  {
    name: 'capture: caller asks for 1',
    input: CAPTURE,
    opts: { minReaderSchemaVersion: 1 },
    stamp: 2,
    readFrom: 1
  },
  {
    name: 'capture: Egress, caller asks for 99',
    input: { ...CAPTURE, egressKind: 'proxy' },
    opts: { minReaderSchemaVersion: 99 },
    stamp: 7,
    readFrom: 5
  }
]

interface FrozenAnswer {
  stamp: number
  entryHash: string
  // Every schema version the reader admits the entry at.
  admittedAt: number[]
  // Its refusals at each of the others, in the order the reader gives them,
  // with the versions that share one list grouped: `path: message` for a rule
  // of this schema, `path: code` for a refusal Zod words itself.
  refused: Array<{ at: number[]; with: string[] }>
}

interface FrozenProjection {
  name: string
  // The keys in the order chain verification sets them, a key whose value is
  // undefined included.
  keys: string[]
  // SHA-256 over the canonical JSON of what it handed back.
  digest: string
}

interface Fixture {
  entries: Record<string, FrozenAnswer>
  captureChain: FrozenProjection[]
}

const FIXTURE_PATH = join(__dirname, '../../fixtures/manifest/entryKnownAnswers.json')
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Fixture

// One past each end of what this build reads, so both bounds are pinned.
const VERSIONS = Array.from({ length: MANIFEST_SCHEMA_VERSION + 2 }, (_, version) => version)

function write(caseDir: string, answer: KnownAnswer): Record<string, unknown> {
  const { line } = appendManifestEntry(
    caseDir,
    answer.input as unknown as ManifestEntryInput,
    answer.opts
  )
  return JSON.parse(line) as Record<string, unknown>
}

function refusals(written: Record<string, unknown>, schemaVersion: number): string[] | undefined {
  const result = ManifestEntrySchema.safeParse({ ...written, schemaVersion })
  if (result.success) return undefined
  return result.error.issues.map(
    ({ path, code, message }) => `${path.join('.')}: ${code === 'custom' ? message : code}`
  )
}

function answerFor(written: Record<string, unknown>): FrozenAnswer {
  const admittedAt: number[] = []
  const refused: FrozenAnswer['refused'] = []
  for (const version of VERSIONS) {
    const issues = refusals(written, version)
    if (issues === undefined) {
      admittedAt.push(version)
      continue
    }
    const group = refused.find((known) => JSON.stringify(known.with) === JSON.stringify(issues))
    if (group) group.at.push(version)
    else refused.push({ at: [version], with: issues })
  }
  return {
    stamp: written.schemaVersion as number,
    entryHash: written.entryHash as string,
    admittedAt,
    refused
  }
}

function projectionOf(name: string, entry: object | undefined): FrozenProjection {
  // The JSON round trip drops a key whose value is undefined, which canonical
  // JSON cannot carry; `keys` is what pins that such a key is there.
  const carried: unknown = JSON.parse(JSON.stringify(entry ?? {}))
  return {
    name,
    keys: Object.keys(entry ?? {}),
    digest: createHash('sha256').update(canonicalStringify(carried)).digest('hex')
  }
}

describe('Manifest Entry known answers: the stamp and the reader', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-entry-known-answers-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  it('reads up to schema version 7', () => {
    // A bump adds a column to every answer below: record the new answers
    // beside the old ones, which must not move.
    expect(MANIFEST_SCHEMA_VERSION).toBe(7)
  })

  it('has a frozen answer for every case and no case without one', () => {
    expect(Object.keys(FIXTURE.entries)).toEqual(KNOWN_ANSWERS.map(({ name }) => name))
  })

  it.each(KNOWN_ANSWERS)('$name: stamps $stamp and reads from $readFrom', (answer) => {
    const written = write(caseDir, answer)
    expect(written.schemaVersion).toBe(answer.stamp)

    const actual = answerFor(written)
    expect(actual.admittedAt).toEqual(
      VERSIONS.filter((version) => version >= answer.readFrom && version <= MANIFEST_SCHEMA_VERSION)
    )
    expect(actual.admittedAt).toContain(answer.stamp)
    expect(actual).toEqual(FIXTURE.entries[answer.name])

    // The entry as written is one this build's own chain verification passes.
    const chain = verifyManifestChain(caseDir)
    expect(chain.reason).toBeUndefined()
    expect(chain.valid).toBe(true)
  })

  it('hands back each capture entry of a verified chain as frozen, key order included', () => {
    const captures = KNOWN_ANSWERS.filter(({ input }) => input.type === 'capture')
    for (const answer of captures) write(caseDir, answer)
    const chain = verifyManifestChain(caseDir)
    expect(chain.reason).toBeUndefined()
    expect(chain.valid).toBe(true)
    expect(chain.captureEntriesByIndex.size).toBe(captures.length)

    const actual = captures.map(({ name }, index) =>
      projectionOf(name, chain.captureEntriesByIndex.get(index))
    )
    expect(actual).toEqual(FIXTURE.captureChain)
  })

  it('keeps the three hash keys on a capture entry that carries one hash', () => {
    write(caseDir, KNOWN_ANSWERS[1])
    const entry = verifyManifestChain(caseDir).captureEntriesByIndex.get(0)
    expect(entry).toStrictEqual({
      contentHash: 'a'.repeat(64),
      screenshotHash: undefined,
      textHash: undefined
    })
  })
})
