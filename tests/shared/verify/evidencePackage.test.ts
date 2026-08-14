import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { ingestMhtmlCapture, createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { EvidencePackageSchema } from '@shared/schemas'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
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
      stream: Readable.from([Buffer.from('<html><body>Packaged</body></html>')]) as unknown as ReadableStream<Uint8Array>,
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
      include: { captures: true, screenshots: true, auditTrail: true, annotations: 'none' },
      investigatorName: 'Test User',
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

  it('verifies a good package as PASS with the runbook present', () => {
    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
    expect(result.checks.some((c) => c.status === 'fail')).toBe(false)
    // The structural timestamp check passed and points to the runbook.
    expect(hasReason(result, 'openssl ts -verify')).toBe(true)
    expect(existsSync(join(pkgDir, 'VERIFY.md'))).toBe(true)
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
    const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim())
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
    const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim())
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
    const lines = readFileSync(p, 'utf-8').split('\n').filter((l) => l.trim())
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
    const freshManifest = readFileSync(join(caseDir, 'manifest.jsonl'))
    writeFileSync(join(pkgDir, 'manifest.jsonl'), freshManifest)
    const evidence = JSON.parse(readFileSync(join(pkgDir, 'evidence.json'), 'utf-8'))
    const rec = evidence.captures.find((c: { id: string }) => c.id === captureId)
    // Remove the deleted capture's files.
    for (const rel of [rec.mhtmlPath, rec.screenshotPath, ...rec.timestampTokenPaths]) {
      if (rel && existsSync(join(pkgDir, rel))) rmSync(join(pkgDir, rel))
    }
    // Reflect the hard-delete in the unsigned index and refresh the head.
    const lines = freshManifest.toString('utf-8').split('\n').filter((l) => l.trim())
    const head = JSON.parse(lines[lines.length - 1])
    evidence.captures = []
    evidence.verificationMaterials.manifestHeadIndex = head.index
    evidence.verificationMaterials.manifestHeadHash = head.entryHash
    evidence.artifacts = evidence.artifacts.filter(
      (a: { path: string }) =>
        a.path !== rec.mhtmlPath &&
        a.path !== rec.screenshotPath &&
        !rec.timestampTokenPaths.includes(a.path)
    )
    // The manifest.jsonl artifact digest changed (we appended a deletion entry).
    const manArtifact = evidence.artifacts.find((a: { path: string }) => a.path === 'manifest.jsonl')
    if (manArtifact) {
      manArtifact.sha256 = createHash('sha256').update(freshManifest).digest('hex')
      manArtifact.sizeBytes = freshManifest.length
    }
    writeFileSync(join(pkgDir, 'evidence.json'), JSON.stringify(evidence, null, 2))

    const result = verifyEvidencePackage(pkgDir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
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
        tsaCaChainPath: 'tsa-ca-chain.pem',
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
