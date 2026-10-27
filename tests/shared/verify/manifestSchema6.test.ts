import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  appendManifestEntry,
  initManifest,
  verifyManifestChain,
  withCaptureEntry
} from '@main/services/manifest'
import type { CaptureEntryContext } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { VERIFY_RECIPES } from '@main/services/verifyProcedure'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { BOUND_TLS_ABSENCES } from '@shared/types'
import { pdfPath, transactionRecordPath } from '../../../src/packages/evidence-package-layout/index'
import { HAS_JQ } from '../../helpers/jq'
import { buildSignedChain } from '../../helpers/egressPackage'
import {
  ENGINE_BOUND_TLS,
  ENGINE_CAPTURE_ID,
  ENGINE_HASHES,
  ENGINE_INVENTORY,
  ENGINE_SCROLL_TO_LOAD,
  engineCaptureEntry,
  engineFields,
  writeEnginePackage
} from '../../helpers/captureEnginePackage'

// Known-answer tests for manifest schema 6: the capture engine's optional
// fields on a `capture` entry (docs/plans/2026-10-10-capture-engine-first-slice.md,
// D1 to D7). The answers frozen here:
//   1. a capture entry WITHOUT the fields canonicalizes and hashes to the same
//      bytes as before the bump, and so does one carrying the schema-5 Egress
//      fields, so every chain already written still verifies;
//   2. a capture entry carrying the fields hashes to one frozen digest, and its
//      canonical body is the same through canonicalStringify and through the
//      Verify Runbook's `jq -cS` recipe;
//   3. the schema refuses a fractional number in any new field, each shape D2
//      names as contradicting itself, and the fields under a stamp below 6;
//   4. the app verifier verifies such an entry and carries the fields in its
//      result, and the package verifier binds the Transaction Record and the
//      PDF and states which headers had their values replaced.
// A schema-5 verifier meeting the fields is in manifestSchema6TooOld.test.ts.
//
// If a frozen digest fails, the canonical body of a capture entry changed and
// every chain already written with it is now unverifiable: that is the finding,
// not the test.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000002'
const CAPTURE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000001'
const OPERATOR = { operatorId: 'op-1', operatorName: 'Casey Operator', toolVersion: '0.4.0' }

// The schema-2 capture body manifestSchema3.test.ts freezes, field for field.
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

// The body manifestSchema5.test.ts freezes with the four Egress fields.
const CAPTURE_BODY_EGRESS = {
  ...CAPTURE_BODY,
  egressKind: 'proxy',
  egressLabel: 'Frankfurt VPN',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/152.0.7977.130 Electron/44.4.5',
  tlsSkipped: 'egress-not-direct',
  schemaVersion: 5
}

// The same schema-2 body with five of the six fields, stamped 6.
const CAPTURE_BODY_ENGINE = {
  ...CAPTURE_BODY,
  inventory: ENGINE_INVENTORY,
  scrollToLoad: ENGINE_SCROLL_TO_LOAD,
  transactionRecordHash: 'd'.repeat(64),
  boundTls: ENGINE_BOUND_TLS,
  pdfHash: 'e'.repeat(64),
  schemaVersion: 6
}

// A copy of `body` without `keys`.
function omit(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...body }
  for (const key of keys) delete copy[key]
  return copy
}

// The sixth field, `boundTlsAbsent`, in place of `boundTls`.
const CAPTURE_BODY_ENGINE_TLS_ABSENT = {
  ...omit(CAPTURE_BODY_ENGINE, 'boundTls'),
  boundTlsAbsent: 'from-cache'
}

const FROZEN_ENTRY_HASHES = {
  // The values manifestSchema3.test.ts and manifestSchema5.test.ts froze
  // before this change, unchanged.
  capture: 'c993dd9744c9f98bc096939e5d37c7f5b0490b47098dd961a01def5cc2a68ebf',
  captureEgress: '21bb1cd0ae37233b3561460d21da8d7f124980e6c08f7bb52cebd5c90756ad7f',
  // Frozen at #1904, the first build that reads these bodies, and reproduced
  // outside this codebase by `jq -cS` and by Python's sorted-key JSON. New
  // answers, not moved ones: `capture` above is the same entry without the
  // fields.
  captureEngine: '15c08b9de3895cb309ac1306848140d90505f57ac2dc3c0b48d1916082b48e25',
  captureEngineTlsAbsent: '4be960e3533ce1c6a8acc2d656ea088189532e80f23f86f9b833dc1778497f28'
}

function entryHashOf(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

function parse(body: Record<string, unknown>) {
  return ManifestEntrySchema.safeParse({ ...body, entryHash: 'f'.repeat(64) })
}

// A deep copy of `body` with the value at `path` replaced.
function withValue(
  body: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): Record<string, unknown> {
  const copy = structuredClone(body)
  let node = copy as Record<string | number, unknown>
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>
  node[path[path.length - 1]] = value
  return copy
}

function messages(body: Record<string, unknown>): string[] {
  return parse(body).error?.issues.map((issue) => issue.message) ?? []
}

describe('manifest schema 6 — frozen entry hashes', () => {
  it('reads up to schema version 6', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(6)
  })

  it('leaves the canonical hashes of capture entries without the fields unchanged', () => {
    expect(entryHashOf(CAPTURE_BODY)).toBe(FROZEN_ENTRY_HASHES.capture)
    expect(parse(CAPTURE_BODY).success).toBe(true)
    expect(entryHashOf(CAPTURE_BODY_EGRESS)).toBe(FROZEN_ENTRY_HASHES.captureEgress)
    expect(parse(CAPTURE_BODY_EGRESS).success).toBe(true)
  })

  it('pins the canonical hash of a capture entry carrying the fields', () => {
    expect(entryHashOf(CAPTURE_BODY_ENGINE)).toBe(FROZEN_ENTRY_HASHES.captureEngine)
    expect(parse(CAPTURE_BODY_ENGINE).success).toBe(true)
    expect(entryHashOf(CAPTURE_BODY_ENGINE_TLS_ABSENT)).toBe(
      FROZEN_ENTRY_HASHES.captureEngineTlsAbsent
    )
    expect(parse(CAPTURE_BODY_ENGINE_TLS_ABSENT).success).toBe(true)
  })

  // The runbook's recipe run as VERIFY.md prints it, on the line as a writer
  // stores it: keys in writer order, with `entryHash` and `signature` present.
  it.skipIf(!HAS_JQ)('canonicalizes the same through the Verify Runbook jq -cS recipe', () => {
    for (const body of [CAPTURE_BODY_ENGINE, CAPTURE_BODY_ENGINE_TLS_ABSENT]) {
      const line = JSON.stringify({ ...body, entryHash: 'f'.repeat(64), signature: 'sig' })
      const viaJq = execFileSync('/bin/sh', ['-c', VERIFY_RECIPES.canonicalEntryBody], {
        input: line,
        encoding: 'utf-8'
      })
      expect(viaJq).toBe(canonicalStringify(body))
    }
  })
})

describe('manifest schema 6 — the schema', () => {
  it('refuses a fractional or negative number in each new numeric field', () => {
    const numeric: Array<Array<string | number>> = [
      ...[
        'exchanges',
        'cached',
        'cancelled',
        'failed',
        'inFlight',
        'finishedWithoutResponse',
        'bodiesOmitted',
        'incompleteRequestBodies',
        'webSockets',
        'recordedTargets',
        'unrecordedTargets'
      ].map((count) => ['inventory', 'transactionRecord', count]),
      ['inventory', 'mhtml', 'pinnedImages'],
      ['inventory', 'mhtml', 'pinnedImagesNotLoaded'],
      ['inventory', 'transactionRecord', 'budget', 'totalBytes'],
      ['inventory', 'transactionRecord', 'budget', 'resourceBytes'],
      ...['contentWidth', 'contentHeight', 'width', 'height'].map((size) => [
        'inventory',
        'screenshot',
        size
      ]),
      ['scrollToLoad', 'endHeight'],
      ['boundTls', 'serverSignatureAlgorithm']
    ]
    for (const path of numeric) {
      for (const value of [1.5, -1]) {
        const result = parse(withValue(CAPTURE_BODY_ENGINE, path, value))
        expect(result.success, `${path.join('.')} = ${value}`).toBe(false)
        expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(path)
      }
    }
  })

  describe('the pinned image counts in the MHTML part (#1843)', () => {
    const withMhtml = (mhtml: Record<string, unknown>) =>
      withValue(CAPTURE_BODY_ENGINE, ['inventory', 'mhtml'], mhtml)

    it('accepts 3 pinned images of which 1 had not loaded, and none pinned', () => {
      const pinned = { present: true, pinnedImages: 3, pinnedImagesNotLoaded: 1 }
      expect(parse(withMhtml(pinned)).success).toBe(true)
      const none = { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 }
      expect(parse(withMhtml(none)).success).toBe(true)
    })

    it('refuses more images not loaded than pinned, with a named error', () => {
      const over = { present: true, pinnedImages: 1, pinnedImagesNotLoaded: 2 }
      expect(messages(withMhtml(over))).toEqual([
        '`pinnedImagesNotLoaded` cannot exceed `pinnedImages`'
      ])
    })

    it('refuses an MHTML part missing either count', () => {
      for (const key of ['pinnedImages', 'pinnedImagesNotLoaded']) {
        const mhtml = omit({ present: true, pinnedImages: 3, pinnedImagesNotLoaded: 1 }, key)
        const result = parse(withMhtml(mhtml))
        expect(result.success, key).toBe(false)
        expect(result.error?.issues.map((issue) => issue.path)).toContainEqual([
          'inventory',
          'mhtml',
          key
        ])
      }
    })
  })

  it('refuses a Scroll-to-load record that never ran but names an end, with a named error', () => {
    const message = '`outcome` and `endHeight` require `ran` to be true'
    const notRun = { requested: true, ran: false, scrollLockLifted: false }
    expect(parse({ ...CAPTURE_BODY_ENGINE, scrollToLoad: notRun }).success).toBe(true)
    for (const extra of [{ outcome: 'time-budget' }, { endHeight: 900 }]) {
      const scrollToLoad = { ...notRun, ...extra }
      expect(messages({ ...CAPTURE_BODY_ENGINE, scrollToLoad }), JSON.stringify(extra)).toEqual([
        message
      ])
    }
  })

  it('refuses a present Transaction Record part without finishedWithoutResponse', () => {
    const path = ['inventory', 'transactionRecord']
    const record = omit(ENGINE_INVENTORY.transactionRecord, 'finishedWithoutResponse')
    const result = parse(withValue(CAPTURE_BODY_ENGINE, path, record))
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((issue) => issue.path)).toContainEqual([
      ...path,
      'finishedWithoutResponse'
    ])
  })

  it('refuses a time that is a number or not an ISO 8601 date-time', () => {
    const times: Array<Array<string | number>> = [
      ['boundTls', 'validFrom'],
      ['boundTls', 'validTo'],
      ['boundTls', 'signedCertificateTimestampList', 0, 'timestamp']
    ]
    for (const path of times) {
      for (const value of [1791751656.5, '2026-09-01', 'Sep  1 00:00:00 2026 GMT']) {
        const result = parse(withValue(CAPTURE_BODY_ENGINE, path, value))
        expect(result.success, `${path.join('.')} = ${value}`).toBe(false)
      }
    }
  })

  it('accepts a boundTls with an empty keyExchange, a keyExchangeGroup and no mac', () => {
    // A TLS 1.3 connection: CDP reports the key exchange as "the empty string
    // if not applicable", and an AEAD cipher has no separate MAC.
    const boundTls = {
      ...omit(ENGINE_BOUND_TLS, 'mac'),
      protocol: 'TLS 1.3',
      keyExchange: '',
      cipher: 'AES_128_GCM'
    }
    expect(boundTls).not.toHaveProperty('mac')
    expect(boundTls).toHaveProperty('keyExchangeGroup', 'P-256')
    expect(parse({ ...CAPTURE_BODY_ENGINE, boundTls }).success).toBe(true)
  })

  it('accepts a boundTls without its optional serverSignatureAlgorithm', () => {
    const boundTls = omit(ENGINE_BOUND_TLS, 'serverSignatureAlgorithm')
    expect(parse({ ...CAPTURE_BODY_ENGINE, boundTls }).success).toBe(true)
  })

  it('accepts each reason Bound TLS Details can be absent, and no other', () => {
    for (const reason of BOUND_TLS_ABSENCES) {
      expect(parse({ ...CAPTURE_BODY_ENGINE_TLS_ABSENT, boundTlsAbsent: reason }).success).toBe(
        true
      )
    }
    expect(parse({ ...CAPTURE_BODY_ENGINE_TLS_ABSENT, boundTlsAbsent: 'tls-1.0' }).success).toBe(
      false
    )
  })

  it('accepts a Transaction Record and a PDF recorded absent, with neither hash', () => {
    const rest = omit(CAPTURE_BODY_ENGINE, 'transactionRecordHash', 'pdfHash')
    for (const reason of ['not-taken', 'failed']) {
      const inventory = {
        ...ENGINE_INVENTORY,
        transactionRecord: { present: false, reason },
        pdf: { present: false, reason }
      }
      expect(parse({ ...rest, inventory }).success, reason).toBe(true)
    }
  })

  it('refuses a value the first slice cannot write', () => {
    const refused: Array<[Array<string | number>, unknown]> = [
      [['inventory', 'mhtml', 'present'], false],
      [['inventory', 'screenshot', 'present'], false],
      [['inventory', 'pdf', 'afterCollection'], false],
      [
        ['inventory', 'transactionRecord', 'replacedHeaders'],
        ['cookie', 'x-api-key']
      ],
      [['scrollToLoad', 'requested'], false],
      [['scrollToLoad', 'outcome'], 'failed'],
      [['boundTls', 'certificateTransparencyCompliance'], 'compliant-ish'],
      [['transactionRecordHash'], 'D'.repeat(64)],
      [['pdfHash'], `../${'e'.repeat(61)}`]
    ]
    for (const [path, value] of refused) {
      expect(parse(withValue(CAPTURE_BODY_ENGINE, path, value)).success, path.join('.')).toBe(false)
    }
    // An absence reason outside the closed list.
    const noRecordHash = omit(CAPTURE_BODY_ENGINE, 'transactionRecordHash')
    const unknownReason = withValue(noRecordHash, ['inventory', 'transactionRecord'], {
      present: false,
      reason: 'blocked'
    })
    expect(parse(unknownReason).success).toBe(false)
  })

  it('refuses a key the schema does not know, at every level of the new fields', () => {
    const keyed: Array<Array<string | number>> = [
      ['inventory', 'extra'],
      ['inventory', 'mhtml', 'extra'],
      ['inventory', 'transactionRecord', 'extra'],
      ['inventory', 'transactionRecord', 'budget', 'extra'],
      ['inventory', 'screenshot', 'extra'],
      ['inventory', 'pdf', 'extra'],
      ['scrollToLoad', 'extra'],
      ['boundTls', 'certificateId'],
      ['boundTls', 'signedCertificateTimestampList', 0, 'extra']
    ]
    for (const path of keyed) {
      expect(parse(withValue(CAPTURE_BODY_ENGINE, path, 1)).success, path.join('.')).toBe(false)
    }
  })

  it('refuses each field under a stamp below 6', () => {
    // A schema-5 reader's strict capture shape has none of these fields, so
    // under a 5 it would read the entry as a broken chain, not "verifier too old".
    const message = 'the capture engine fields on a capture entry require schemaVersion 6'
    const withInventory = omit(CAPTURE_BODY_ENGINE, 'boundTls', 'transactionRecordHash', 'pdfHash')
    const fields: Array<Record<string, unknown>> = [
      CAPTURE_BODY_ENGINE,
      CAPTURE_BODY_ENGINE_TLS_ABSENT,
      { ...CAPTURE_BODY, scrollToLoad: ENGINE_SCROLL_TO_LOAD },
      { ...CAPTURE_BODY, boundTls: ENGINE_BOUND_TLS },
      { ...CAPTURE_BODY, boundTlsAbsent: 'not-https' },
      withValue(withInventory, ['inventory'], {
        ...ENGINE_INVENTORY,
        transactionRecord: { present: false, reason: 'not-taken' },
        pdf: { present: false, reason: 'not-taken' }
      })
    ]
    for (const body of fields) {
      const below = { ...body, schemaVersion: 5 }
      expect(messages(below), JSON.stringify(Object.keys(body))).toEqual([message])
      expect(parse({ ...body, schemaVersion: 6 }).success).toBe(true)
    }
  })

  describe('each D2 refine names the shape it refuses', () => {
    const recordMessage =
      '`transactionRecordHash` requires `inventory`, and is present exactly when ' +
      '`inventory.transactionRecord.present` is true'
    const pdfMessage =
      '`pdfHash` requires `inventory`, and is present exactly when `inventory.pdf.present` is true'

    it('1. a Transaction Record hash without an inventory, or against it', () => {
      const noInventory = omit(CAPTURE_BODY_ENGINE_TLS_ABSENT, 'inventory', 'pdfHash')
      expect(messages(noInventory)).toEqual([recordMessage])
      const noHash = omit(CAPTURE_BODY_ENGINE, 'transactionRecordHash')
      expect(messages(noHash)).toEqual([recordMessage])
      const absent = withValue(CAPTURE_BODY_ENGINE, ['inventory', 'transactionRecord'], {
        present: false,
        reason: 'failed'
      })
      expect(messages(absent)).toEqual([recordMessage])
    })

    it('2. a PDF hash without an inventory, or against it', () => {
      const noInventory = omit(CAPTURE_BODY_ENGINE_TLS_ABSENT, 'inventory', 'transactionRecordHash')
      expect(messages(noInventory)).toEqual([pdfMessage])
      const noHash = omit(CAPTURE_BODY_ENGINE, 'pdfHash')
      expect(messages(noHash)).toEqual([pdfMessage])
      const absent = withValue(CAPTURE_BODY_ENGINE, ['inventory', 'pdf'], {
        present: false,
        reason: 'not-taken'
      })
      expect(messages(absent)).toEqual([pdfMessage])
    })

    it('3. an inventory without a screenshot hash', () => {
      const noScreenshot = omit(CAPTURE_BODY_ENGINE, 'screenshotHash')
      expect(messages(noScreenshot)).toEqual(['`inventory` requires `screenshotHash`'])
    })

    it('4. Bound TLS Details beside a reason they are absent', () => {
      const both = { ...CAPTURE_BODY_ENGINE, boundTlsAbsent: 'not-reported' }
      expect(messages(both)).toEqual(['`boundTls` and `boundTlsAbsent` cannot both be present'])
    })

    it('reports a signed chain holding a refused shape as broken at that entry', () => {
      const noScreenshot = omit(CAPTURE_BODY_ENGINE, 'screenshotHash')
      const result = verify(buildSignedChain([CAPTURE_BODY, noScreenshot]))
      expect(result.valid).toBe(false)
      expect(result.unsupported).toBeUndefined()
      expect(result.brokenAt).toBe(1)
      expect(result.reason).toBe('Invalid entry shape')
    })
  })
})

describe('manifest schema 6 — the app verifier', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const context = (
    captureId: string,
    fields: Partial<CaptureEntryContext> = {}
  ): CaptureEntryContext => ({
    captureId,
    caseId: CASE_ID,
    url: 'https://example.com/page',
    timestamp: '2026-10-18T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    screenshotHash: 'b'.repeat(64),
    method: 'background',
    sizeBytes: 10,
    ...OPERATOR,
    ...fields
  })

  const stamps = (): number[] =>
    readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { schemaVersion: number }).schemaVersion)

  // The fixture values, typed as the writer's context types them.
  const fields = engineFields({
    transactionRecordHash: 'd'.repeat(64),
    pdfHash: 'e'.repeat(64)
  }) as Partial<CaptureEntryContext>

  it('writes every field it is given through withCaptureEntry, and stamps the entry 6', async () => {
    await withCaptureEntry(caseDir, context('cap-0', fields), () => undefined)
    const [line] = readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8').trim().split('\n')
    expect(JSON.parse(line)).toMatchObject({ ...fields, schemaVersion: 6 })
  })

  it('writes none of the fields it is not given, and stamps such an entry 2', async () => {
    await withCaptureEntry(caseDir, context('cap-0'), () => undefined)
    const [line] = readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8').trim().split('\n')
    const written = JSON.parse(line) as Record<string, unknown>
    for (const key of Object.keys(fields)) expect(written).not.toHaveProperty(key)
    expect(written.schemaVersion).toBe(2)
  })

  it('stamps an entry carrying any one of the fields 6, over the Egress and Exhibit stamps', () => {
    const base = context('cap')
    appendManifestEntry(caseDir, { type: 'capture', ...base })
    appendManifestEntry(caseDir, {
      type: 'capture',
      ...base,
      scrollToLoad: fields.scrollToLoad
    })
    // The inventory alone, with no file it could anchor: the two hashes need
    // it, so it is the one field of the six that a valid entry can carry alone.
    appendManifestEntry(caseDir, {
      type: 'capture',
      ...base,
      inventory: {
        ...ENGINE_INVENTORY,
        transactionRecord: { present: false, reason: 'not-taken' },
        pdf: { present: false, reason: 'not-taken' }
      } as CaptureEntryContext['inventory']
    })
    appendManifestEntry(caseDir, { type: 'capture', ...base, boundTls: fields.boundTls })
    appendManifestEntry(caseDir, { type: 'capture', ...base, boundTlsAbsent: 'not-https' })
    appendManifestEntry(caseDir, {
      type: 'capture',
      ...base,
      egressKind: 'tor',
      exhibitNumber: 4,
      boundTlsAbsent: 'not-reported'
    })
    appendManifestEntry(caseDir, { type: 'capture', ...base, ...fields })
    expect(stamps()).toEqual([2, 6, 6, 6, 6, 6, 6])
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('verifies an entry carrying the fields and carries them in its result', async () => {
    await withCaptureEntry(caseDir, context('cap-0'), () => undefined)
    await withCaptureEntry(caseDir, context('cap-1', fields), () => undefined)
    await withCaptureEntry(
      caseDir,
      context('cap-2', { ...fields, boundTls: undefined, boundTlsAbsent: 'from-cache' }),
      () => undefined
    )
    const result = verifyManifestChain(caseDir)
    expect(result.valid).toBe(true)
    expect(result.captureEntriesByIndex.get(1)).toEqual({
      contentHash: 'a'.repeat(64),
      screenshotHash: 'b'.repeat(64),
      textHash: undefined,
      ...fields
    })
    expect(result.captureEntriesByIndex.get(2)).toMatchObject({ boundTlsAbsent: 'from-cache' })
    expect(Object.keys(result.captureEntriesByIndex.get(2) ?? {})).not.toContain('boundTls')
    // An entry without the fields carries none of their keys, not keys set to undefined.
    const plain = Object.keys(result.captureEntriesByIndex.get(0) ?? {})
    for (const key of Object.keys(fields)) expect(plain).not.toContain(key)
  })
})

describe('manifest schema 6 — the package verifier', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const rowFor = (result: ReturnType<typeof verifyEvidencePackage>, name: string) =>
    result.checks.find((check) => check.name === name)
  const recordRow = `capture ${ENGINE_CAPTURE_ID} transaction record`
  const headersRow = `capture ${ENGINE_CAPTURE_ID} transaction record headers`
  const pdfRow = `capture ${ENGINE_CAPTURE_ID} pdf`
  const HEADERS_TEXT =
    'the signed capture entry records that the Transaction Record holds the headers cookie, ' +
    'set-cookie with their values replaced: the headers are present, their values are not'
  const HEADERS_UNVERIFIED_TEXT =
    "not reported: the manifest chain FAILed, so this entry's replaced header names are unverified"

  it('passes a package whose capture entry carries the fields, and binds both files', () => {
    writeEnginePackage(pkgDir)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
    expect(rowFor(result, 'manifest chain')?.status).toBe('pass')
    expect(rowFor(result, recordRow)).toEqual({ name: recordRow, status: 'pass' })
    expect(rowFor(result, pdfRow)).toEqual({ name: pdfRow, status: 'pass' })
  })

  it('passes the same package with boundTlsAbsent in place of boundTls', () => {
    writeEnginePackage(pkgDir, engineFields({ boundTls: undefined, boundTlsAbsent: 'from-cache' }))
    expect(verifyEvidencePackage(pkgDir).pass).toBe(true)
  })

  it('states which headers had their values replaced, in the pinned text', () => {
    writeEnginePackage(pkgDir)
    expect(rowFor(verifyEvidencePackage(pkgDir), headersRow)).toEqual({
      name: headersRow,
      status: 'skip',
      reason: HEADERS_TEXT
    })
  })

  it('states that no header value was replaced when the inventory names none', () => {
    const inventory = withValue(ENGINE_INVENTORY, ['transactionRecord', 'replacedHeaders'], [])
    writeEnginePackage(pkgDir, engineFields({ inventory }))
    expect(rowFor(verifyEvidencePackage(pkgDir), headersRow)?.reason).toBe(
      'the signed capture entry records that no header value in the Transaction Record was replaced'
    )
  })

  it('quotes no header name from an entry behind a FAILed chain, in the pinned text', () => {
    // A parse-stage break returns before any signature is checked, so the
    // entry before it is schema-valid but unverified.
    writeEnginePackage(pkgDir)
    appendFileSync(join(pkgDir, 'manifest.jsonl'), '{not json\n', 'utf-8')
    const result = verifyEvidencePackage(pkgDir)
    expect(rowFor(result, 'manifest chain')?.status).toBe('fail')
    expect(rowFor(result, headersRow)).toEqual({
      name: headersRow,
      status: 'skip',
      reason: HEADERS_UNVERIFIED_TEXT
    })
    expect(JSON.stringify(result.checks)).not.toContain('set-cookie')
  })

  it('fails a changed byte in either file', () => {
    for (const [row, path, subject] of [
      [recordRow, transactionRecordPath(ENGINE_HASHES.transactionRecord), 'Transaction Record'],
      [pdfRow, pdfPath(ENGINE_HASHES.pdf), 'PDF']
    ]) {
      rmSync(pkgDir, { recursive: true, force: true })
      pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-pkg-'))
      writeEnginePackage(pkgDir)
      const bytes = readFileSync(join(pkgDir, path))
      bytes[0] ^= 0x01
      writeFileSync(join(pkgDir, path), bytes)
      const result = verifyEvidencePackage(pkgDir)
      expect(result.pass).toBe(false)
      expect(rowFor(result, row)).toEqual({
        name: row,
        status: 'fail',
        reason: `capture ${ENGINE_CAPTURE_ID}: ${subject} hash does not match manifest`
      })
    }
  })

  it('fails a missing file', () => {
    for (const [row, path, subject] of [
      [recordRow, transactionRecordPath(ENGINE_HASHES.transactionRecord), 'Transaction Record'],
      [pdfRow, pdfPath(ENGINE_HASHES.pdf), 'PDF']
    ]) {
      rmSync(pkgDir, { recursive: true, force: true })
      pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-pkg-'))
      writeEnginePackage(pkgDir)
      rmSync(join(pkgDir, path))
      const result = verifyEvidencePackage(pkgDir)
      expect(result.pass).toBe(false)
      expect(rowFor(result, row)).toEqual({
        name: row,
        status: 'fail',
        reason: `capture ${ENGINE_CAPTURE_ID}: ${subject} file missing`
      })
    }
  })

  it('skips an absent hash, and adds no headers row when the record is absent', () => {
    const inventory = {
      ...ENGINE_INVENTORY,
      transactionRecord: { present: false, reason: 'not-taken' },
      pdf: { present: false, reason: 'not-taken' }
    }
    writeEnginePackage(
      pkgDir,
      engineFields({ inventory, transactionRecordHash: undefined, pdfHash: undefined })
    )
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(true)
    expect(rowFor(result, recordRow)).toEqual({
      name: recordRow,
      status: 'skip',
      reason: 'the entry anchors no Transaction Record'
    })
    expect(rowFor(result, pdfRow)).toEqual({
      name: pdfRow,
      status: 'skip',
      reason: 'the entry anchors no PDF'
    })
    expect(rowFor(result, headersRow)).toBeUndefined()
  })

  it('skips both rows and adds no headers row for a capture entry without the fields', () => {
    writeEnginePackage(pkgDir, {})
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(true)
    expect(rowFor(result, recordRow)?.reason).toBe('the entry anchors no Transaction Record')
    expect(rowFor(result, pdfRow)?.reason).toBe('the entry anchors no PDF')
    expect(rowFor(result, headersRow)).toBeUndefined()
  })

  // ADR-0035 never lets the record read as more complete than the inventory
  // supports, and the record is the browser's account, not bytes read off the
  // network (spec, What the record is and is not). The rows above are every
  // string the verifier prints about the record; the source scan covers the
  // strings no fixture here reaches.
  const OVERCLAIM = /\bcomplete\b|packet capture|\bwire\b/i

  it('prints no row calling the Transaction Record complete, a packet capture, or wire bytes', () => {
    const printed: string[] = []
    const run = (fields?: Record<string, unknown>, edit?: () => void): void => {
      rmSync(pkgDir, { recursive: true, force: true })
      pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-pkg-'))
      writeEnginePackage(pkgDir, fields)
      edit?.()
      for (const { name, reason } of verifyEvidencePackage(pkgDir).checks) {
        printed.push(name, reason ?? '')
      }
    }
    run()
    run(
      engineFields({
        inventory: withValue(ENGINE_INVENTORY, ['transactionRecord', 'replacedHeaders'], [])
      })
    )
    run(undefined, () => appendFileSync(join(pkgDir, 'manifest.jsonl'), '{not json\n', 'utf-8'))
    run(undefined, () =>
      rmSync(join(pkgDir, transactionRecordPath(ENGINE_HASHES.transactionRecord)))
    )
    run(undefined, () =>
      writeFileSync(join(pkgDir, transactionRecordPath(ENGINE_HASHES.transactionRecord)), 'x')
    )
    expect(printed.filter((text) => OVERCLAIM.test(text))).toEqual([])
    expect(printed).toContain(HEADERS_TEXT)
  })

  it('holds no such word in the modules that build the printed rows', () => {
    const root = join(__dirname, '..', '..', '..')
    for (const file of ['src/shared/verify/evidencePackage.ts', 'src/verifier/cli.ts']) {
      const offenders = readFileSync(join(root, file), 'utf-8')
        .split('\n')
        .filter((line) => OVERCLAIM.test(line))
      expect(offenders, file).toEqual([])
    }
  })

  it('builds its package from the values the frozen digest covers', () => {
    expect(engineCaptureEntry()).toMatchObject({
      inventory: CAPTURE_BODY_ENGINE.inventory,
      scrollToLoad: CAPTURE_BODY_ENGINE.scrollToLoad,
      boundTls: CAPTURE_BODY_ENGINE.boundTls,
      schemaVersion: 6
    })
  })
})
