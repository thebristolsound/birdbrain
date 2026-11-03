import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, appendManifestEntry, verifyManifestChain } from '@main/services/manifest'
import { getPublicKeyPem } from '@main/services/signingKey'
import { VERIFY_RECIPES } from '@main/services/verifyProcedure'
import { verifyManifestChainText, canonicalStringify } from '@shared/verify'
import { MANIFEST_FILENAME } from '@shared/constants'
import { buildSignedChain } from '../../helpers/egressPackage'
import { HAS_JQ } from '../../helpers/jq'

// PR1 guard (#122): the app's verifyManifestChain(caseDir) is a thin fs
// wrapper over the shared core's verifyManifestChainText. These tests pin the
// agreement on the SAME fixture chain — valid and tampered — so any future
// divergence between the app path and the core (the drift the extraction
// exists to prevent) fails loudly.

function makeCaptureEntry(n: number, over: { screenshotHash?: string; textHash?: string } = {}) {
  return {
    type: 'capture' as const,
    captureId: `cap-${n}`,
    caseId: 'case-1',
    url: `https://example.com/${n}`,
    timestamp: '2026-06-01T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    sizeBytes: 1000 + n,
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    ...over
  }
}

describe('verifyManifestChain (app) vs verifyManifestChainText (core)', () => {
  let caseDir: string
  let manifestPath: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-verify-core-'))
    manifestPath = join(caseDir, MANIFEST_FILENAME)
    initManifest(caseDir)
    appendManifestEntry(caseDir, makeCaptureEntry(0))
    appendManifestEntry(
      caseDir,
      makeCaptureEntry(1, { screenshotHash: 'b'.repeat(64), textHash: 'c'.repeat(64) })
    )
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: 'cap-0',
      caseId: 'case-1',
      timestamp: '2026-06-01T13:00:00.000Z',
      contentHash: 'a'.repeat(64),
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      reason: 'duplicate'
    })
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId: 'case-1',
      captureContentHash: 'a'.repeat(64),
      timestamp: '2026-06-01T14:00:00.000Z',
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0'
    })
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  function coreResult() {
    return verifyManifestChainText(readFileSync(manifestPath, 'utf-8'), {
      publicKeyPem: getPublicKeyPem()
    })
  }

  it('agree on a valid mixed-entry chain', () => {
    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app.valid).toBe(true)
    expect(core).toEqual(app)
  })

  it('resolves the real trusted-time axis (no hardcoded none)', () => {
    // The fixture's surviving capture (cap-1) is a v2 capture with a timestamp
    // entry that carries NO tsaToken → eligible-but-unstamped → pending.
    const core = coreResult()
    expect(core.valid).toBe(true)
    expect(core.trustedTimes.get('a'.repeat(64))?.trustedTime).toBe('pending')
    // The app wrapper resolves the same axis from the same bytes.
    expect(verifyManifestChain(caseDir).trustedTimes.get('a'.repeat(64))?.trustedTime).toBe(
      'pending'
    )
  })

  it('agree on a tampered entry body (Entry hash mismatch)', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    lines[1] = lines[1].replace('https://example.com/1', 'https://evil.example.com/1')
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 1,
      reason: 'Entry hash mismatch',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on a stripped v2 signature (Invalid signature)', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    const entry = JSON.parse(lines[2]) as Record<string, unknown>
    delete entry.signature
    lines[2] = JSON.stringify(entry)
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 2,
      reason: 'Invalid signature',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on a broken chain link', () => {
    const lines = readFileSync(manifestPath, 'utf-8').split('\n')
    const entry = JSON.parse(lines[3]) as Record<string, unknown>
    entry.prevHash = 'f'.repeat(64)
    lines[3] = JSON.stringify(entry)
    writeFileSync(manifestPath, lines.join('\n'), 'utf-8')

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app).toEqual({
      valid: false,
      brokenAt: 3,
      reason: 'Chain link broken',
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    })
    expect(core).toEqual(app)
  })

  it('agree on an empty manifest', () => {
    writeFileSync(manifestPath, '', 'utf-8')
    expect(verifyManifestChain(caseDir)).toEqual({
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    })
    expect(verifyManifestChainText('', { publicKeyPem: getPublicKeyPem() })).toEqual({
      valid: true,
      trustedTimes: new Map(),
      captureHashesByIndex: new Map(),
      captureEntriesByIndex: new Map()
    })
  })

  it('exposes each verified capture entry hash keyed by its manifest index', () => {
    const core = coreResult()
    expect(core.valid).toBe(true)
    // The fixture appends captures at index 0 and 1 (deletion at 2, timestamp at 3).
    expect(core.captureHashesByIndex.get(0)).toBe('a'.repeat(64))
    expect(core.captureHashesByIndex.get(1)).toBe('a'.repeat(64))
    expect(core.captureHashesByIndex.has(2)).toBe(false)
    expect(core.captureHashesByIndex.has(3)).toBe(false)
  })

  // #234: sidecar binding (verifySidecars, resolveTextAnchor) reads the
  // screenshot/text digests from HERE, not from the captures DB mirror.
  it('exposes the full capture entry -- including screenshot/text digests -- keyed by manifest index', () => {
    const core = coreResult()
    expect(core.valid).toBe(true)
    expect(core.captureEntriesByIndex.get(0)).toEqual({ contentHash: 'a'.repeat(64) })
    expect(core.captureEntriesByIndex.get(1)).toEqual({
      contentHash: 'a'.repeat(64),
      screenshotHash: 'b'.repeat(64),
      textHash: 'c'.repeat(64)
    })
    expect(core.captureEntriesByIndex.has(2)).toBe(false)
    expect(core.captureEntriesByIndex.has(3)).toBe(false)
  })

  // #398: the export entry's optional scope fields. A scoped entry must chain
  // and verify like any other; a case-scoped (unscoped) entry must not write
  // the keys at all — present-means-selection is what keeps case-scoped
  // entries byte-identical to pre-scope ones, so a chain mixing both shapes is
  // the exact state every upgraded installation will hold.
  it('verifies a chain mixing scoped and unscoped export entries, writing scope keys only when scoped', () => {
    const exportBase = {
      type: 'export' as const,
      caseId: 'case-1',
      timestamp: '2026-08-24T12:00:00.000Z',
      operatorId: 'op-1',
      operatorName: 'Casey Operator',
      toolVersion: '0.4.0',
      packageHash: 'd'.repeat(64),
      verificationResult: {
        overallValid: true,
        captureCount: 1,
        verifiedCount: 1,
        tamperedCount: 0,
        missingCount: 0
      }
    }
    appendManifestEntry(caseDir, exportBase)
    appendManifestEntry(caseDir, { ...exportBase, scope: 'selection', captureIds: ['cap-1'] })

    const app = verifyManifestChain(caseDir)
    const core = coreResult()
    expect(app.valid).toBe(true)
    expect(core).toEqual(app)

    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const unscopedLine = lines.at(-2)!
    const scopedLine = lines.at(-1)!
    expect(unscopedLine).not.toContain('"scope"')
    expect(unscopedLine).not.toContain('"captureIds"')
    expect(JSON.parse(scopedLine)).toMatchObject({ scope: 'selection', captureIds: ['cap-1'] })
  })

  // #X-1: a signature-free v1 entry that FOLLOWS a signed v2 entry is a
  // downgrade forgery — its hash links recompute without any private key, so
  // without the guard the tampered chain would re-verify as valid.
  it('rejects a v1 entry that follows a v2 entry (schema downgrade)', () => {
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const entry = JSON.parse(lines[1]) as Record<string, unknown>
    // Forge a legitimate-looking v1 entry: drop the signature, downgrade the
    // version, and recompute the entryHash over the canonical body (excluding
    // entryHash + signature, exactly as the verifier does). prevHash is
    // unchanged and entry 1 is last among the two captures we rewrite, so links
    // stay intact — the ONLY thing wrong is the downgrade.
    delete entry.signature
    entry.schemaVersion = 1
    const { entryHash: _oldHash, ...body } = entry
    void _oldHash
    entry.entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    lines[1] = JSON.stringify(entry)
    // Truncate to just the two capture entries so the rewritten v1 entry is the
    // tail (the deletion/timestamp entries linked off the old entryHash).
    writeFileSync(manifestPath, lines.slice(0, 2).join('\n') + '\n', 'utf-8')

    const result = verifyManifestChainText(readFileSync(manifestPath, 'utf-8'), {
      publicKeyPem: getPublicKeyPem()
    })
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
    expect(result.reason).toBe('Schema version downgrade')
  })
})

// zod's z.record skips an own `__proto__` key without validating it, so the
// schema output of a signed line edited to add one inside `headers` or
// `derivationParameters` is the body that was signed. verify.sh hashes the line
// as written and reports the edit; the core must report it too (#1674).
describe('verifyManifestChainText: an own __proto__ key added to a signed line (#1674)', () => {
  const CAPTURE_WITH_HEADERS = {
    ...makeCaptureEntry(0),
    headers: { 'content-type': 'text/html' },
    schemaVersion: 2
  }
  // A thumbnail's derivation entry, the shape manifestSchema3.test.ts freezes.
  const THUMBNAIL_DERIVATION = {
    type: 'derivation',
    caseId: 'case-1',
    parentExhibitId: 'cap-0',
    parentContentHash: 'a'.repeat(64),
    derivation: 'thumbnail',
    derivationToolVersion: '0.4.0',
    derivationParameters: {
      scaledWidth: 160,
      scaledHeight: 33,
      outputWidth: 160,
      outputHeight: 120,
      paddedRows: 87,
      padMethod: 'copy',
      jpegQuality: 75,
      sharpVersion: '0.35.4',
      libvipsVersion: '8.18.6'
    },
    outputHash: 'e'.repeat(64),
    outputPath: 'case-1/cap-0_thumb.jpg',
    timestamp: '2026-06-01T12:06:00.000Z',
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    schemaVersion: 3
  }
  // A type this build has never heard of, so the chain takes the
  // verifier-too-old path, whose phase A hashes the entries before it.
  const FUTURE_ENTRY = {
    type: 'annotation-burn',
    caseId: 'case-1',
    timestamp: '2026-06-01T12:10:00.000Z',
    operatorId: 'op-1',
    operatorName: 'Casey Operator',
    toolVersion: '0.4.0',
    schemaVersion: 3
  }
  const HASH_MISMATCH = { valid: false, brokenAt: 0, reason: 'Entry hash mismatch' }

  const verify = (lines: string[]) =>
    verifyManifestChainText(lines.join('\n') + '\n', { publicKeyPem: getPublicKeyPem() })

  // Edits the JSON text after signing: `__proto__` in an object literal sets
  // the prototype, so the key would never reach the signed line.
  function addProtoKey(line: string, field: string, value = '{"note":"x"}'): string {
    const edited = line.replace(`"${field}":{`, `"${field}":{"__proto__":${value},`)
    expect(edited).not.toBe(line)
    return edited
  }

  it('reports a capture entry whose headers gained the key as an entry hash mismatch', () => {
    const [line] = buildSignedChain([CAPTURE_WITH_HEADERS])
    const edited = addProtoKey(line, 'headers')
    const { headers } = JSON.parse(edited) as { headers: object }
    expect(Object.hasOwn(headers, '__proto__')).toBe(true)
    expect(verify([edited])).toMatchObject(HASH_MISMATCH)
  })

  it('reports a derivation entry whose parameters gained the key as an entry hash mismatch', () => {
    const [line] = buildSignedChain([THUMBNAIL_DERIVATION])
    const edited = addProtoKey(line, 'derivationParameters')
    const { derivationParameters } = JSON.parse(edited) as { derivationParameters: object }
    expect(Object.hasOwn(derivationParameters, '__proto__')).toBe(true)
    expect(verify([edited])).toMatchObject(HASH_MISMATCH)
  })

  it('reports the edited entry as broken, not the verifier as too old, before a newer entry', () => {
    const lines = buildSignedChain([CAPTURE_WITH_HEADERS, FUTURE_ENTRY])
    expect(verify(lines).unsupported?.index).toBe(1)
    const result = verify([addProtoKey(lines[0], 'headers'), lines[1]])
    expect(result).toMatchObject(HASH_MISMATCH)
    expect(result.unsupported).toBeUndefined()
  })

  // The runbook's recipe as verify.sh runs it, on the edited line.
  it.skipIf(!HAS_JQ)('agrees with the Verify Runbook jq recipe on the edited line', () => {
    const [line] = buildSignedChain([CAPTURE_WITH_HEADERS])
    const edited = addProtoKey(line, 'headers')
    const body: Record<string, unknown> = { ...(JSON.parse(edited) as Record<string, unknown>) }
    const storedHash = body.entryHash
    delete body.entryHash
    delete body.signature
    const viaJq = execFileSync('/bin/sh', ['-c', VERIFY_RECIPES.canonicalEntryBody], {
      input: edited,
      encoding: 'utf-8'
    })
    expect(viaJq).toContain('"__proto__":{"note":"x"}')
    expect(viaJq).toBe(canonicalStringify(body))
    expect(createHash('sha256').update(viaJq).digest('hex')).not.toBe(storedHash)
    expect(verify([edited])).toMatchObject(HASH_MISMATCH)
  })

  // zod never looks inside the key it skips, so its value is the one part of a
  // schema-valid line whose depth no schema bounds. 20000 sits past the depth
  // that overflows canonicalStringify, the figure manifestSchema3.test.ts uses.
  it('refuses the key nested past the depth limit with a verdict, not a stack overflow', () => {
    const [line] = buildSignedChain([CAPTURE_WITH_HEADERS])
    const nested = '['.repeat(20000) + '0' + ']'.repeat(20000)
    expect(verify([addProtoKey(line, 'headers', nested)])).toMatchObject({
      valid: false,
      brokenAt: 0,
      reason: 'Entry too deeply nested'
    })
  })

  it('still verifies the same entries unedited', () => {
    expect(verify(buildSignedChain([CAPTURE_WITH_HEADERS, THUMBNAIL_DERIVATION])).valid).toBe(true)
  })
})
