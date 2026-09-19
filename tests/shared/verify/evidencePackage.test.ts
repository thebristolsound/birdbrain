import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { ingestMhtmlCapture, createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { signEntryHash } from '@main/services/signingKey'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import type { PackageVerifyResult } from '@shared/verify/evidencePackage'
import { canonicalStringify } from '@shared/verify'
import { packageHash } from '@shared/verify/packageHash'
import { EvidencePackageSchema } from '@shared/schemas'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import { seedMixedKindCase, type MixedKindCase } from '../../helpers/mixedKindCase'
import type { ExportOptions } from '@shared/types'

// Parses a Birdbrain stored-ZIP (all entries STORE/method 0) into a name->bytes
// map, mirroring the export test's reader.
function readStoredZipEntries(path: string): Map<string, Buffer> {
  const zip = readFileSync(path)
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')
    if (method !== 0) throw new Error(`Unexpected compressed ZIP entry in test: ${name}`)
    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize))
    offset = dataStart + compressedSize
  }
  return entries
}

// Unzips a stored ZIP onto disk so verifyEvidencePackage(dir) can read it.
function unzipToDir(zipPath: string, destDir: string): void {
  for (const [name, bytes] of readStoredZipEntries(zipPath)) {
    const out = join(destDir, name)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, bytes)
  }
}

function reasons(result: { checks: Array<{ reason?: string }> }): string[] {
  return result.checks.map((c) => c.reason ?? '').filter(Boolean)
}

function hasReason(result: { checks: Array<{ reason?: string }> }, needle: string): boolean {
  return reasons(result).some((r) => r.includes(needle))
}

interface EvidenceJson {
  captures: Array<{ id: string; timestampTokenPaths: string[] }>
  artifacts: Array<{ path: string; sha256?: string; sizeBytes?: number }>
}

// Reads evidence.json from the package, hands the parsed object to `mutate`, and
// writes it back — the read/mutate/write dance the tampering tests share.
function mutateEvidenceJson(pkgDir: string, mutate: (evidence: EvidenceJson) => void): void {
  const p = join(pkgDir, 'evidence.json')
  const evidence: EvidenceJson = JSON.parse(readFileSync(p, 'utf-8'))
  mutate(evidence)
  writeFileSync(p, JSON.stringify(evidence, null, 2))
}

// Re-signs export-entry.json with the packageHash recomputed from the CURRENT
// evidence.json artifact index, using the harness's real signing key. A test
// that legitimately changes the packaged artifact list (a dedup rename the
// packager would have produced itself) must reseal, or it hands the verifier a
// package whose signed statement of itself no longer matches its index — which
// the #836 binding rejects, correctly, for reasons unrelated to that test's
// subject.
function resealExportEntry(pkgDir: string): void {
  const p = join(pkgDir, 'export-entry.json')
  const entry = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
  const evidence: EvidenceJson = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
  delete entry.entryHash
  delete entry.signature
  entry.packageHash = packageHash(
    evidence.artifacts as Array<{ path: string; sha256: string; sizeBytes: number }>
  )
  const entryHash = createHash('sha256').update(canonicalStringify(entry)).digest('hex')
  writeFileSync(p, JSON.stringify({ ...entry, entryHash, signature: signEntryHash(entryHash) }))
}

describe('verifyEvidencePackage', () => {
  let tempDir: string
  let caseId: string
  let pkgDir: string
  let captureId: string

  // Builds one good evidence package on disk and unzips it into pkgDir. The
  // capture carries a screenshot; a synthetic RFC 3161 token is appended whose
  // imprint equals the capture's content hash so the structural timestamp check
  // PASSes.
  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-pkgverify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Pkg Verify Case', description: 'verifier fixture' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })

    const screenshot = Buffer.from('screenshot-png-bytes-for-pkg-verify')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/page',
      title: 'Page',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([
        Buffer.from('<html><body>Packaged</body></html>')
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    })
    captureId = capture.id

    // Synthetic token bound to THIS capture's content hash so imprint matches.
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: false,
        annotations: 'none'
      },
      exportClass: 'evidence',
      outputPath
    }
    await generateReport(caseId, options, captureLifecycle)

    pkgDir = mkdtempSync(join(tmpdir(), 'bb-pkg-'))
    unzipToDir(outputPath, pkgDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
    if (pkgDir && existsSync(pkgDir)) rmSync(pkgDir, { recursive: true, force: true })
  })

  // #580. A `capture` entry with no matching `deletion` entry is a standing claim
  // that the case still holds that capture. The reviewed alpha package had three
  // of them — self-test entries removed without a deletion record — while
  // report.html asserted "15/15 integrity verified". The verifier must not call
  // such a package PASS, and its reasons must name the capture so a reader can
  // find it in the chain rather than being told only that a count disagrees.
  it('fails a package whose chain claims a capture the package does not contain', async () => {
    const caseDir = join(tempDir, 'captures', caseId)
    appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: 'orphan-capture-id',
      caseId,
      url: 'birdbrain://pipeline-test',
      timestamp: '2026-04-05T12:02:00.000Z',
      contentHash: createHash('sha256').update('orphan').digest('hex'),
      sizeBytes: 0,
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'orphan-evidence.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
    )

    const orphanDir = mkdtempSync(join(tmpdir(), 'bb-pkg-orphan-'))
    try {
      unzipToDir(outputPath, orphanDir)
      const result = verifyEvidencePackage(orphanDir)

      expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(false)
      expect(hasReason(result, 'orphan-capture-id')).toBe(true)

      // report.html must disclose the same gap rather than leaving the verifier
      // to be the only place it surfaces — a reader may never run the verifier.
      const report = readFileSync(join(orphanDir, 'report.html'), 'utf-8')
      expect(report).toContain('this package does not contain')
      expect(report).toContain('orphan-capture-id')
      expect(report).toContain('birdbrain://pipeline-test')

      // And evidence.json's count must agree with the document — both are folded
      // out of one resolution, so a disagreement means that stopped being true.
      // Read raw rather than through EvidencePackageSchema: that schema models
      // only the fields the verifier consumes, and strips `warnings`.
      const evidence = JSON.parse(readFileSync(join(orphanDir, 'evidence.json'), 'utf-8')) as {
        warnings: { unreconciledChainCaptureCount: number; unreconciledChainCaptureIds: string[] }
      }
      expect(evidence.warnings.unreconciledChainCaptureCount).toBe(1)
      expect(evidence.warnings.unreconciledChainCaptureIds).toEqual(['orphan-capture-id'])
    } finally {
      rmSync(orphanDir, { recursive: true, force: true })
    }
  })

  it('verifies a good package as PASS with the runbook present', () => {
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
    expect(result.checks.some((c) => c.status === 'fail')).toBe(false)
    // The structural timestamp check passed and points to the runbook.
    expect(hasReason(result, 'openssl ts -verify')).toBe(true)
    expect(existsSync(join(pkgDir, 'VERIFY.md'))).toBe(true)
    // A case-scoped package ships export-entry.json too (#398): validated when
    // present, conferring no selection scope.
    expect(result.checks.find((c) => c.name === 'export entry')?.status).toBe('pass')
    expect(result.checks.find((c) => c.name === 'export scope')).toBeUndefined()
  })

  it('reports the resolved trusted-time axis (rfc3161 + TSA identity) in the timestamp check', () => {
    const result = verifyEvidencePackage(pkgDir)
    const ts = result.checks.find((c) => c.name === `capture ${captureId} timestamp`)
    expect(ts?.status).toBe('pass')
    expect(ts?.reason).toContain('rfc3161')
    expect(ts?.reason).toContain('tsa.example.com')
  })

  it('reports a pending axis when an eligible capture has no timestamp token', () => {
    // Drop the timestamp token from the signed entry: the capture is still a v2
    // capture (eligible) but now unstamped → pending, reported as a SKIP.
    const p = join(pkgDir, 'manifest.jsonl')
    const lines = readFileSync(p, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const kept = lines.filter((l) => JSON.parse(l).type !== 'timestamp')
    writeFileSync(p, kept.join('\n') + '\n')
    const result = verifyEvidencePackage(pkgDir)
    const ts = result.checks.find((c) => c.name === `capture ${captureId} timestamp`)
    expect(ts?.status).toBe('skip')
    expect(ts?.reason).toContain('pending')
  })

  it('FAILs with content-binding reason when an mhtml byte is mutated', () => {
    const p = join(pkgDir, 'pages', `${captureId}.mhtml`)
    const bytes = readFileSync(p)
    bytes[0] = bytes[0] ^ 0xff
    writeFileSync(p, bytes)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'content hash does not match manifest')).toBe(true)
  })

  it('FAILs with "Entry hash mismatch" when a manifest body field is mutated', () => {
    const p = join(pkgDir, 'manifest.jsonl')
    const lines = readFileSync(p, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const entry = JSON.parse(lines[0])
    entry.url = 'https://tampered.example.com'
    lines[0] = JSON.stringify(entry)
    writeFileSync(p, lines.join('\n') + '\n')
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'Entry hash mismatch')).toBe(true)
  })

  it('FAILs with "Invalid signature" when a signature is stripped', () => {
    const p = join(pkgDir, 'manifest.jsonl')
    const lines = readFileSync(p, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const entry = JSON.parse(lines[0])
    delete entry.signature
    lines[0] = JSON.stringify(entry)
    writeFileSync(p, lines.join('\n') + '\n')
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'Invalid signature')).toBe(true)
  })

  it('FAILs with timestamp byte-binding reason when the .tst token is mutated', () => {
    const tstPath = join(pkgDir, 'timestamps', `${captureId}.tst`)
    const bytes = readFileSync(tstPath)
    bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff
    writeFileSync(tstPath, bytes)
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'timestamp token does not match the signed manifest')).toBe(true)
  })

  it('FAILs with screenshot-binding reason when the screenshot is swapped', () => {
    // Swap the screenshot bytes AND its evidence.json artifact record so the
    // §7.5 sweep passes — proving the chained screenshotHash is what catches it.
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    const rec = evidence.captures.find((c: { id: string }) => c.id === captureId)
    const shotPath = join(pkgDir, rec.screenshotPath)
    const swapped = Buffer.from('totally-different-screenshot-bytes')
    writeFileSync(shotPath, swapped)
    const newDigest = createHash('sha256').update(swapped).digest('hex')
    const artifact = evidence.artifacts.find((a: { path: string }) => a.path === rec.screenshotPath)
    artifact.sha256 = newDigest
    artifact.sizeBytes = swapped.length
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'screenshot hash does not match manifest')).toBe(true)
    // The artifact sweep was NOT the thing that caught it (it was kept consistent).
    expect(hasReason(result, 'sha256 does not match evidence.json')).toBe(false)
  })

  it('FAILs reconciliation (chain still PASS) when only evidence.json is edited', () => {
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    evidence.captures = []
    evidence.verificationMaterials.manifestHeadIndex = 999
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    // Chain itself is untouched and still verifies.
    expect(result.checks.find((c) => c.name === 'manifest chain')?.status).toBe('pass')
    expect(hasReason(result, 'evidence.json omits verified capture')).toBe(true)
    expect(hasReason(result, 'head does not match the verified manifest')).toBe(true)
  })

  it('FAILs with "path escapes package" when an artifact path traverses outside the package', () => {
    // Plant a secret file outside the package dir and point an artifact at it via
    // a traversal path. The sweep must reject it rather than read/verify it.
    const outsidePath = join(tempDir, 'escape.txt')
    const secret = Buffer.from('outside-the-package-secret')
    writeFileSync(outsidePath, secret)
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    evidence.artifacts.push({
      path: '../../escape.txt',
      sha256: createHash('sha256').update(secret).digest('hex'),
      sizeBytes: secret.length
    })
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'path escapes package')).toBe(true)
  })

  it('FAILs the artifact sweep when an indexed artifact file is missing from the package', () => {
    // Point evidence.json at an in-package artifact path that does not exist on
    // disk. safeJoin resolves it (no traversal), so the sweep reaches the
    // existsSync branch and reports the file as missing.
    mutateEvidenceJson(pkgDir, (evidence) => {
      evidence.artifacts.push({
        path: 'pages/does-not-exist.mhtml',
        sha256: 'a'.repeat(64),
        sizeBytes: 42
      })
    })
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'pages/does-not-exist.mhtml: file missing')).toBe(true)
  })

  it('locates a dedup-renamed .tst via the evidence.json timestampTokenPaths index', () => {
    // buildEvidenceZip names a shared token after the FIRST capture holding it,
    // so a capture is not guaranteed timestamps/{ownId}.tst. Rename the file away
    // from the own-id path and point the index at the new name: the verifier must
    // still find + byte-bind it and PASS the structural timestamp check.
    const ownRel = join('timestamps', `${captureId}.tst`)
    const newRel = join('timestamps', 'shared-token.tst')
    const bytes = readFileSync(join(pkgDir, ownRel))
    writeFileSync(join(pkgDir, newRel), bytes)
    rmSync(join(pkgDir, ownRel))

    mutateEvidenceJson(pkgDir, (evidence) => {
      const rec = evidence.captures.find((c) => c.id === captureId)
      rec!.timestampTokenPaths = ['timestamps/shared-token.tst']
      // Keep the artifact sweep consistent: the token file moved, so its recorded
      // path must move with it (bytes and thus sha256 are unchanged).
      const artifact = evidence.artifacts.find((a) => a.path === `timestamps/${captureId}.tst`)
      expect(artifact).toBeDefined()
      artifact!.path = 'timestamps/shared-token.tst'
    })
    // The packager itself would have written this path into the index before
    // sealing, so the coherent fixture is a resealed one (#836).
    resealExportEntry(pkgDir)

    const result = verifyEvidencePackage(pkgDir)
    const ts = result.checks.find((c) => c.name === `capture ${captureId} timestamp`)
    expect(ts?.status, JSON.stringify(result.checks, null, 2)).toBe('pass')
    expect(result.pass).toBe(true)
  })

  it('locates a dedup-renamed .tst by scanning timestamps/ when the index omits it', () => {
    // Neither the own-id path nor the untrusted index point at the token; the
    // verifier falls back to scanning timestamps/ for bytes matching the signed
    // token. This is the last resolution tier in locateTimestampFile.
    const ownRel = join('timestamps', `${captureId}.tst`)
    const newRel = join('timestamps', 'orphan-token.tst')
    const bytes = readFileSync(join(pkgDir, ownRel))
    writeFileSync(join(pkgDir, newRel), bytes)
    rmSync(join(pkgDir, ownRel))

    mutateEvidenceJson(pkgDir, (evidence) => {
      const rec = evidence.captures.find((c) => c.id === captureId)
      rec!.timestampTokenPaths = [] // index gives no help → force the disk scan
      const artifact = evidence.artifacts.find((a) => a.path === `timestamps/${captureId}.tst`)
      expect(artifact).toBeDefined()
      artifact!.path = 'timestamps/orphan-token.tst'
    })
    resealExportEntry(pkgDir)

    const result = verifyEvidencePackage(pkgDir)
    const ts = result.checks.find((c) => c.name === `capture ${captureId} timestamp`)
    expect(ts?.status, JSON.stringify(result.checks, null, 2)).toBe('pass')
    expect(result.pass).toBe(true)
  })

  it('FAILs with token-file-missing when no .tst can be located anywhere', () => {
    // Remove the token file and every index pointer to it. The signed manifest
    // still asserts a token, so there is nothing to byte-bind → FAIL.
    rmSync(join(pkgDir, 'timestamps', `${captureId}.tst`))
    mutateEvidenceJson(pkgDir, (evidence) => {
      const rec = evidence.captures.find((c) => c.id === captureId)
      rec!.timestampTokenPaths = []
      evidence.artifacts = evidence.artifacts.filter(
        (a) => a.path !== `timestamps/${captureId}.tst`
      )
    })
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(hasReason(result, 'timestamp token file missing')).toBe(true)
  })

  // #622 known-answer test. A package exported while the database still held a
  // row for a capture its own chain records as deleted. The verdict is
  // unchanged by the ruling — this is still the section 7.5 coverage FAIL, not
  // a new check and not a warning. The reason names the one fact the chain
  // establishes, that the id is recorded as deleted, and stops there. It must
  // not name a cause: the tamper test below reaches this same branch.
  it('explains an unreconciled deletion in the coverage FAIL reason, keeping the FAIL', () => {
    const caseDir = join(tempDir, 'captures', caseId)
    const firstEntry = JSON.parse(
      readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim())[0]
    )
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId,
      caseId,
      contentHash: firstEntry.contentHash,
      timestamp: '2026-04-05T13:00:00.000Z',
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    // Sync the package's manifest and head to the appended entry, but leave
    // evidence.json's capture list and files alone: that IS the unreconciled
    // state — the exporting database never removed the row.
    const freshManifest = readFileSync(join(caseDir, 'manifest.jsonl'))
    writeFileSync(join(pkgDir, 'manifest.jsonl'), freshManifest)
    const lines = freshManifest
      .toString('utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const head = JSON.parse(lines[lines.length - 1])
    mutateEvidenceJson(pkgDir, (evidence) => {
      const materials = (
        evidence as unknown as {
          verificationMaterials: { manifestHeadIndex: number; manifestHeadHash: string }
        }
      ).verificationMaterials
      materials.manifestHeadIndex = head.index
      materials.manifestHeadHash = head.entryHash
      const manArtifact = evidence.artifacts.find((a) => a.path === 'manifest.jsonl')
      if (manArtifact) {
        manArtifact.sha256 = createHash('sha256').update(freshManifest).digest('hex')
        manArtifact.sizeBytes = freshManifest.length
      }
    })

    const result = verifyEvidencePackage(pkgDir)

    expect(result.pass).toBe(false)
    const coverage = result.checks.filter((c) => c.name === 'evidence.json coverage')
    expect(coverage.map((c) => c.status)).toEqual(['fail'])
    expect(coverage[0].reason).toContain(captureId)
    expect(coverage[0].reason).toContain('absent from the verified manifest')
    expect(coverage[0].reason).toContain('the chain records it as deleted')
    // Deliberately absent. Verification never establishes the cause, and the
    // tamper case below is indistinguishable from this one at this branch.
    expect(coverage[0].reason).not.toContain('interrupted')
    // The chain itself is untouched and still verifies — the disagreement is
    // between the signed manifest and the unsigned index, not within the chain.
    expect(result.checks.find((c) => c.name === 'manifest chain')?.status).toBe('pass')
    // Ruling pinned: no new check name and no status outside the existing union.
    expect(result.checks.every((c) => ['pass', 'fail', 'skip'].includes(c.status))).toBe(true)
  })

  it('does NOT claim a deletion for an index entry the chain never mentions', () => {
    // The other way to reach the same line: an id invented in evidence.json.
    // The reason must stay bare rather than blaming an interrupted delete.
    mutateEvidenceJson(pkgDir, (evidence) => {
      evidence.captures.push({ id: 'never-in-the-chain', timestampTokenPaths: [] })
    })

    const result = verifyEvidencePackage(pkgDir)
    const coverage = result.checks.filter((c) => c.name === 'evidence.json coverage')

    expect(result.pass).toBe(false)
    expect(coverage.map((c) => c.status)).toEqual(['fail'])
    expect(coverage[0].reason).toContain('never-in-the-chain')
    expect(coverage[0].reason).not.toContain('deleted')
  })

  // The tamper this branch cannot tell apart from the #622 crash window, and
  // the reason the reason stays bare. An operator hands over a package with a
  // capture removed on the record; someone re-adds that id to evidence.json to
  // make the package look as though it still contained the capture. The chain
  // still records the deletion, so `deletedIds.has(id)` is true and this is the
  // same branch the honest case takes. `evidence.json head` compares only the
  // head index and hash, and the artifact sweep walks evidence.json's own list,
  // so neither fires — coverage is the only check that catches this.
  it('does NOT blame a crash when a deleted id is re-added to the index', () => {
    const caseDir = join(tempDir, 'captures', caseId)
    const firstEntry = JSON.parse(
      readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim())[0]
    )
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId,
      caseId,
      contentHash: firstEntry.contentHash,
      timestamp: '2026-04-05T13:00:00.000Z',
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const freshManifest = readFileSync(join(caseDir, 'manifest.jsonl'))
    writeFileSync(join(pkgDir, 'manifest.jsonl'), freshManifest)
    const lines = freshManifest
      .toString('utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const head = JSON.parse(lines[lines.length - 1])
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    const rec = evidence.captures.find((c: { id: string }) => c.id === captureId)

    // Honest hard-delete first: the index and artifacts reflect the removal.
    for (const rel of [rec.mhtmlPath, rec.screenshotPath, ...rec.timestampTokenPaths]) {
      if (rel && existsSync(join(pkgDir, rel))) rmSync(join(pkgDir, rel))
    }
    evidence.captures = []
    evidence.artifacts = evidence.artifacts.filter(
      (a: { path: string }) =>
        a.path !== rec.mhtmlPath &&
        a.path !== rec.screenshotPath &&
        !rec.timestampTokenPaths.includes(a.path)
    )
    evidence.verificationMaterials.manifestHeadIndex = head.index
    evidence.verificationMaterials.manifestHeadHash = head.entryHash
    const manArtifact = evidence.artifacts.find(
      (a: { path: string }) => a.path === 'manifest.jsonl'
    )
    if (manArtifact) {
      manArtifact.sha256 = createHash('sha256').update(freshManifest).digest('hex')
      manArtifact.sizeBytes = freshManifest.length
    }
    // Now the tamper: put the deleted capture back into the unsigned index.
    evidence.captures.push({ id: captureId, timestampTokenPaths: [] })
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    const coverage = result.checks.filter((c) => c.name === 'evidence.json coverage')

    expect(result.pass).toBe(false)
    expect(coverage.map((c) => c.status)).toEqual(['fail'])
    expect(coverage[0].reason).toContain(captureId)
    expect(coverage[0].reason).toContain('the chain records it as deleted')
    // The whole point. A tamperer must not be handed an innocent explanation.
    expect(coverage[0].reason).not.toContain('interrupted')
    expect(coverage[0].reason).not.toContain('had not reconciled')
    // The head check does not catch this, which is why coverage must not soften.
    expect(result.checks.find((c) => c.name === 'evidence.json head')?.status).toBe('pass')
  })

  // #691 known-answer tests. `parseManifestEntries` stops only on a line it
  // cannot read, while the chain walk also breaks on an index gap, a linkage or
  // hash mismatch, a schema downgrade and an invalid signature. For those
  // reasons every line after the break is still schema-valid, and the verifier
  // used to derive `deletedIds`, `activeCaptures` and their check rows from them
  // — reporting per-capture results for entries the same report had just called
  // untrustworthy. The pair below fixes the answer: the same appended entries
  // contribute nothing past a break and everything when the chain is intact, so
  // what excludes them is where they sit, not what they are.
  describe('entries past a chain break', () => {
    const APPENDED_ID = 'appended-past-the-break'

    // Appends one entry to the package manifest, correctly linked to its current
    // head and validly signed by the harness key — a line beyond reproach on its
    // own terms.
    function appendSignedLine(body: Record<string, unknown>): void {
      const p = join(pkgDir, 'manifest.jsonl')
      const lines = readFileSync(p, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
      const head = JSON.parse(lines[lines.length - 1]) as { index: number; entryHash: string }
      const full = { ...body, index: head.index + 1, prevHash: head.entryHash, schemaVersion: 2 }
      const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
      lines.push(JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) }))
      writeFileSync(p, lines.join('\n') + '\n')
    }

    // A deletion for the packaged capture and a capture entry of the attacker's
    // own, appended in that order after whatever the manifest already holds.
    function appendDeletionAndCapture(): void {
      const first = JSON.parse(
        readFileSync(join(pkgDir, 'manifest.jsonl'), 'utf-8')
          .split('\n')
          .filter((l) => l.trim())[0]
      )
      appendSignedLine({
        type: 'deletion',
        captureId,
        caseId,
        contentHash: first.contentHash,
        timestamp: '2026-04-05T13:00:00.000Z',
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
      appendSignedLine({
        type: 'capture',
        captureId: APPENDED_ID,
        caseId,
        url: 'https://attacker.example.com/added',
        timestamp: '2026-04-05T13:01:00.000Z',
        contentHash: createHash('sha256').update('appended').digest('hex'),
        sizeBytes: 0,
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
    }

    // Replaces the signature at `index` with a real signature over the WRONG
    // hash: syntactically valid and verifiable against nothing, so the walk
    // reaches its second pass and breaks on the signature rather than the shape
    // — a break `parseManifestEntries` does not see. The entryHash is untouched
    // (it excludes `signature`), so the lines appended after it still link.
    function forgeSignatureAt(index: number): void {
      const p = join(pkgDir, 'manifest.jsonl')
      const lines = readFileSync(p, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
      const entry = JSON.parse(lines[index])
      entry.signature = signEntryHash('f'.repeat(64))
      lines[index] = JSON.stringify(entry)
      writeFileSync(p, lines.join('\n') + '\n')
    }

    it('derives no check row, active capture or deletion from entries past a forged signature', () => {
      const lines = readFileSync(join(pkgDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
      const breakIndex = lines.findIndex((l) => JSON.parse(l).type === 'timestamp')
      expect(breakIndex).toBeGreaterThan(0)
      forgeSignatureAt(breakIndex)
      appendDeletionAndCapture()

      const result = verifyEvidencePackage(pkgDir)

      // The chain reports the break, and the verdict is FAIL on that ground.
      expect(result.pass).toBe(false)
      const chain = result.checks.find((c) => c.name === 'manifest chain')
      expect(chain?.status).toBe('fail')
      expect(chain?.reason).toContain(`Invalid signature (at index ${breakIndex})`)

      // Nothing the appended capture entry claims appears anywhere in the report.
      expect(result.checks.some((c) => c.name.includes(APPENDED_ID))).toBe(false)
      expect(hasReason(result, APPENDED_ID)).toBe(false)

      // Nor does the appended deletion: the packaged capture is still active, so
      // it keeps its own rows and evidence.json still reconciles against it.
      expect(hasReason(result, 'the chain records it as deleted')).toBe(false)
      expect(result.checks.find((c) => c.name === `capture ${captureId} content`)?.status).toBe(
        'pass'
      )
      const coverage = result.checks.filter((c) => c.name === 'evidence.json coverage')
      expect(coverage.map((c) => c.status)).toEqual(['pass'])

      // The broken entry itself is past the break too, so the token it carries
      // no longer satisfies the capture's timestamp check. The SKIP says that,
      // and does not say the manifest holds no token — it holds one, on a line
      // this report has just called untrustworthy.
      const ts = result.checks.find((c) => c.name === `capture ${captureId} timestamp`)
      expect(ts?.status).toBe('skip')
      expect(ts?.reason).toBe(
        `no trustworthy timestamp: the manifest's token for this capture is at or past ` +
          `the chain break at index ${breakIndex}`
      )
    })

    it('keeps the no-token SKIP reason for a capture the manifest never timestamped', () => {
      // A second capture with no timestamp entry of its own, then a filler
      // deletion after it whose signature is forged. The break therefore sits
      // past the appended capture, which stays active and untimestamped — the
      // discriminator for the reason above is where a token is, not whether the
      // chain is broken.
      appendSignedLine({
        type: 'capture',
        captureId: APPENDED_ID,
        caseId,
        url: 'https://example.com/untimestamped',
        timestamp: '2026-04-05T13:01:00.000Z',
        contentHash: createHash('sha256').update('untimestamped').digest('hex'),
        sizeBytes: 0,
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
      appendSignedLine({
        type: 'deletion',
        captureId: 'a-capture-this-manifest-never-recorded',
        caseId,
        contentHash: createHash('sha256').update('filler').digest('hex'),
        timestamp: '2026-04-05T13:02:00.000Z',
        operatorId: 'op',
        operatorName: 'Test Operator',
        toolVersion: '0.1.0'
      })
      const breakIndex =
        readFileSync(join(pkgDir, 'manifest.jsonl'), 'utf-8')
          .split('\n')
          .filter((l) => l.trim()).length - 1
      forgeSignatureAt(breakIndex)

      const result = verifyEvidencePackage(pkgDir)

      expect(result.checks.find((c) => c.name === 'manifest chain')?.status).toBe('fail')
      const ts = result.checks.find((c) => c.name === `capture ${APPENDED_ID} timestamp`)
      expect(ts?.status).toBe('skip')
      expect(ts?.reason).toBe('none — no timestamp token in the manifest')
      // The packaged capture's own token is before the break and still binds.
      expect(result.checks.find((c) => c.name === `capture ${captureId} timestamp`)?.status).toBe(
        'pass'
      )
    })

    it('derives those same rows from the same entries when the chain is intact', () => {
      appendDeletionAndCapture()

      const result = verifyEvidencePackage(pkgDir)

      expect(result.checks.find((c) => c.name === 'manifest chain')?.status).toBe('pass')
      // The deletion now counts: the packaged capture is inactive and its
      // presence in the unsigned index is the §7.5 disagreement.
      expect(hasReason(result, 'the chain records it as deleted')).toBe(true)
      expect(result.checks.some((c) => c.name === `capture ${captureId} content`)).toBe(false)
      // And the appended capture is an active capture the package does not hold.
      expect(result.checks.find((c) => c.name === `capture ${APPENDED_ID} content`)?.status).toBe(
        'fail'
      )
      expect(hasReason(result, `evidence.json omits verified capture ${APPENDED_ID}`)).toBe(true)
    })
  })

  it('PASSes a package whose capture was deleted (artifacts absent)', () => {
    // Append a deletion entry for the active capture, drop its artifacts and its
    // evidence.json record + artifacts so the package reflects a hard-delete.
    const caseDir = join(tempDir, 'captures', caseId)
    const capHash = readFileSync(join(pkgDir, 'evidence.json'), 'utf-8') // read before regen
    void capHash
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId,
      caseId,
      contentHash: JSON.parse(
        readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
          .split('\n')
          .filter((l) => l.trim())[0]
      ).contentHash,
      timestamp: '2026-04-05T13:00:00.000Z',
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    // Rebuild the package directory from the now-updated manifest, dropping the
    // deleted capture's content/screenshot/timestamp files and index entries.
    // The packaged export-entry.json extended the ORIGINAL bundled head, so the
    // hand-rebuilt manifest orphans it; drop it too — the rebuilt package takes
    // the pre-scope layout, which must keep verifying without one (#398).
    const freshManifest = readFileSync(join(caseDir, 'manifest.jsonl'))
    writeFileSync(join(pkgDir, 'manifest.jsonl'), freshManifest)
    rmSync(join(pkgDir, 'export-entry.json'))
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    const rec = evidence.captures.find((c: { id: string }) => c.id === captureId)
    // Remove the deleted capture's files.
    for (const rel of [rec.mhtmlPath, rec.screenshotPath, ...rec.timestampTokenPaths]) {
      if (rel && existsSync(join(pkgDir, rel))) rmSync(join(pkgDir, rel))
    }
    // Reflect the hard-delete in the unsigned index and refresh the head.
    const lines = freshManifest
      .toString('utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const head = JSON.parse(lines[lines.length - 1])
    evidence.captures = []
    // The Exhibit list drops the same row: a Capture is an Exhibit (X35), so an
    // index that still listed it would disagree with the chain in the second
    // place the verifier reconciles (#1156).
    evidence.exhibits = []
    evidence.verificationMaterials.manifestHeadIndex = head.index
    evidence.verificationMaterials.manifestHeadHash = head.entryHash
    evidence.artifacts = evidence.artifacts.filter(
      (a: { path: string }) =>
        a.path !== rec.mhtmlPath &&
        a.path !== rec.screenshotPath &&
        !rec.timestampTokenPaths.includes(a.path)
    )
    // The manifest.jsonl artifact digest changed (we appended a deletion entry).
    const manArtifact = evidence.artifacts.find(
      (a: { path: string }) => a.path === 'manifest.jsonl'
    )
    if (manArtifact) {
      manArtifact.sha256 = createHash('sha256').update(freshManifest).digest('hex')
      manArtifact.sizeBytes = freshManifest.length
    }
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
  })

  // #398 selection scope, built on the outer fixture: capture A (the outer
  // captureId) plus B and C, with C deleted, then a selection export of [A].
  // The chain in the selection package therefore holds captures A/B/C, a
  // timestamp, C's deletion and the outer case export's entry — and the
  // package must PASS with B reported as designed absence, while every edit
  // that could smuggle a capture out keeps FAILing.
  describe('selection-scoped packages', () => {
    let selDir: string
    let selZipPath: string
    let captureB: string
    let lifecycle: ReturnType<typeof createCaptureLifecycle>

    const ingestPlain = async (url: string, body: string) => {
      const { capture } = await ingestMhtmlCapture({
        caseId,
        url,
        title: 'Page',
        timestamp: '2026-04-05T12:05:00.000Z',
        stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
        textContent: 'text',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        extensionVersion: '',
        operatorId: 'op',
        operatorName: '',
        toolVersion: '0.1.0'
      })
      return capture
    }

    beforeEach(async () => {
      lifecycle = createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
      const b = await ingestPlain('https://example.com/unselected', '<html><body>B</body></html>')
      const c = await ingestPlain('https://example.com/deleted', '<html><body>C</body></html>')
      captureB = b.id
      await lifecycle.delete(c.id, 'fixture deletion')

      selZipPath = join(tempDir, 'selection-evidence.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: selZipPath,
          captureIds: [captureId]
        },
        lifecycle
      )
      selDir = mkdtempSync(join(tmpdir(), 'bb-selpkg-'))
      unzipToDir(selZipPath, selDir)
    })

    afterEach(() => {
      if (selDir && existsSync(selDir)) rmSync(selDir, { recursive: true, force: true })
    })

    it('PASSes, reporting unselected captures as designed absence with the deletion intact', () => {
      const result = verifyEvidencePackage(selDir)
      expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
      expect(result.checks.find((c) => c.name === 'export entry')?.status).toBe('pass')
      expect(result.checks.find((c) => c.name === 'export scope')?.status).toBe('pass')
      const skip = result.checks.find((c) => c.name === `capture ${captureB}`)
      expect(skip?.status).toBe('skip')
      expect(skip?.reason).toContain('outside the signed export selection')
      // The selected capture kept the full strict checks.
      expect(result.checks.find((c) => c.name === `capture ${captureId} content`)?.status).toBe(
        'pass'
      )
      // The chain ships complete: the unselected capture and the deletion are
      // both in the bundled manifest, and the chain still verifies.
      const manifest = readFileSync(join(selDir, 'manifest.jsonl'), 'utf-8')
      expect(manifest).toContain(captureB)
      expect(manifest).toContain('"type":"deletion"')
      expect(result.checks.find((c) => c.name === 'manifest chain')?.status).toBe('pass')
    })

    it('still FAILs when a SELECTED capture content file is missing', () => {
      rmSync(join(selDir, 'pages', `${captureId}.mhtml`))
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, `capture ${captureId}: content file missing`)).toBe(true)
    })

    // The #580 detection class the R1 ruling exists to close: a tamperer pads
    // captureIds to explain away a capture they removed. The scope is SIGNED,
    // so the edit breaks the entry hash — and with no trusted scope, every
    // unselected capture's absence FAILs loudly again.
    it('FAILs when captureIds is padded to cover an absent capture', () => {
      const p = join(selDir, 'export-entry.json')
      const entry = JSON.parse(readFileSync(p, 'utf-8')) as { captureIds: string[] }
      entry.captureIds.push(captureB)
      writeFileSync(p, JSON.stringify(entry))
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json entry hash mismatch')).toBe(true)
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    it('FAILs when export-entry.json is stripped from a selection package', () => {
      // Deleting the scope proof must not quietly widen trust: with no signed
      // selection, the unselected captures' absences are unexplained again.
      rmSync(join(selDir, 'export-entry.json'))
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    // Rebuilds export-entry.json with the harness's real signing key after
    // mutating the body, so every check BEFORE the targeted one passes and the
    // targeted branch is provably what fired.
    const forgeExportEntry = (mutate: (entry: Record<string, unknown>) => void): void => {
      const p = join(selDir, 'export-entry.json')
      const entry = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
      delete entry.entryHash
      delete entry.signature
      mutate(entry)
      const entryHash = createHash('sha256').update(canonicalStringify(entry)).digest('hex')
      writeFileSync(p, JSON.stringify({ ...entry, entryHash, signature: signEntryHash(entryHash) }))
    }

    it('FAILs without crashing when export-entry.json is unreadable (a directory)', () => {
      // existsSync passes for a directory, and readFileSync then throws EISDIR;
      // verification must complete and record the failure, not abort (#838).
      const p = join(selDir, 'export-entry.json')
      rmSync(p)
      mkdirSync(p)
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json unreadable')).toBe(true)
      // The rest of the run still executed: with no trusted scope, the
      // unselected capture's absence FAILs as usual.
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    it('FAILs when export-entry.json is not valid JSON', () => {
      writeFileSync(join(selDir, 'export-entry.json'), 'not-json{')
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json is not valid JSON')).toBe(true)
    })

    it('FAILs when export-entry.json is not a manifest entry shape', () => {
      writeFileSync(join(selDir, 'export-entry.json'), '{}')
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json is not a valid manifest entry')).toBe(true)
    })

    it('FAILs when export-entry.json holds a non-export entry', () => {
      // A perfectly valid SIGNED line — just the wrong kind: the chain's own
      // first capture entry.
      const captureLine = readFileSync(join(selDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim())[0]
      writeFileSync(join(selDir, 'export-entry.json'), captureLine)
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, "is a 'capture' entry, not an export entry")).toBe(true)
    })

    it('FAILs when export-entry.json comes from a different chain state', async () => {
      // A genuinely signed, hash-valid export entry from a LATER export cannot
      // vouch for this package: its prevHash extends a head the bundled
      // manifest does not end at.
      const secondZip = join(tempDir, 'second-selection.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: secondZip,
          captureIds: [captureId]
        },
        lifecycle
      )
      const swapped = readStoredZipEntries(secondZip).get('export-entry.json')!
      writeFileSync(join(selDir, 'export-entry.json'), swapped)
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(
        hasReason(result, 'export-entry.json prevHash does not match the bundled manifest head')
      ).toBe(true)
      // No trusted scope: the unselected capture's absence FAILs again.
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    it('FAILs when the export entry signature is stripped', () => {
      const p = join(selDir, 'export-entry.json')
      const entry = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>
      delete entry.signature
      writeFileSync(p, JSON.stringify(entry))
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json signature invalid')).toBe(true)
    })

    it('FAILs when the index does not continue the bundled chain', () => {
      forgeExportEntry((entry) => {
        entry.index = (entry.index as number) + 1
        // Keep prevHash intact so the index check — not the link check — fires.
      })
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(
        hasReason(result, 'export-entry.json index does not continue the bundled manifest')
      ).toBe(true)
    })

    it('FAILs when scope and captureIds are inconsistent, conferring no scope', () => {
      forgeExportEntry((entry) => {
        delete entry.captureIds
      })
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'export-entry.json scope and captureIds are inconsistent')).toBe(
        true
      )
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    // #836: the signed packageHash must bind the artifact index, or a
    // tamperer edits a packaged file AND its row and both prior checks stay
    // silent. That gap matters most for notes.md (#399), which unlike a
    // capture has no manifest entry of its own.
    it('FAILs when a packaged file and its evidence.json row are edited together', () => {
      const target = JSON.parse(readFileSync(join(selDir, 'evidence.json'), 'utf-8'))
        .artifacts[0] as { path: string }
      const tampered = Buffer.from('fabricated after sealing\n')
      writeFileSync(join(selDir, target.path), tampered)
      const digest = createHash('sha256').update(tampered).digest('hex')
      mutateEvidenceJson(selDir, (evidence) => {
        const row = evidence.artifacts.find((a) => a.path === target.path)!
        row.sha256 = digest
        row.sizeBytes = tampered.length
      })
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      // The row-versus-bytes sweep is satisfied by the coordinated edit, so
      // the packageHash binding is provably the check that fires.
      expect(result.checks.find((c) => c.name === 'evidence.json artifact sweep')?.status).toBe(
        'pass'
      )
      expect(
        hasReason(
          result,
          "evidence.json's artifact index does not match the packageHash in the signed export entry"
        )
      ).toBe(true)
    })

    it('FAILs when a packaged notes.md and its row are removed together', async () => {
      // Built with notes:true so the file under test is the one #399 adds and
      // no manifest entry covers.
      const notesZip = join(tempDir, 'notes-selection.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: true,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath: notesZip,
          captureIds: [captureId]
        },
        lifecycle
      )
      const dir = mkdtempSync(join(tmpdir(), 'bb-notespkg-'))
      try {
        unzipToDir(notesZip, dir)
        const notesRow = (
          JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf-8')).artifacts as Array<{
            path: string
          }>
        ).find((a) => a.path.endsWith('notes.md'))
        expect(notesRow, 'a notes:true export must package notes.md').toBeTruthy()
        expect(verifyEvidencePackage(dir).pass).toBe(true)

        rmSync(join(dir, notesRow!.path))
        mutateEvidenceJson(dir, (evidence) => {
          evidence.artifacts = evidence.artifacts.filter((a) => a.path !== notesRow!.path)
        })
        const result = verifyEvidencePackage(dir)
        expect(result.pass).toBe(false)
        expect(result.checks.find((c) => c.name === 'evidence.json artifact sweep')?.status).toBe(
          'pass'
        )
        expect(result.checks.find((c) => c.name === 'package hash')?.status).toBe('fail')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('PASSes the package hash check on an untampered package', () => {
      const result = verifyEvidencePackage(selDir)
      expect(result.checks.find((c) => c.name === 'package hash')?.status).toBe('pass')
    })

    // #851: a Working Copy's entry is a genuine signed line continuing the same
    // chain head, so every structural check above passes — the class itself
    // must disqualify it from standing as an evidence package's scope proof.
    it('FAILs when a working-copy export entry is supplied as the package entry', () => {
      forgeExportEntry((entry) => {
        entry.exportClass = 'working-copy'
      })
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(
        hasReason(
          result,
          'export-entry.json declares a working-copy export, not an evidence package'
        )
      ).toBe(true)
      // Rejected outright, so it confers no scope: the unselected capture's
      // absence FAILs again rather than being explained away.
      expect(hasReason(result, `capture ${captureB}: content file missing`)).toBe(true)
    })

    it('FAILs coverage when evidence.json lists a capture outside the signed selection', () => {
      mutateEvidenceJson(selDir, (evidence) => {
        evidence.captures.push({ id: captureB, timestampTokenPaths: [] })
      })
      const result = verifyEvidencePackage(selDir)
      expect(result.pass).toBe(false)
      expect(
        hasReason(
          result,
          `evidence.json lists capture ${captureB} outside the signed export selection`
        )
      ).toBe(true)
    })

    it('FAILs the scope check when the signed selection names a capture with no chain entry', async () => {
      // A DB row with no manifest entry (the legacy no-entry shape): the writer
      // will sign a selection containing it, and the verifier must refuse to
      // treat a capture the chain cannot bind as a verifiable member.
      const orphan = insertCapture({
        caseId,
        url: 'https://unchained.example',
        title: 'Unchained',
        hash: createHash('sha256').update('unchained').digest('hex'),
        timestamp: '2026-04-05T10:00:00.000Z'
      })
      const outputPath = join(tempDir, 'unchained-selection.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: false,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath,
          captureIds: [orphan.id]
        },
        lifecycle
      )
      const dir = mkdtempSync(join(tmpdir(), 'bb-unchained-'))
      try {
        unzipToDir(outputPath, dir)
        const result = verifyEvidencePackage(dir)
        expect(result.pass).toBe(false)
        expect(
          hasReason(
            result,
            `selection names exhibit ${orphan.id} with no active capture or exhibit entry`
          )
        ).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  // The third outcome (#399, ADR-0010): a self-identified Working Copy is
  // reported as "not a verifiable object" — never PASS, never FAIL — and the
  // unsigned marker must not be able to mask or soften anything else.
  describe('working copy detection (#399)', () => {
    const MARKER = 'WORKING-COPY.json'

    async function exportWorkingCopy(): Promise<string> {
      const outputPath = join(tempDir, 'working-copy.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: false,
            notes: true,
            annotations: 'none'
          },
          exportClass: 'working-copy',
          outputPath
        },
        createCaptureLifecycle({
          selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
        })
      )
      const dir = mkdtempSync(join(tmpdir(), 'bb-wc-'))
      unzipToDir(outputPath, dir)
      return dir
    }

    it('reports a real Working Copy export as not a verifiable object', async () => {
      const dir = await exportWorkingCopy()
      try {
        const result = verifyEvidencePackage(dir)

        expect(result.notVerifiable?.reason).toContain('Working Copy')
        expect(result.notVerifiable?.reason).toContain('non-evidentiary')
        // No integrity claim in either direction: pass stays false, and no
        // checks ran to be misread as findings.
        expect(result.pass).toBe(false)
        expect(result.checks).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('still FAILs — not not-verifiable — for an evidence package whose manifest was deleted', () => {
      rmSync(join(pkgDir, 'manifest.jsonl'))

      const result = verifyEvidencePackage(pkgDir)

      expect(result.notVerifiable).toBeUndefined()
      expect(result.pass).toBe(false)
      expect(hasReason(result, 'manifest.jsonl missing from package')).toBe(true)
    })

    it('a planted marker cannot silence a present manifest', () => {
      // A tamperer drops a valid marker into a genuine evidence package: the
      // chain is still there, so it is still verified — and still PASSes here,
      // because the package itself is intact.
      writeFileSync(join(pkgDir, MARKER), JSON.stringify({ exportClass: 'working-copy' }))

      const result = verifyEvidencePackage(pkgDir)

      expect(result.notVerifiable).toBeUndefined()
      expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
    })

    it('an invalid marker falls through to the missing-manifest FAIL', () => {
      rmSync(join(pkgDir, 'manifest.jsonl'))

      for (const bad of ['not json at all', JSON.stringify({ exportClass: 'evidence' })]) {
        writeFileSync(join(pkgDir, MARKER), bad)
        const result = verifyEvidencePackage(pkgDir)
        expect(result.notVerifiable).toBeUndefined()
        expect(hasReason(result, 'manifest.jsonl missing from package')).toBe(true)
      }
    })

    it('an evidence package whose bundled chain contains a Working Copy entry still verifies', async () => {
      // The WC export appended a marked `export` entry to the live chain; the
      // next evidence package bundles that chain, so the strict verifier
      // schema must accept the exportClass key and the chain must still walk.
      const wcDir = await exportWorkingCopy()
      rmSync(wcDir, { recursive: true, force: true })

      const outputPath = join(tempDir, 'after-wc.zip')
      await generateReport(
        caseId,
        {
          format: 'zip',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          exportClass: 'evidence',
          outputPath
        },
        createCaptureLifecycle({
          selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
        })
      )
      const dir = mkdtempSync(join(tmpdir(), 'bb-after-wc-'))
      try {
        unzipToDir(outputPath, dir)
        const manifest = readFileSync(join(dir, 'manifest.jsonl'), 'utf-8')
        expect(manifest).toContain('"exportClass":"working-copy"')

        const result = verifyEvidencePackage(dir)
        expect(result.notVerifiable).toBeUndefined()
        expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('a stripped evidence package with a planted valid marker reads as not verifiable, never PASS', () => {
      // The residual channel, stated as a known answer: remove the manifest
      // AND plant a marker and the result is indistinguishable from a real
      // Working Copy — which confers no integrity claim, so the tamper gains
      // no PASS from it.
      rmSync(join(pkgDir, 'manifest.jsonl'))
      writeFileSync(join(pkgDir, MARKER), JSON.stringify({ exportClass: 'working-copy' }))

      const result = verifyEvidencePackage(pkgDir)

      expect(result.notVerifiable).toBeDefined()
      expect(result.pass).toBe(false)
    })
  })
})

describe('EvidencePackageSchema', () => {
  it('accepts a real evidence.json shape', () => {
    const valid = {
      schemaVersion: 1,
      generatedBy: 'Birdbrain',
      verificationMaterials: {
        manifestPath: 'manifest.jsonl',
        manifestHeadIndex: 1,
        manifestHeadHash: 'abc',
        signingPublicKeyPath: 'signing-public-key.pem',
        tsaRootPath: 'tsa-root.pem',
        tsaIntermediatesPath: 'tsa-intermediates.pem',
        extraInfoKey: 'ignored'
      },
      captures: [
        {
          id: 'cap1',
          mhtmlPath: 'pages/cap1.mhtml',
          mhtmlSha256: 'deadbeef',
          screenshotPath: null,
          screenshotSha256: null,
          textSha256: null,
          timestampTokenPaths: []
        }
      ],
      artifacts: [{ path: 'manifest.jsonl', sha256: 'cafe', sizeBytes: 10 }]
    }
    expect(EvidencePackageSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a malformed evidence.json', () => {
    const bad = {
      schemaVersion: 1,
      verificationMaterials: { manifestPath: 'manifest.jsonl' },
      captures: 'not-an-array',
      artifacts: []
    }
    expect(EvidencePackageSchema.safeParse(bad).success).toBe(false)
  })
})

// Known-answer tests over the shared mixed-kind fixture Case (#1156, D14): the
// same Case the export tests and the built-binary tests build their packages
// from, so the three surfaces describe one object rather than three.
describe('verifyEvidencePackage — exhibits of every kind (#1156)', () => {
  let tempDir: string
  let pkgDir: string
  let fixture: MixedKindCase

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-mixedverify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })
    fixture = await seedMixedKindCase({ tempDir })

    const outputPath = join(tempDir, 'mixed-evidence.zip')
    await generateReport(
      fixture.caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
    )
    pkgDir = mkdtempSync(join(tmpdir(), 'bb-mixedpkg-'))
    unzipToDir(outputPath, pkgDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
    if (pkgDir && existsSync(pkgDir)) rmSync(pkgDir, { recursive: true, force: true })
  })

  const checkNamed = (result: PackageVerifyResult, name: string) =>
    result.checks.find((c) => c.name === name)

  it('passes a mixed-kind package and binds every exhibit and derived file', () => {
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)

    for (const exhibit of fixture.committed) {
      const check = checkNamed(result, `exhibit ${exhibit.id}`)
      expect(check?.status, exhibit.kind).toBe('pass')
      expect(check?.reason).toContain(`Exhibit ${exhibit.exhibitNumber}`)
      expect(check?.reason).toContain(exhibit.packagePath)
    }
    const thumbnail = checkNamed(result, `derivation thumbnail of ${fixture.captureId}`)
    expect(thumbnail?.status).toBe('pass')
    expect(checkNamed(result, 'evidence.json exhibits')?.status).toBe('pass')
  })

  it('fails a tampered derived file as its parent exhibit and derivation (AC 5)', () => {
    // The Capture's thumbnail, which is the only Derived File that exists at
    // head (X34) and the one AC 5 names.
    writeFileSync(join(pkgDir, fixture.thumbnailPackagePath), Buffer.from('not the thumbnail'))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = checkNamed(result, `derivation thumbnail of ${fixture.captureId}`)
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('derivation `thumbnail`')
    expect(check?.reason).toContain('does not match the outputHash in its signed entry')
    // A Capture's Exhibit Number comes off the chain's `renumber` entry, so the
    // finding cites it rather than the file's position anywhere.
    expect(check?.reason).toContain('Exhibit 1,')
  })

  it('fails a tampered non-capture exhibit by its exhibit number (AC 2)', () => {
    const target = fixture.document
    writeFileSync(join(pkgDir, target.packagePath), Buffer.from('%PDF-1.7 substituted'))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = checkNamed(result, `exhibit ${target.id}`)
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain(`Exhibit ${target.exhibitNumber}`)
    expect(check?.reason).toContain('does not match the contentHash in its signed entry')
  })

  it('fails an exhibit the chain anchors and the package does not enclose', () => {
    rmSync(join(pkgDir, fixture.attachment.packagePath))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    expect(checkNamed(result, `exhibit ${fixture.attachment.id}`)?.reason).toContain(
      'is missing from the package'
    )
  })

  it('binds a committed exhibit timestamp token, and fails a tampered or missing one', async () => {
    // X26: committing an Exhibit runs the same RFC 3161 path ingesting a
    // Capture does, so its token is bound the same way. The exporter ships it
    // and the certification asserts a trusted time off it; a verifier that
    // never looks leaves those two claims unchecked.
    const target = fixture.document
    const stored = listExhibits(fixture.caseId).find((e) => e.id === target.id)!
    const token = buildSyntheticToken({
      contentHash: stored.contentHash,
      genTime: new Date('2026-04-05T12:01:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', fixture.caseId), {
      type: 'timestamp',
      caseId: fixture.caseId,
      captureContentHash: stored.contentHash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'mixed-stamped.zip')
    await generateReport(
      fixture.caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      },
      createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
    )
    const dir = mkdtempSync(join(tmpdir(), 'bb-mixedstamp-'))
    try {
      unzipToDir(outputPath, dir)
      const tokenPath = join(dir, 'timestamps', `${target.id}.tst`)
      expect(existsSync(tokenPath)).toBe(true)

      const pass = verifyEvidencePackage(dir)
      const check = pass.checks.find((c) => c.name === `exhibit ${target.id} timestamp`)
      expect(check?.status).toBe('pass')
      expect(check?.reason).toContain(`Exhibit ${target.exhibitNumber}`)
      expect(check?.reason).toContain('structural (imprint + bytes)')
      expect(pass.pass, JSON.stringify(pass.checks, null, 2)).toBe(true)

      // A token swapped for one the signed entry does not carry.
      writeFileSync(
        tokenPath,
        buildSyntheticToken({
          contentHash: stored.contentHash,
          genTime: new Date('2026-04-05T13:00:00.000Z'),
          tsaDnsName: 'other.example.com'
        })
      )
      const swapped = verifyEvidencePackage(dir)
      const swappedCheck = swapped.checks.find((c) => c.name === `exhibit ${target.id} timestamp`)
      expect(swappedCheck?.status).toBe('fail')
      expect(swappedCheck?.reason).toContain('does not match the signed manifest')

      // And the token removed entirely.
      rmSync(tokenPath)
      const missing = verifyEvidencePackage(dir)
      const missingCheck = missing.checks.find((c) => c.name === `exhibit ${target.id} timestamp`)
      expect(missingCheck?.status).toBe('fail')
      expect(missingCheck?.reason).toContain('timestamp token file missing')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails a fabricated derived-file row in evidence.json', () => {
    // The row is a provenance claim: it says the tool computed this file from
    // this Exhibit. Nothing in the chain says so, so the index and the chain
    // disagree and the package must not pass.
    const path = join(pkgDir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as {
      exhibits: Array<{
        id: string
        derivedFiles: Array<{ derivation: string; contentHash: string; path: string }>
      }>
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }
    const bytes = Buffer.from('forged derivation output')
    const forgedPath = `documents/forged.txt`
    writeFileSync(join(pkgDir, forgedPath), bytes)
    const row = evidence.exhibits.find((e) => e.id === fixture.document.id)!
    row.derivedFiles.push({
      derivation: 'text',
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      path: forgedPath
    })
    // Indexed too, so the artifact sweep is satisfied and only the chain
    // reconciliation can catch it.
    evidence.artifacts.push({
      path: forgedPath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length
    })
    writeFileSync(path, JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = result.checks.find((c) => c.name === 'evidence.json derived files')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('which the verified manifest does not anchor at that path')
  })

  it('fails an evidence.json row whose derived-file digest is not the signed one', () => {
    const path = join(pkgDir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as {
      exhibits: Array<{ id: string; derivedFiles: Array<{ contentHash: string }> }>
    }
    const row = evidence.exhibits.find((e) => e.derivedFiles.length > 0)!
    row.derivedFiles[0].contentHash = 'c'.repeat(64)
    writeFileSync(path, JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = result.checks.find((c) => c.name === 'evidence.json derived files')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('records a different digest for derived file')
  })

  it('fails an evidence.json that omits a derived file the chain anchors', () => {
    const path = join(pkgDir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as {
      exhibits: Array<{ id: string; derivedFiles: unknown[] }>
    }
    const row = evidence.exhibits.find((e) => e.derivedFiles.length > 0)!
    row.derivedFiles = []
    writeFileSync(path, JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = result.checks.find((c) => c.name === 'evidence.json derived files')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('which the verified manifest anchors')
  })

  it('fails a schemaVersion downgraded to hide the exhibits list', () => {
    // `schemaVersion` lives in the same unsigned file as the list it would
    // gate, so the chain is what decides the index owes one.
    const path = join(pkgDir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    evidence.schemaVersion = 1
    delete evidence.exhibits
    writeFileSync(path, JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = result.checks.find((c) => c.name === 'evidence.json exhibits')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('the verified manifest anchors exhibits or derived files')
  })

  it('fails an evidence.json that lists an exhibit the chain does not hold', () => {
    const path = join(pkgDir, 'evidence.json')
    const evidence = JSON.parse(readFileSync(path, 'utf-8')) as {
      exhibits: Array<{ id: string; kind: string }>
    }
    evidence.exhibits.push({ ...evidence.exhibits[1], id: 'planted-exhibit-id' })
    writeFileSync(path, JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass).toBe(false)
    const check = result.checks.find((c) => c.name === 'evidence.json exhibits')
    expect(check?.status).toBe('fail')
    expect(check?.reason).toContain('planted-exhibit-id')
  })

  it('passes a selection scoped over mixed kinds and skips what it leaves out', async () => {
    const outputPath = join(tempDir, 'mixed-selection.zip')
    await generateReport(
      fixture.caseId,
      {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath,
        captureIds: [fixture.captureId, fixture.image.id]
      },
      createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
      })
    )
    const selDir = mkdtempSync(join(tmpdir(), 'bb-mixedsel-'))
    try {
      unzipToDir(outputPath, selDir)
      const result = verifyEvidencePackage(selDir)
      expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
      expect(checkNamed(result, 'export scope')?.status).toBe('pass')
      expect(checkNamed(result, `exhibit ${fixture.image.id}`)?.status).toBe('pass')
      for (const absent of [fixture.attachment, fixture.document]) {
        const check = checkNamed(result, `exhibit ${absent.id}`)
        expect(check?.status).toBe('skip')
        expect(check?.reason).toContain('outside the signed export selection')
      }
    } finally {
      rmSync(selDir, { recursive: true, force: true })
    }
  })
})
