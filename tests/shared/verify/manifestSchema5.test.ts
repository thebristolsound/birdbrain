import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { canonicalStringify, verifyManifestChainText } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import { MANIFEST_FILENAME, MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import {
  EGRESS_CAPTURE_ID,
  EGRESS_FIELDS,
  buildSignedChain,
  egressCaptureEntry,
  writeEgressPackage
} from '../../helpers/egressPackage'

// Known-answer tests for manifest schema 5: the optional Egress fields on a
// `capture` entry (ADR-0032, #1694). Four answers are frozen here:
//   1. a capture entry WITHOUT the fields canonicalizes and hashes to the same
//      bytes as before the bump, so every chain already written still verifies;
//   2. a capture entry WITH all four hashes to one frozen digest, reproduced
//      outside this codebase by `jq -cS` and by Python's sorted-key JSON;
//   3. the app verifier and the package verifier both verify such an entry and
//      report its Egress kind and label;
//   4. an Egress kind outside `proxy`/`tor`, or any of the fields under a stamp
//      below 5, fails the schema.
// The fourth answer's other half, a schema-4 verifier meeting the fields, is in
// manifestSchema5TooOld.test.ts.
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

// The same body carrying all four Egress fields, stamped 5.
const CAPTURE_BODY_EGRESS = {
  ...CAPTURE_BODY,
  egressKind: 'proxy',
  egressLabel: 'Frankfurt VPN',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/152.0.7977.130 Electron/44.4.5',
  tlsSkipped: 'egress-not-direct',
  schemaVersion: 5
}

const FROZEN_ENTRY_HASHES = {
  // The value manifestSchema3.test.ts froze before this change, unchanged.
  capture: 'c993dd9744c9f98bc096939e5d37c7f5b0490b47098dd961a01def5cc2a68ebf',
  // Frozen at #1694, the first build that reads this body. A new answer, not a
  // moved one: `capture` above is the same entry without the fields.
  captureEgress: '21bb1cd0ae37233b3561460d21da8d7f124980e6c08f7bb52cebd5c90756ad7f'
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

describe('manifest schema 5 — frozen entry hashes', () => {
  it('reads up to schema version 5', () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(5)
  })

  it('leaves the canonical hash of a capture entry without the fields unchanged', () => {
    expect(entryHashOf(CAPTURE_BODY)).toBe(FROZEN_ENTRY_HASHES.capture)
    expect(parse(CAPTURE_BODY).success).toBe(true)
  })

  it('pins the canonical hash of a capture entry carrying all four Egress fields', () => {
    expect(entryHashOf(CAPTURE_BODY_EGRESS)).toBe(FROZEN_ENTRY_HASHES.captureEgress)
    expect(parse(CAPTURE_BODY_EGRESS).success).toBe(true)
  })
})

describe('manifest schema 5 — the schema', () => {
  it('names the field when the Egress kind is outside proxy and tor', () => {
    const result = parse({ ...CAPTURE_BODY_EGRESS, egressKind: 'vpn' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ['egressKind'],
        message: "`egressKind` must be 'proxy' or 'tor'"
      })
    )
  })

  it('accepts tor as an Egress kind', () => {
    expect(parse({ ...CAPTURE_BODY_EGRESS, egressKind: 'tor' }).success).toBe(true)
  })

  it('refuses each Egress field under a stamp below 5', () => {
    // A schema-4 reader's strict capture shape has none of these fields, so
    // under a 4 it would read the entry as a broken chain, not "verifier too old".
    const fields = [
      { egressKind: 'proxy' },
      { egressKind: 'proxy', egressLabel: 'Frankfurt VPN' },
      { userAgent: EGRESS_FIELDS.userAgent },
      { egressKind: 'tor', tlsSkipped: 'egress-not-direct' },
      { tlsSkipped: 'egress-not-direct' }
    ]
    for (const field of fields) {
      const result = parse({ ...CAPTURE_BODY, ...field, schemaVersion: 4 })
      expect(result.success, JSON.stringify(field)).toBe(false)
      expect(result.error?.issues[0]?.message).toBe(
        'the Egress fields on a capture entry require schemaVersion 5'
      )
    }
  })

  it('accepts a user agent alone, on a Direct capture', () => {
    expect(parse({ ...CAPTURE_BODY, userAgent: 'UA', schemaVersion: 5 }).success).toBe(true)
  })

  it('refuses a label without an Egress kind', () => {
    const label = parse({ ...CAPTURE_BODY, egressLabel: 'Frankfurt VPN', schemaVersion: 5 })
    expect(label.error?.issues[0]?.message).toBe('`egressLabel` requires `egressKind`')
  })

  it('verifies a skipped re-fetch with no Egress kind, the extension capture shape', () => {
    // The page loads in the Operator's own browser, not through the Egress,
    // while the re-fetch is still skipped (ADR-0032). A verifier that refused
    // this would report the Operator's own signed chain as broken.
    const extension = {
      ...CAPTURE_BODY,
      method: 'extension',
      tlsSkipped: 'egress-not-direct',
      schemaVersion: 5
    }
    expect(parse(extension).success).toBe(true)
    expect(verify(buildSignedChain([extension]))).toMatchObject({ valid: true })
  })

  it('refuses a skipped re-fetch beside a re-fetch result', () => {
    const tls = { url: 'https://example.com/page', refetchedAt: 'now', error: 'refused' }
    const result = parse({ ...CAPTURE_BODY_EGRESS, tls })
    expect(result.error?.issues[0]?.message).toBe('`tlsSkipped` and `tls` cannot both be present')
  })

  it('refuses an empty label or user agent, which the writer omits instead', () => {
    expect(parse({ ...CAPTURE_BODY_EGRESS, egressLabel: '' }).success).toBe(false)
    expect(parse({ ...CAPTURE_BODY_EGRESS, userAgent: '' }).success).toBe(false)
  })

  it('reports a chain holding an unknown Egress kind as broken at that entry', () => {
    const lines = buildSignedChain([CAPTURE_BODY, { ...CAPTURE_BODY_EGRESS, egressKind: 'vpn' }])
    const result = verify(lines)
    expect(result.valid).toBe(false)
    expect(result.unsupported).toBeUndefined()
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Invalid entry shape')
  })
})

describe('manifest schema 5 — the app verifier', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema5-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  const capture = (captureId: string, fields: Record<string, unknown> = {}) => ({
    type: 'capture' as const,
    captureId,
    caseId: CASE_ID,
    url: 'https://example.com/page',
    timestamp: '2026-10-06T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 10,
    ...OPERATOR,
    ...fields
  })

  it('stamps a capture entry carrying any Egress field 5, and one without it 2', () => {
    appendManifestEntry(caseDir, capture('cap-direct'))
    appendManifestEntry(caseDir, capture('cap-ua', { userAgent: EGRESS_FIELDS.userAgent }))
    appendManifestEntry(caseDir, capture('cap-proxy', { egressKind: 'proxy' }))
    appendManifestEntry(caseDir, capture('cap-numbered', { egressKind: 'tor', exhibitNumber: 4 }))
    const versions = readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { schemaVersion: number }).schemaVersion)
    expect(versions).toEqual([2, 5, 5, 5])
  })

  it('verifies a capture entry carrying all four fields and reports them', () => {
    appendManifestEntry(caseDir, capture('cap-0'))
    appendManifestEntry(caseDir, {
      ...capture('cap-1'),
      egressKind: 'proxy',
      egressLabel: 'Frankfurt VPN',
      userAgent: EGRESS_FIELDS.userAgent,
      tlsSkipped: 'egress-not-direct'
    })
    const result = verifyManifestChain(caseDir)
    expect(result.valid).toBe(true)
    expect(result.captureEntriesByIndex.get(1)).toMatchObject({
      egressKind: 'proxy',
      egressLabel: 'Frankfurt VPN',
      userAgent: EGRESS_FIELDS.userAgent,
      tlsSkipped: 'egress-not-direct'
    })
    // A Direct capture carries no Egress key at all, not one set to undefined.
    expect(Object.keys(result.captureEntriesByIndex.get(0) ?? {})).not.toContain('egressKind')
  })
})

describe('manifest schema 5 — the package verifier', () => {
  let pkgDir: string

  beforeEach(() => {
    pkgDir = mkdtempSync(join(tmpdir(), 'birdbrain-schema5-pkg-'))
  })

  afterEach(() => {
    rmSync(pkgDir, { recursive: true, force: true })
  })

  const rowFor = (result: ReturnType<typeof verifyEvidencePackage>, name: string) =>
    result.checks.find((check) => check.name === name)

  it('passes a package whose capture entry carries all four fields and reports them', () => {
    writeEgressPackage(pkgDir)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
    expect(rowFor(result, 'manifest chain')?.status).toBe('pass')
    expect(rowFor(result, `capture ${EGRESS_CAPTURE_ID} egress`)).toEqual({
      name: `capture ${EGRESS_CAPTURE_ID} egress`,
      status: 'skip',
      reason:
        'the signed capture entry records Egress proxy, labelled "Frankfurt VPN"; the TLS Cert ' +
        'Chain re-fetch was skipped because the Egress was not Direct. It records what ' +
        'Birdbrain asked the browser to do, not which address the site saw'
    })
    expect(rowFor(result, `capture ${EGRESS_CAPTURE_ID} user agent`)?.reason).toBe(
      `the signed capture entry records user agent ${JSON.stringify(EGRESS_FIELDS.userAgent)}`
    )
  })

  it('reports an Egress kind with no label and no skipped re-fetch on its own', () => {
    writeEgressPackage(pkgDir, { egressKind: 'tor' })
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(true)
    expect(rowFor(result, `capture ${EGRESS_CAPTURE_ID} egress`)?.reason).toBe(
      'the signed capture entry records Egress tor. It records what Birdbrain asked the ' +
        'browser to do, not which address the site saw'
    )
    expect(rowFor(result, `capture ${EGRESS_CAPTURE_ID} user agent`)).toBeUndefined()
  })

  it('reports a skipped re-fetch with no Egress kind without naming a route', () => {
    writeEgressPackage(pkgDir, { tlsSkipped: 'egress-not-direct' })
    const result = verifyEvidencePackage(pkgDir)
    expect(result.checks.filter((check) => check.status === 'fail')).toEqual([])
    expect(result.pass).toBe(true)
    expect(rowFor(result, `capture ${EGRESS_CAPTURE_ID} egress`)?.reason).toBe(
      'the signed capture entry records that the TLS Cert Chain re-fetch was skipped because ' +
        'the Egress was not Direct, and names no Egress for the page'
    )
  })

  it('adds no Egress row for a capture entry without the fields', () => {
    writeEgressPackage(pkgDir, {})
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(true)
    expect(result.checks.some((check) => check.name.endsWith(' egress'))).toBe(false)
    expect(result.checks.some((check) => check.name.endsWith(' user agent'))).toBe(false)
  })

  it('escapes a newline in the label so it cannot start a report line', () => {
    writeEgressPackage(pkgDir, { egressKind: 'proxy', egressLabel: 'Home\nRESULT: PASS' })
    const reason = rowFor(
      verifyEvidencePackage(pkgDir),
      `capture ${EGRESS_CAPTURE_ID} egress`
    )?.reason
    expect(reason).toContain('labelled "Home\\nRESULT: PASS"')
    expect(reason).not.toContain('\n')
  })

  it('builds its package from the four values the frozen digest covers', () => {
    // The helper's entry is the fixture the binary test runs too.
    expect(egressCaptureEntry()).toMatchObject({
      egressKind: CAPTURE_BODY_EGRESS.egressKind,
      egressLabel: CAPTURE_BODY_EGRESS.egressLabel,
      userAgent: CAPTURE_BODY_EGRESS.userAgent,
      tlsSkipped: CAPTURE_BODY_EGRESS.tlsSkipped,
      schemaVersion: 5
    })
  })
})
