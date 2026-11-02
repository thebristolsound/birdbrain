import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import type { ManifestEntryInput } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { VERIFY_RECIPES } from '@main/services/verifyProcedure'
import { VERIFY_SCRIPT } from '@main/services/verifyScript'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { BROWSER_FAMILIES, CAPTURE_METHODS, PASSIVE_CAPTURE_RULES } from '@shared/types'
import { PACKAGE_ROOT_FILES } from '../../../src/packages/evidence-package-layout/index'
import { HAS_JQ } from '../../helpers/jq'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { checkConformance } from '../../helpers/verifyConformance'
import { buildSignedChain } from '../../helpers/egressPackage'
import { ENGINE_INVENTORY, writeEnginePackage } from '../../helpers/captureEnginePackage'
import { LINK_CAPTURE_BODY } from '../../helpers/linkProvenance'
import {
  LAUNCHED_BROWSER_FIELDS,
  LAUNCHED_CAPTURE_BODY,
  LAUNCHED_INVENTORY,
  LAUNCHED_TRANSACTION_RECORD,
  PASSIVE_CAPTURE_BODY,
  PERSONA_EXHIBIT_BODY,
  PERSONA_FIELDS,
  SCHEMA_2_CAPTURE_BODY,
  SCHEMA_3_EXHIBIT_BODY,
  SCHEMA_6_ENGINE_BODY,
  launchedFields,
  passiveFields
} from '../../helpers/launchedBrowser'

// Known-answer tests for manifest schema 7: the launched browser's values on a
// `capture` entry (docs/specs/2026-10-10-capture-engine-launched-browser-design.md,
// "Manifest, schema, and verifier", as the maintainer ruled on 2026-10-31) and
// the Persona fields on `capture` and `exhibit` entries (#1498, ADR-0030). The
// answers frozen here:
//   1. every entry written before the bump hashes to the digest an earlier
//      test froze, and an entry carrying the new values hashes to one frozen
//      digest, the same through canonicalStringify and the Verify Runbook's
//      `jq -cS` recipe;
//   2. the schema accepts each new value at 7, refuses each under a stamp of
//      6, and refuses a method, reason, family or rule outside its list;
//   3. the writer stamps 7 exactly when an entry carries a new value;
//   4. the app verifier, the package verifier and verify.sh verify such an
//      entry.
// A schema-6 verifier meeting the values is in manifestSchema7TooOld.test.ts.
//
// If a frozen digest fails, the canonical body of an entry changed and every
// chain already written with it is now unverifiable: that is the finding, not
// the test.

const FROZEN_ENTRY_HASHES = {
  // Frozen before this change by manifestSchema3, manifestSchema6 and
  // manifestSchema6LinkProvenance, unchanged.
  capture: 'c993dd9744c9f98bc096939e5d37c7f5b0490b47098dd961a01def5cc2a68ebf',
  captureEngine: '15c08b9de3895cb309ac1306848140d90505f57ac2dc3c0b48d1916082b48e25',
  captureLink: '09e6d206243446dcc93c93cd1e484b2d1dc8a9dc9d9ab09d40e5c10cad9bd2f1',
  exhibit: 'a3088330cefd3f04fe332992d9597cacebf6760c68f528a10b944465fc085431',
  // Frozen at #1830, the first build that reads these bodies, and reproduced
  // outside this codebase by `jq -cS` and by Python's sorted-key JSON.
  captureLaunched: '3cc1e37a10fa946a5723512a9fca4b6c09ef396ef11b13d28910c4105916eb8a',
  capturePassive: 'c34af9370259363616e0b17f7f57897ba8f6f8d7563a5154b437d1aefe82511a',
  exhibitPersona: '2e5957fb6214db4b34d389e37ebaa021eab834a169171ac4d0e8c0ea870da7f2'
}

const LAUNCHED_MESSAGE = 'the launched browser values on a capture entry require schemaVersion 7'
const PERSONA_MESSAGE = 'the Persona fields require schemaVersion 7'

// A copy of `body` without `keys`.
function omit(body: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  const copy = { ...body }
  for (const key of keys) delete copy[key]
  return copy
}

function entryHashOf(body: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalStringify(body)).digest('hex')
}

function parse(body: Record<string, unknown>) {
  return ManifestEntrySchema.safeParse({ ...body, entryHash: 'f'.repeat(64) })
}

const PASSIVE_METHOD = { method: 'launched-passive' }

function messages(body: Record<string, unknown>): string[] {
  return parse(body).error?.issues.map((issue) => issue.message) ?? []
}

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

const withTransactionRecord = (
  body: Record<string, unknown>,
  transactionRecord: Record<string, unknown>
): Record<string, unknown> => ({
  ...omit(body, 'transactionRecordHash'),
  inventory: { ...(body.inventory as Record<string, unknown>), transactionRecord }
})

const withPdf = (
  body: Record<string, unknown>,
  pdf: Record<string, unknown>
): Record<string, unknown> => ({
  ...omit(body, 'pdfHash'),
  inventory: { ...(body.inventory as Record<string, unknown>), pdf }
})

const NEW_CAPTURE_KEYS = [
  'method',
  'passiveRule',
  ...Object.keys(LAUNCHED_BROWSER_FIELDS),
  ...Object.keys(PERSONA_FIELDS)
]

describe('manifest schema 7 — frozen entry hashes', () => {
  it('reads up to schema version 7', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(7)
  })

  it('leaves the canonical hashes of entries without the new values unchanged', () => {
    const before: Array<[Record<string, unknown>, string]> = [
      [SCHEMA_2_CAPTURE_BODY, FROZEN_ENTRY_HASHES.capture],
      [SCHEMA_6_ENGINE_BODY, FROZEN_ENTRY_HASHES.captureEngine],
      [LINK_CAPTURE_BODY, FROZEN_ENTRY_HASHES.captureLink],
      [SCHEMA_3_EXHIBIT_BODY, FROZEN_ENTRY_HASHES.exhibit]
    ]
    for (const [body, digest] of before) {
      expect(entryHashOf(body)).toBe(digest)
      expect(parse(body).success).toBe(true)
    }
  })

  it('pins the canonical hash of a launched, a passive and a Persona exhibit entry', () => {
    const pinned: Array<[Record<string, unknown>, string]> = [
      [LAUNCHED_CAPTURE_BODY, FROZEN_ENTRY_HASHES.captureLaunched],
      [PASSIVE_CAPTURE_BODY, FROZEN_ENTRY_HASHES.capturePassive],
      [PERSONA_EXHIBIT_BODY, FROZEN_ENTRY_HASHES.exhibitPersona]
    ]
    for (const [body, digest] of pinned) {
      expect(entryHashOf(body)).toBe(digest)
      expect(parse(body).success).toBe(true)
    }
  })

  it('is each frozen earlier body once the schema-7 values are taken off', () => {
    const launched = {
      ...omit(LAUNCHED_CAPTURE_BODY, ...NEW_CAPTURE_KEYS),
      inventory: ENGINE_INVENTORY,
      schemaVersion: 6
    }
    expect(entryHashOf(launched)).toBe(FROZEN_ENTRY_HASHES.captureEngine)
    const exhibit = { ...omit(PERSONA_EXHIBIT_BODY, 'personaId', 'personaLabel'), schemaVersion: 3 }
    expect(entryHashOf(exhibit)).toBe(FROZEN_ENTRY_HASHES.exhibit)
  })

  // The runbook's recipe run as VERIFY.md prints it, on the line as a writer
  // stores it: keys in writer order, with `entryHash` and `signature` present.
  it.skipIf(!HAS_JQ)('canonicalizes the same through the Verify Runbook jq -cS recipe', () => {
    for (const body of [LAUNCHED_CAPTURE_BODY, PASSIVE_CAPTURE_BODY, PERSONA_EXHIBIT_BODY]) {
      const line = JSON.stringify({ ...body, entryHash: 'f'.repeat(64), signature: 'sig' })
      const viaJq = execFileSync('/bin/sh', ['-c', VERIFY_RECIPES.canonicalEntryBody], {
        input: line,
        encoding: 'utf-8'
      })
      expect(viaJq).toBe(canonicalStringify(body))
    }
  })
})

describe('manifest schema 7 — the schema', () => {
  it('admits exactly the five Capture Methods', () => {
    expect(CAPTURE_METHODS).toEqual([
      'extension',
      'background',
      'duplicate',
      'launched',
      'launched-passive'
    ])
  })

  it('accepts each launched method at 7', () => {
    for (const method of ['launched', 'launched-passive']) {
      expect(parse({ ...SCHEMA_2_CAPTURE_BODY, method, schemaVersion: 7 }).success, method).toBe(
        true
      )
    }
  })

  it('refuses a method outside the list at 7, persona-window and companion included', () => {
    for (const method of ['persona-window', 'companion', 'Launched', 'launched-clicked', '']) {
      const result = parse({ ...LAUNCHED_CAPTURE_BODY, method })
      expect(result.success, method).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual(['method'])
    }
  })

  it('accepts each browser family, and Chrome for Testing apart from Chrome', () => {
    expect(BROWSER_FAMILIES).toEqual(['chrome', 'chrome-for-testing', 'edge', 'brave', 'chromium'])
    for (const browserFamily of BROWSER_FAMILIES) {
      expect(parse({ ...LAUNCHED_CAPTURE_BODY, browserFamily }).success, browserFamily).toBe(true)
    }
    for (const browserFamily of ['firefox', 'Chrome', 'opera', '']) {
      expect(parse({ ...LAUNCHED_CAPTURE_BODY, browserFamily }).success, browserFamily).toBe(false)
    }
  })

  it('refuses an empty product or version, and a version without its product', () => {
    expect(parse({ ...LAUNCHED_CAPTURE_BODY, browserProduct: '' }).success).toBe(false)
    expect(parse({ ...LAUNCHED_CAPTURE_BODY, browserVersion: '' }).success).toBe(false)
    expect(messages(omit(LAUNCHED_CAPTURE_BODY, 'browserProduct'))).toEqual([
      '`browserVersion` requires `browserProduct`'
    ])
    // A product with no version does not contradict itself (first-slice D2):
    // what Brave reports is still open question P.
    expect(parse(omit(LAUNCHED_CAPTURE_BODY, 'browserVersion')).success).toBe(true)
    // The family is what the engine launched, a fact apart from what the
    // browser reported, so it stands without them.
    const familyOnly = omit(LAUNCHED_CAPTURE_BODY, 'browserProduct', 'browserVersion')
    expect(parse(familyOnly).success).toBe(true)
  })

  it('accepts each passive rule, and no other', () => {
    expect(PASSIVE_CAPTURE_RULES).toEqual(['every-page', 'selector-match'])
    for (const passiveRule of PASSIVE_CAPTURE_RULES) {
      expect(parse({ ...PASSIVE_CAPTURE_BODY, passiveRule }).success, passiveRule).toBe(true)
    }
    for (const passiveRule of ['selector', 'all', 'url-pattern', '']) {
      expect(parse({ ...PASSIVE_CAPTURE_BODY, passiveRule }).success, passiveRule).toBe(false)
    }
  })

  it('refuses a passive rule unless the method is launched-passive or duplicate', () => {
    expect(parse({ ...PASSIVE_CAPTURE_BODY, method: 'duplicate' }).success).toBe(true)
    for (const method of ['launched', 'extension', 'background', undefined]) {
      expect(messages({ ...PASSIVE_CAPTURE_BODY, method }), String(method)).toEqual([
        '`passiveRule` requires method `launched-passive` or `duplicate`'
      ])
    }
  })

  it('accepts each schema-7 absence reason on the part a launched browser writes it for', () => {
    for (const reason of ['page-not-recorded', 'back-forward-cache']) {
      const body = withTransactionRecord(LAUNCHED_CAPTURE_BODY, { present: false, reason })
      expect(parse(body).success, reason).toBe(true)
    }
    expect(parse(PASSIVE_CAPTURE_BODY).success).toBe(true)
  })

  it('refuses a schema-7 absence reason on the other part', () => {
    const passiveOnRecord = withTransactionRecord(LAUNCHED_CAPTURE_BODY, {
      present: false,
      reason: 'not-taken-passive'
    })
    expect(parse(passiveOnRecord).success).toBe(false)
    for (const reason of ['page-not-recorded', 'back-forward-cache']) {
      const onPdf = withPdf(LAUNCHED_CAPTURE_BODY, { present: false, reason })
      expect(parse(onPdf).success, reason).toBe(false)
    }
  })

  it('refuses each reason the 2026-10-31 rulings dropped, and any other unknown reason', () => {
    const dropped = [
      'tab-not-visible',
      'loaded-speculatively',
      'served-by-service-worker',
      'request-body-withheld',
      'blocked'
    ]
    for (const reason of dropped) {
      const onRecord = withTransactionRecord(LAUNCHED_CAPTURE_BODY, { present: false, reason })
      expect(parse(onRecord).success, `transactionRecord ${reason}`).toBe(false)
      const onPdf = withPdf(LAUNCHED_CAPTURE_BODY, { present: false, reason })
      expect(parse(onPdf).success, `pdf ${reason}`).toBe(false)
    }
  })

  it('refuses a count that is not a non-negative integer, and a cache flag that is not true', () => {
    for (const key of ['servedByServiceWorker', 'requestBodiesWithheld']) {
      for (const value of [1.5, -1, '3', null]) {
        const body = withTransactionRecord(LAUNCHED_CAPTURE_BODY, {
          ...LAUNCHED_TRANSACTION_RECORD,
          [key]: value
        })
        expect(parse({ ...body, transactionRecordHash: 'd'.repeat(64) }).success, key).toBe(false)
      }
    }
    for (const httpCacheDisabled of [false, 'true', 1]) {
      const body = withTransactionRecord(LAUNCHED_CAPTURE_BODY, {
        ...LAUNCHED_TRANSACTION_RECORD,
        httpCacheDisabled
      })
      expect(parse({ ...body, transactionRecordHash: 'd'.repeat(64) }).success).toBe(false)
    }
  })

  it('refuses each new value or field under a stamp of 6, with a named error', () => {
    const recordAbsent = (reason: string) =>
      withTransactionRecord(SCHEMA_6_ENGINE_BODY, { present: false, reason })
    const pdfAbsent = (reason: string) => withPdf(SCHEMA_6_ENGINE_BODY, { present: false, reason })
    const recordWith = (member: Record<string, unknown>) => ({
      ...SCHEMA_6_ENGINE_BODY,
      inventory: {
        ...ENGINE_INVENTORY,
        transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, ...member }
      }
    })
    const launched: Array<[string, Record<string, unknown>]> = [
      ['launched', { ...SCHEMA_2_CAPTURE_BODY, method: 'launched' }],
      ['launched-passive', { ...SCHEMA_2_CAPTURE_BODY, method: 'launched-passive' }],
      ['every browser field', { ...SCHEMA_2_CAPTURE_BODY, ...LAUNCHED_BROWSER_FIELDS }],
      [
        'browser product and version',
        { ...SCHEMA_2_CAPTURE_BODY, ...omit(LAUNCHED_BROWSER_FIELDS, 'browserFamily') }
      ],
      ['browser product', { ...SCHEMA_2_CAPTURE_BODY, browserProduct: 'Chrome' }],
      ['browser family', { ...SCHEMA_2_CAPTURE_BODY, browserFamily: 'edge' }],
      ['every-page', { ...SCHEMA_2_CAPTURE_BODY, ...PASSIVE_METHOD, passiveRule: 'every-page' }],
      [
        'selector-match',
        { ...SCHEMA_2_CAPTURE_BODY, ...PASSIVE_METHOD, passiveRule: 'selector-match' }
      ],
      ['page-not-recorded', recordAbsent('page-not-recorded')],
      ['back-forward-cache', recordAbsent('back-forward-cache')],
      ['not-taken-passive', pdfAbsent('not-taken-passive')],
      ['servedByServiceWorker', recordWith({ servedByServiceWorker: 0 })],
      ['requestBodiesWithheld', recordWith({ requestBodiesWithheld: 0 })],
      ['httpCacheDisabled', recordWith({ httpCacheDisabled: true })]
    ]
    for (const [label, body] of launched) {
      expect(messages({ ...body, schemaVersion: 6 }), label).toEqual([LAUNCHED_MESSAGE])
      expect(parse({ ...body, schemaVersion: 7 }).success, label).toBe(true)
    }
    const persona: Array<[string, Record<string, unknown>]> = [
      ['capture personaId', { ...SCHEMA_2_CAPTURE_BODY, personaId: PERSONA_FIELDS.personaId }],
      ['capture both', { ...SCHEMA_2_CAPTURE_BODY, ...PERSONA_FIELDS }],
      ['exhibit personaId', { ...SCHEMA_3_EXHIBIT_BODY, personaId: PERSONA_FIELDS.personaId }],
      ['exhibit both', { ...SCHEMA_3_EXHIBIT_BODY, ...PERSONA_FIELDS }]
    ]
    for (const [label, body] of persona) {
      expect(messages({ ...body, schemaVersion: 6 }), label).toEqual([PERSONA_MESSAGE])
      expect(parse({ ...body, schemaVersion: 7 }).success, label).toBe(true)
    }
  })

  it('refuses a launched method under every stamp below 7', () => {
    for (const schemaVersion of [2, 3, 4, 5, 6]) {
      const body = { ...SCHEMA_2_CAPTURE_BODY, method: 'launched', schemaVersion }
      expect(messages(body), `${schemaVersion}`).toEqual([LAUNCHED_MESSAGE])
    }
  })

  it('keeps the schema-6 reasons and every first-slice shape valid at 6', () => {
    for (const reason of ['not-taken', 'failed']) {
      expect(parse(withPdf(SCHEMA_6_ENGINE_BODY, { present: false, reason })).success).toBe(true)
      const record = withTransactionRecord(SCHEMA_6_ENGINE_BODY, { present: false, reason })
      expect(parse(record).success).toBe(true)
    }
    for (const method of ['extension', 'background', 'duplicate']) {
      expect(parse({ ...SCHEMA_6_ENGINE_BODY, method }).success, method).toBe(true)
    }
  })

  it('refuses a Persona label without its id, with a named error', () => {
    const message = '`personaLabel` requires `personaId`'
    expect(messages(omit(LAUNCHED_CAPTURE_BODY, 'personaId'))).toEqual([message])
    expect(messages(omit(PERSONA_EXHIBIT_BODY, 'personaId'))).toEqual([message])
    expect(parse(omit(LAUNCHED_CAPTURE_BODY, 'personaLabel')).success).toBe(true)
    expect(parse(omit(PERSONA_EXHIBIT_BODY, 'personaLabel')).success).toBe(true)
    for (const key of ['personaId', 'personaLabel']) {
      expect(parse({ ...LAUNCHED_CAPTURE_BODY, [key]: '' }).success, key).toBe(false)
      expect(parse({ ...PERSONA_EXHIBIT_BODY, [key]: '' }).success, key).toBe(false)
    }
  })

  it('leaves the exhibit origin unchecked beside the Persona fields', () => {
    for (const origin of ['extension', 'background', 'extension-image', 'manual-upload', 'x']) {
      expect(parse({ ...PERSONA_EXHIBIT_BODY, origin }).success, origin).toBe(true)
    }
  })

  it('refuses the Persona fields on a derivation entry', () => {
    const derivation = {
      type: 'derivation',
      caseId: SCHEMA_3_EXHIBIT_BODY.caseId,
      parentExhibitId: SCHEMA_3_EXHIBIT_BODY.exhibitId,
      parentContentHash: SCHEMA_3_EXHIBIT_BODY.contentHash,
      derivation: 'pdf-metadata',
      derivationToolVersion: '0.4.0',
      outputHash: 'e'.repeat(64),
      outputPath: 'documents/derived.json',
      timestamp: '2026-06-01T12:06:00.000Z',
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      index: 0,
      prevHash: '',
      schemaVersion: 7
    }
    expect(parse(derivation).success).toBe(true)
    expect(parse({ ...derivation, ...PERSONA_FIELDS }).success).toBe(false)
  })

  it('refuses a transport, a Selector, or a seed-source key on the entry', () => {
    for (const key of ['transport', 'selectorId', 'selectorIds', 'selectorPattern', 'seedSource']) {
      expect(parse({ ...LAUNCHED_CAPTURE_BODY, [key]: 'x' }).success, key).toBe(false)
    }
  })

  it('reports a signed chain holding an unknown method or reason at 7 as broken there', () => {
    const unknownMethod = { ...LAUNCHED_CAPTURE_BODY, method: 'companion' }
    const unknownReason = withPdf(PASSIVE_CAPTURE_BODY, {
      present: false,
      reason: 'tab-not-visible'
    })
    for (const body of [unknownMethod, unknownReason]) {
      const result = verify(buildSignedChain([SCHEMA_2_CAPTURE_BODY, body]))
      expect(result.valid).toBe(false)
      expect(result.unsupported).toBeUndefined()
      expect(result.brokenAt).toBe(1)
      expect(result.reason).toBe('Invalid entry shape')
    }
  })
})

describe('manifest schema 7 — the app verifier', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema7-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const OPERATOR = { operatorId: 'op-1', operatorName: 'Casey Operator', toolVersion: '0.4.0' }

  const capture = (fields: Record<string, unknown> = {}) =>
    ({
      type: 'capture',
      captureId: 'cap',
      caseId: SCHEMA_2_CAPTURE_BODY.caseId,
      url: 'https://example.com/page',
      timestamp: '2026-10-31T12:00:00.000Z',
      contentHash: 'a'.repeat(64),
      screenshotHash: 'b'.repeat(64),
      sizeBytes: 10,
      ...OPERATOR,
      ...fields
    }) as ManifestEntryInput

  const exhibit = (fields: Record<string, unknown> = {}) =>
    ({
      type: 'exhibit',
      exhibitId: 'exh',
      caseId: SCHEMA_3_EXHIBIT_BODY.caseId,
      kind: 'image',
      origin: 'extension-image',
      name: 'photo.png',
      exhibitNumber: 1,
      path: 'images/exh.png',
      contentHash: 'd'.repeat(64),
      sizeBytes: 20,
      timestamp: '2026-10-31T12:00:00.000Z',
      ...OPERATOR,
      ...fields
    }) as ManifestEntryInput

  const stamps = (): number[] =>
    readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { schemaVersion: number }).schemaVersion)

  const inventoryWith = (part: Record<string, unknown>) => ({
    inventory: { ...ENGINE_INVENTORY, pdf: { present: false, reason: 'not-taken' }, ...part }
  })

  it('verifies the frozen entries in a signed chain', () => {
    const chain = buildSignedChain([
      SCHEMA_2_CAPTURE_BODY,
      LAUNCHED_CAPTURE_BODY,
      PASSIVE_CAPTURE_BODY,
      PERSONA_EXHIBIT_BODY
    ])
    const result = verify(chain)
    expect(result.reason).toBeUndefined()
    expect(result.valid).toBe(true)
  })

  it('stamps 7 on an entry carrying any one schema-7 value, and verifies each', () => {
    const recordAbsent = (reason: string) =>
      inventoryWith({ transactionRecord: { present: false, reason } })
    const carrying: Array<[string, ManifestEntryInput]> = [
      ['launched', capture({ method: 'launched' })],
      ['launched-passive', capture({ method: 'launched-passive' })],
      ['browser product and version', capture(omit(LAUNCHED_BROWSER_FIELDS, 'browserFamily'))],
      ['browser product', capture({ browserProduct: 'Chrome' })],
      ['browser family', capture({ browserFamily: 'brave' })],
      ['passive rule', capture({ ...PASSIVE_METHOD, passiveRule: 'every-page' })],
      ['page-not-recorded', capture(recordAbsent('page-not-recorded'))],
      ['back-forward-cache', capture(recordAbsent('back-forward-cache'))],
      [
        'not-taken-passive',
        capture(
          inventoryWith({
            transactionRecord: { present: false, reason: 'not-taken' },
            pdf: { present: false, reason: 'not-taken-passive' }
          })
        )
      ],
      [
        'servedByServiceWorker',
        capture({
          ...inventoryWith({
            transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, servedByServiceWorker: 2 }
          }),
          transactionRecordHash: 'd'.repeat(64)
        })
      ],
      [
        'requestBodiesWithheld',
        capture({
          ...inventoryWith({
            transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, requestBodiesWithheld: 0 }
          }),
          transactionRecordHash: 'd'.repeat(64)
        })
      ],
      [
        'httpCacheDisabled',
        capture({
          ...inventoryWith({
            transactionRecord: { ...ENGINE_INVENTORY.transactionRecord, httpCacheDisabled: true }
          }),
          transactionRecordHash: 'd'.repeat(64)
        })
      ],
      ['capture personaId', capture({ personaId: PERSONA_FIELDS.personaId })],
      ['capture Persona', capture(PERSONA_FIELDS)],
      ['exhibit Persona', exhibit(PERSONA_FIELDS)],
      // Over every lower field stamp.
      [
        'over the others',
        capture({
          method: 'launched',
          exhibitNumber: 2,
          egressKind: 'tor',
          linkedFromCaptureId: 'src',
          linkedFromContentHash: '5'.repeat(64),
          linkHref: 'http://example.com/',
          boundTlsAbsent: 'not-recorded'
        })
      ],
      ['exhibit over memberCode', exhibit({ ...PERSONA_FIELDS, memberCode: 'AB' })]
    ]
    for (const [, entry] of carrying) appendManifestEntry(caseDir, entry)
    expect(stamps()).toEqual(carrying.map(() => 7))
    const result = verifyManifestChain(caseDir)
    expect(result.reason).toBeUndefined()
    expect(result.valid).toBe(true)
  })

  it('stamps what it stamps today on an entry carrying no schema-7 value', () => {
    const today: Array<[ManifestEntryInput, number]> = [
      [capture(), 2],
      [capture({ method: 'background' }), 2],
      [capture({ method: 'extension', exhibitNumber: 3 }), 3],
      [capture({ egressKind: 'proxy' }), 5],
      [capture({ method: 'duplicate', boundTlsAbsent: 'not-https' }), 6],
      [capture(inventoryWith({ transactionRecord: { present: false, reason: 'failed' } })), 6],
      [exhibit(), 3],
      [exhibit({ memberCode: 'AB' }), 4]
    ]
    for (const [entry] of today) appendManifestEntry(caseDir, entry)
    expect(stamps()).toEqual(today.map(([, stamp]) => stamp))
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('carries the browser, passive rule and Persona fields in its result, and no key without them', () => {
    appendManifestEntry(caseDir, capture())
    appendManifestEntry(
      caseDir,
      capture({
        method: 'launched-passive',
        passiveRule: 'every-page',
        ...LAUNCHED_BROWSER_FIELDS,
        ...PERSONA_FIELDS
      })
    )
    const result = verifyManifestChain(caseDir)
    expect(result.valid).toBe(true)
    expect(result.captureEntriesByIndex.get(1)).toEqual({
      contentHash: 'a'.repeat(64),
      screenshotHash: 'b'.repeat(64),
      textHash: undefined,
      passiveRule: 'every-page',
      ...LAUNCHED_BROWSER_FIELDS,
      ...PERSONA_FIELDS
    })
    const plain = Object.keys(result.captureEntriesByIndex.get(0) ?? {})
    for (const key of NEW_CAPTURE_KEYS) expect(plain).not.toContain(key)
  })
})

describe('manifest schema 7 — the package verifier and verify.sh', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema7-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const chainRow = (result: ReturnType<typeof verifyEvidencePackage>) =>
    result.checks.find((check) => check.name === 'manifest chain')

  const packages: Array<[string, Record<string, unknown>]> = [
    ['a launched entry carrying every field', launchedFields()],
    ...PASSIVE_CAPTURE_RULES.map((rule): [string, Record<string, unknown>] => [
      `a launched-passive entry taken by ${rule}`,
      passiveFields(rule)
    ]),
    ...['page-not-recorded', 'back-forward-cache'].map(
      (reason): [string, Record<string, unknown>] => [
        `a launched entry whose Transaction Record is absent for ${reason}`,
        launchedFields({
          inventory: { ...LAUNCHED_INVENTORY, transactionRecord: { present: false, reason } },
          transactionRecordHash: undefined,
          boundTls: undefined,
          boundTlsAbsent: 'not-recorded'
        })
      ]
    ),
    ['a background entry carrying only the Persona fields', PERSONA_FIELDS]
  ]

  for (const [label, fields] of packages) {
    it(`passes a package holding ${label}`, () => {
      writeEnginePackage(pkgDir, fields, 7)
      const result = verifyEvidencePackage(pkgDir)
      expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
      expect(result.pass).toBe(true)
      expect(chainRow(result)?.status).toBe('pass')
    })
  }

  it('fails the chain of a package whose entry names an unknown method at 7', () => {
    writeEnginePackage(pkgDir, launchedFields({ method: 'companion' }), 7)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(chainRow(result)?.status).toBe('fail')
  })

  it.skipIf(!HAS_JQ || !HAS_OPENSSL)('passes verify.sh and Package Verification alike', () => {
    for (const fields of [launchedFields(), passiveFields('every-page')]) {
      rmSync(pkgDir, { recursive: true, force: true })
      pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema7-pkg-'))
      writeEnginePackage(pkgDir, fields, 7, { indexArtifacts: true })
      writeFileSync(join(pkgDir, PACKAGE_ROOT_FILES.verifyScript), VERIFY_SCRIPT, 'utf-8')
      const result = checkConformance(pkgDir)
      expect({ binary: result.binary, script: result.script }, result.scriptOutput).toEqual({
        binary: 'pass',
        script: 'pass'
      })
    }
  })
})
