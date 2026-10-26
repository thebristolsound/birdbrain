import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { VERIFY_RECIPES } from '@main/services/verifyProcedure'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_FILENAME } from '@shared/constants'
import { HAS_JQ } from '../../helpers/jq'
import { buildSignedChain } from '../../helpers/egressPackage'
import { engineFields, writeEnginePackage } from '../../helpers/captureEnginePackage'
import { LINK_CAPTURE_BODY, LINK_FIELDS } from '../../helpers/linkProvenance'

// Known-answer tests for the link provenance fields on a schema-6 `capture`
// entry (ADR-0040): `linkedFromCaptureId`, `linkedFromContentHash` and
// `linkHref`. The answers frozen here:
//   1. a capture entry carrying the three fields hashes to one frozen digest,
//      the same entry without them is the schema-2 body manifestSchema3.test.ts
//      froze, and its canonical body is the same through canonicalStringify and
//      through the Verify Runbook's `jq -cS` recipe;
//   2. the schema refuses the fields under a stamp below 6, and refuses every
//      partial set with one named error;
//   3. the app verifier and the package verifier verify such an entry.
// A schema-5 verifier meeting the fields is in manifestSchema6TooOld.test.ts.
//
// If the frozen digest fails, the canonical body of a capture entry changed and
// every chain already written with it is now unverifiable: that is the finding,
// not the test.

const FROZEN_ENTRY_HASHES = {
  // manifestSchema3.test.ts froze this value before this change.
  capture: 'c993dd9744c9f98bc096939e5d37c7f5b0490b47098dd961a01def5cc2a68ebf',
  // Frozen at #1976, the first build that reads this body, and reproduced
  // outside this codebase by `jq -cS` and by Python's sorted-key JSON.
  captureLink: '09e6d206243446dcc93c93cd1e484b2d1dc8a9dc9d9ab09d40e5c10cad9bd2f1'
}

const VERSION_MESSAGE = 'the link provenance fields on a capture entry require schemaVersion 6'
const SET_MESSAGE =
  '`linkedFromCaptureId`, `linkedFromContentHash` and `linkHref` must be present together'

const LINK_KEYS = Object.keys(LINK_FIELDS) as Array<keyof typeof LINK_FIELDS>

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

function messages(body: Record<string, unknown>): string[] {
  return parse(body).error?.issues.map((issue) => issue.message) ?? []
}

function verify(lines: string[]) {
  return verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })
}

describe('link provenance at schema 6 — frozen entry hash', () => {
  it('pins the canonical hash of a capture entry carrying the three fields', () => {
    expect(entryHashOf(LINK_CAPTURE_BODY)).toBe(FROZEN_ENTRY_HASHES.captureLink)
    expect(parse(LINK_CAPTURE_BODY).success).toBe(true)
  })

  it('is the frozen schema-2 body once the fields and the stamp of 6 are taken off', () => {
    const plain = { ...omit(LINK_CAPTURE_BODY, ...LINK_KEYS), schemaVersion: 2 }
    expect(entryHashOf(plain)).toBe(FROZEN_ENTRY_HASHES.capture)
  })

  // The runbook's recipe run as VERIFY.md prints it, on the line as a writer
  // stores it: keys in writer order, with `entryHash` and `signature` present.
  it.skipIf(!HAS_JQ)('canonicalizes the same through the Verify Runbook jq -cS recipe', () => {
    const line = JSON.stringify({ ...LINK_CAPTURE_BODY, entryHash: 'f'.repeat(64), signature: 's' })
    const viaJq = execFileSync('/bin/sh', ['-c', VERIFY_RECIPES.canonicalEntryBody], {
      input: line,
      encoding: 'utf-8'
    })
    expect(viaJq).toBe(canonicalStringify(LINK_CAPTURE_BODY))
  })
})

describe('link provenance at schema 6 — the schema', () => {
  it('refuses the three fields under a stamp below 6, with a named error', () => {
    for (const schemaVersion of [2, 3, 4, 5]) {
      expect(messages({ ...LINK_CAPTURE_BODY, schemaVersion }), `${schemaVersion}`).toEqual([
        VERSION_MESSAGE
      ])
    }
  })

  it('refuses each partial set, with a named error', () => {
    const partials = [
      ['linkedFromCaptureId'],
      ['linkedFromContentHash'],
      ['linkHref'],
      ['linkedFromCaptureId', 'linkedFromContentHash'],
      ['linkedFromCaptureId', 'linkHref'],
      ['linkedFromContentHash', 'linkHref']
    ]
    for (const kept of partials) {
      const dropped = LINK_KEYS.filter((key) => !kept.includes(key))
      expect(messages(omit(LINK_CAPTURE_BODY, ...dropped)), kept.join(' + ')).toEqual([SET_MESSAGE])
    }
  })

  it('refuses an empty id or address, and a Content Hash that is not lower-case sha256 hex', () => {
    const refused: Array<[string, string]> = [
      ['linkedFromCaptureId', ''],
      ['linkHref', ''],
      ['linkedFromContentHash', '5'.repeat(63)],
      ['linkedFromContentHash', 'A'.repeat(64)]
    ]
    for (const [key, value] of refused) {
      const result = parse({ ...LINK_CAPTURE_BODY, [key]: value })
      expect(result.success, `${key} = '${value}'`).toBe(false)
      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual([key])
    }
  })

  it('accepts the fields beside the capture engine fields', () => {
    expect(parse({ ...LINK_CAPTURE_BODY, ...engineFields() }).success).toBe(true)
  })

  it('reports a signed chain holding a partial set as broken at that entry', () => {
    const plain = { ...omit(LINK_CAPTURE_BODY, ...LINK_KEYS), schemaVersion: 2 }
    const partial = omit(LINK_CAPTURE_BODY, 'linkHref')
    const result = verify(buildSignedChain([plain, partial]))
    expect(result.valid).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid entry shape')
  })
})

describe('link provenance at schema 6 — the app verifier', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-link-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const capture = (captureId: string) => ({
    type: 'capture' as const,
    captureId,
    caseId: LINK_CAPTURE_BODY.caseId,
    url: LINK_CAPTURE_BODY.url,
    timestamp: '2026-10-26T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    method: 'background' as const,
    sizeBytes: 10,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0'
  })

  const stamps = (): number[] =>
    readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { schemaVersion: number }).schemaVersion)

  it('verifies the frozen entry in a signed chain', () => {
    expect(verify(buildSignedChain([LINK_CAPTURE_BODY])).valid).toBe(true)
  })

  it('stamps an entry carrying the fields 6, over the Egress and Exhibit stamps', () => {
    appendManifestEntry(caseDir, capture('cap-0'))
    appendManifestEntry(caseDir, { ...capture('cap-1'), ...LINK_FIELDS })
    appendManifestEntry(caseDir, {
      ...capture('cap-2'),
      ...LINK_FIELDS,
      egressKind: 'tor',
      exhibitNumber: 3
    })
    expect(stamps()).toEqual([2, 6, 6])
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('carries the fields in its result, and no key for an entry without them', () => {
    appendManifestEntry(caseDir, capture('cap-0'))
    appendManifestEntry(caseDir, { ...capture('cap-1'), ...LINK_FIELDS })
    const result = verifyManifestChain(caseDir)
    expect(result.valid).toBe(true)
    expect(result.captureEntriesByIndex.get(1)).toEqual({
      contentHash: 'a'.repeat(64),
      screenshotHash: undefined,
      textHash: undefined,
      ...LINK_FIELDS
    })
    const plain = Object.keys(result.captureEntriesByIndex.get(0) ?? {})
    for (const key of LINK_KEYS) expect(plain).not.toContain(key)
  })
})

describe('link provenance at schema 6 — the package verifier', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema6-link-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const chainRow = (result: ReturnType<typeof verifyEvidencePackage>) =>
    result.checks.find((check) => check.name === 'manifest chain')

  it('passes a package whose capture entry carries the three fields', () => {
    writeEnginePackage(pkgDir, LINK_FIELDS)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
    expect(chainRow(result)?.status).toBe('pass')
  })

  it('passes the same package with the capture engine fields beside them', () => {
    writeEnginePackage(pkgDir, { ...engineFields(), ...LINK_FIELDS })
    expect(verifyEvidencePackage(pkgDir).pass).toBe(true)
  })

  it('fails the chain of a package whose capture entry carries a partial set', () => {
    writeEnginePackage(pkgDir, omit(LINK_FIELDS, 'linkedFromContentHash'))
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(chainRow(result)?.status).toBe('fail')
  })
})
