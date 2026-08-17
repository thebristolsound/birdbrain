import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import sharp from 'sharp'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import * as manifest from '@main/services/manifest'
import {
  appendManifestEntry,
  getManifestHead,
  initManifest,
  verifyManifestChain
} from '@main/services/manifest'
import { canonicalStringify } from '@shared/verify'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { createCaptureLifecycle, type CaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { verifyCaptures, generateReport, getExportPreflight } from '@main/services/export'
import { saveAnnotations, upsertPin, deletePin } from '@main/services/annotations'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import type { ExportOptions } from '@shared/types'

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

async function ingest(
  caseId: string,
  payload: string,
  url = 'https://example.com',
  title = 'Test'
) {
  const stream = Readable.from([Buffer.from(payload)])
  return ingestMhtmlCapture({
    caseId,
    url,
    title,
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: stream as unknown as ReadableStream<Uint8Array>,
    textContent: payload,
    headers: {},
    browserVersion: '',
    userAgent: '',
    httpStatus: 200,
    extensionVersion: '',
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0'
  })
}

describe('export', () => {
  let tempDir: string
  let caseId: string
  let captureLifecycle: CaptureLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    // Default: operator name set so existing tests pass
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Export Test Case', description: 'Test case for export' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('verifyCaptures marks verified when hash matches', async () => {
    await ingest(caseId, '<html><body>Test content</body></html>')

    const results = await verifyCaptures(caseId, captureLifecycle)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('verified')
    expect(results[0].storedHash).toBe(results[0].computedHash)
  })

  it('verifyCaptures marks tampered when file bytes change after ingest', async () => {
    const { capture } = await ingest(caseId, '<html><body>Original</body></html>')
    writeFileSync(join(tempDir, 'captures', capture.mhtmlPath!), 'mutated bytes')

    const results = await verifyCaptures(caseId, captureLifecycle)
    expect(results[0].status).toBe('tampered')
  })

  it('verifyCaptures marks missing when MHTML file is gone', async () => {
    const { capture } = await ingest(caseId, '<html><body>Vanishing</body></html>')
    rmSync(join(tempDir, 'captures', capture.mhtmlPath!))

    const results = await verifyCaptures(caseId, captureLifecycle)
    expect(results[0].status).toBe('missing')
  })

  it('verifyCaptures marks legacy for pre-MHTML HTML captures', async () => {
    insertCapture({
      caseId,
      url: 'https://legacy.example',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2024-01-01T00:00:00Z'
    })

    const results = await verifyCaptures(caseId, captureLifecycle)
    expect(results[0].status).toBe('legacy')
  })

  it('generates HTML report with audit trail', async () => {
    await ingest(
      caseId,
      '<html><body>Page content</body></html>',
      'https://example.com',
      'Test Page'
    )

    const outputPath = join(tempDir, 'report.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: true,
        annotations: 'none'
      },
      investigatorName: 'Test User',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    expect(existsSync(outputPath)).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    expect(content).toContain('Test User')
    expect(content).toContain('example.com')
    expect(content).toContain('Birdbrain')
    expect(content).toContain('Exhibit index and verification results')
    expect(content).toContain('Verified')
  })

  it('generates a self-contained evidence ZIP with manifest, report, keys, and captures', async () => {
    const { capture } = await ingest(
      caseId,
      '<html><body>Packaged evidence</body></html>',
      'https://example.com/evidence',
      'Evidence Page'
    )
    const token = readFileSync(join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der'))
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
        screenshots: false,
        auditTrail: true,
        annotations: 'none'
      },
      investigatorName: 'Test User',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    const entries = readStoredZipEntries(outputPath)

    expect(entries.has('evidence.json')).toBe(true)
    expect(entries.has('manifest.jsonl')).toBe(true)
    expect(entries.has('report.html')).toBe(true)
    expect(entries.has('signing-public-key.pem')).toBe(true)
    expect(entries.has('tsa-ca-chain.pem')).toBe(true)
    expect(entries.has(`pages/${capture.id}.mhtml`)).toBe(true)
    expect(entries.get(`timestamps/${capture.id}.tst`)).toEqual(token)
    expect(
      entries
        .get('tsa-ca-chain.pem')!
        .toString('utf-8')
        .match(/BEGIN CERTIFICATE/g)?.length
    ).toBeGreaterThan(1)

    const manifest = entries.get('manifest.jsonl')!.toString('utf-8')
    expect(manifest).toContain('"type":"capture"')
    expect(manifest).toContain('"signature"')

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        mhtmlPath: string
        mhtmlSha256: string
        trustedTime: string
        timestampTokenPaths: string[]
      }>
      verificationMaterials: { manifestPath: string; signingPublicKeyPath: string }
      warnings: { unstampedCaptureCount: number }
    }

    const mhtml = entries.get(`pages/${capture.id}.mhtml`)!
    expect(evidence.verificationMaterials.manifestPath).toBe('manifest.jsonl')
    expect(evidence.verificationMaterials.signingPublicKeyPath).toBe('signing-public-key.pem')
    expect(evidence.warnings.unstampedCaptureCount).toBe(1)
    expect(evidence.captures[0]).toMatchObject({
      id: capture.id,
      mhtmlPath: `pages/${capture.id}.mhtml`,
      mhtmlSha256: createHash('sha256').update(mhtml).digest('hex'),
      trustedTime: 'pending',
      timestampTokenPaths: [`timestamps/${capture.id}.tst`]
    })
  })

  it('records a signed, hash-chained export entry on the case manifest (#124)', async () => {
    await ingest(caseId, '<html><body>Audited export</body></html>', 'https://example.com', 'A')

    const caseDir = join(tempDir, 'captures', caseId)
    const headBefore = getManifestHead(caseDir)

    const outputPath = join(tempDir, 'audited-evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
      investigatorName: 'Test User',
      outputPath
    }
    await generateReport(caseId, options, captureLifecycle)

    const manifest = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const exportEntries = manifest.filter((e) => e.type === 'export')
    expect(exportEntries).toHaveLength(1)
    const entry = exportEntries[0]

    expect(entry.caseId).toBe(caseId)
    expect(entry.operatorId).toBe(getInstallationId())
    expect(entry.operatorName).toBe('Test Operator')
    expect(typeof entry.packageHash).toBe('string')
    expect((entry.packageHash as string).length).toBe(64)
    expect(typeof entry.timestamp).toBe('string')
    expect(entry.verificationResult).toMatchObject({
      overallValid: true,
      captureCount: 1,
      verifiedCount: 1,
      tamperedCount: 0,
      missingCount: 0
    })

    // Signed + chained to the prior head.
    expect(typeof entry.signature).toBe('string')
    expect((entry.signature as string).length).toBeGreaterThan(0)
    expect(entry.index).toBe(headBefore.nextIndex)
    expect(entry.prevHash).toBe(headBefore.prevHash)

    // The whole chain (capture + export) still verifies.
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    // The export entry's packageHash matches sha256(canonicalStringify(sortedArtifacts))
    // recomputed from the bundled evidence.json artifact list.
    const entries = readStoredZipEntries(outputPath)
    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }
    const sorted = [...evidence.artifacts].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    )
    const expectedHash = createHash('sha256')
      .update(canonicalStringify(sorted), 'utf-8')
      .digest('hex')
    expect(entry.packageHash).toBe(expectedHash)
  })

  it('content-addresses screenshots into screenshots/<sha256>.png and records them in artifacts[] (#118)', async () => {
    const screenshot = Buffer.from('screenshot-png-bytes-for-export')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/shot',
      title: 'Shot',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
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

    const outputPath = join(tempDir, 'shot-evidence.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: true, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test User',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const expectedDigest = createHash('sha256').update(screenshot).digest('hex')
    const expectedPath = `screenshots/${expectedDigest}.png`

    // Content-addressed: the file exists, its name equals its digest, bytes match.
    expect(entries.has(expectedPath)).toBe(true)
    expect(entries.get(expectedPath)).toEqual(screenshot)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
        textSha256: string | null
      }>
      artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
    }

    // Per-capture record is self-describing.
    const rec = evidence.captures.find((c) => c.id === capture.id)!
    expect(rec.screenshotPath).toBe(expectedPath)
    expect(rec.screenshotSha256).toBe(expectedDigest)
    expect(rec.textSha256).toBe(capture.textHash)

    // The artifact is registered with a matching sha256.
    const artifact = evidence.artifacts.find((a) => a.path === expectedPath)!
    expect(artifact.sha256).toBe(expectedDigest)
    expect(artifact.sizeBytes).toBe(screenshot.length)
  })

  it('emits one content-addressed screenshot entry when two captures share bytes (#152)', async () => {
    const screenshot = Buffer.from('identical-screenshot-bytes-across-captures')
    const base = {
      caseId,
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    }
    const { capture: captureA } = await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/a',
      title: 'A',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>
    })
    const { capture: captureB } = await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/b',
      title: 'B',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>
    })

    const outputPath = join(tempDir, 'shot-dedupe.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: true, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test User',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const expectedDigest = createHash('sha256').update(screenshot).digest('hex')
    const expectedPath = `screenshots/${expectedDigest}.png`

    // Exactly one content-addressed screenshot entry, no duplicate.
    const screenshotKeys = [...entries.keys()].filter((k) => k.startsWith('screenshots/'))
    expect(screenshotKeys).toEqual([expectedPath])
    expect(entries.get(expectedPath)).toEqual(screenshot)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
      }>
      artifacts: Array<{ path: string }>
    }

    // Both capture records reference the shared content-addressed path.
    const recA = evidence.captures.find((c) => c.id === captureA.id)!
    const recB = evidence.captures.find((c) => c.id === captureB.id)!
    expect(recA.screenshotPath).toBe(expectedPath)
    expect(recA.screenshotSha256).toBe(expectedDigest)
    expect(recB.screenshotPath).toBe(expectedPath)
    expect(recB.screenshotSha256).toBe(expectedDigest)

    // The artifact is registered exactly once.
    expect(evidence.artifacts.filter((a) => a.path === expectedPath)).toHaveLength(1)
  })

  it('omits screenshots from the package when include.screenshots is false (#152)', async () => {
    const screenshot = Buffer.from('screenshot-bytes-should-not-leak')
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: 'https://example.com/shot',
      title: 'Shot',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([Buffer.from('mhtml')]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'extracted text for export',
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

    const outputPath = join(tempDir, 'shot-no-screenshots.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test User',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    // No content-addressed screenshot file is bundled.
    expect([...entries.keys()].some((k) => k.startsWith('screenshots/'))).toBe(false)

    const evidence = JSON.parse(entries.get('evidence.json')!.toString('utf-8')) as {
      captures: Array<{
        id: string
        screenshotPath: string | null
        screenshotSha256: string | null
      }>
      artifacts: Array<{ path: string }>
    }
    const rec = evidence.captures.find((c) => c.id === capture.id)!
    expect(rec.screenshotPath).toBeNull()
    expect(rec.screenshotSha256).toBeNull()
    expect(evidence.artifacts.some((a) => a.path.startsWith('screenshots/'))).toBe(false)
  })

  it('renders Trusted Time as a column orthogonal to integrity status', async () => {
    await ingest(caseId, '<html><body>Two axes</body></html>', 'https://example.com', 'Axes')

    const outputPath = join(tempDir, 'axes.html')
    const options: ExportOptions = {
      format: 'html',
      include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
      investigatorName: 'Test User',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    const content = readFileSync(outputPath, 'utf-8')

    // Integrity and trusted time are orthogonal: a freshly-captured (un-stamped)
    // capture is integrity-Verified AND on a local clock with a token pending.
    expect(content).toContain('Trusted time')
    expect(content).toContain('Verified')
    expect(content).toContain('Local clock — token pending')
  })

  it('reports un-stamped captures in preflight and the HTML summary without blocking export', async () => {
    await ingest(caseId, '<html><body>Needs trusted time</body></html>', 'https://example.com', 'T')

    const preflight = getExportPreflight(caseId)
    expect(preflight).toMatchObject({
      captureCount: 1,
      stampedCaptureCount: 0,
      unstampedCaptureCount: 1,
      pendingCaptureCount: 1,
      noneCaptureCount: 0
    })

    const outputPath = join(tempDir, 'warning.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toMatch(/\d+ captures? without trusted time/)
    // Whitespace-tolerant: the sentence wraps across source lines in the
    // template literal, so the emitted HTML carries a newline mid-phrase.
    expect(content).toMatch(/export\s+was\s+not\s+blocked/i)
  })

  // #492: the preflight counts are printed in certification.html beside per-capture
  // rows resolved from the manifest alone. A capture with no manifest entry whose
  // mirror claims rfc3161 used to be counted as stamped, so the document could claim
  // trusted time above a row rendering the same capture as "Local clock only".
  it('counts trusted time from the manifest when the mirror overclaims', () => {
    const capture = insertCapture({
      caseId,
      url: 'https://legacy.example',
      title: 'Legacy',
      hash: 'y'.repeat(64),
      timestamp: '2024-01-01T00:00:00Z'
    })
    setCaptureTrustedTime(capture.id, 'rfc3161')

    expect(getExportPreflight(caseId)).toMatchObject({
      captureCount: 1,
      stampedCaptureCount: 0,
      unstampedCaptureCount: 1,
      pendingCaptureCount: 0,
      noneCaptureCount: 1
    })
  })

  it('does not record overallValid:true when auditTrail is excluded (no verifications)', async () => {
    await ingest(caseId, '<html><body>Unverified export</body></html>', 'https://example.com', 'U')

    const caseDir = join(tempDir, 'captures', caseId)
    const outputPath = join(tempDir, 'unverified-evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
      investigatorName: 'Test User',
      outputPath
    }
    await generateReport(caseId, options, captureLifecycle)

    const manifest = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)

    const exportEntry = manifest.find((e) => e.type === 'export')!
    expect(exportEntry.verificationResult).toMatchObject({
      overallValid: false,
      captureCount: 1,
      verifiedCount: 0,
      tamperedCount: 0,
      missingCount: 0
    })
  })

  it('deletes the written zip when the export audit append throws', async () => {
    await ingest(caseId, '<html><body>Orphan check</body></html>', 'https://example.com', 'O')

    const spy = vi.spyOn(manifest, 'appendManifestEntry').mockImplementation(() => {
      throw new Error('signing key failure')
    })

    const outputPath = join(tempDir, 'orphan-evidence.zip')
    const options: ExportOptions = {
      format: 'zip',
      include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
      investigatorName: 'Test User',
      outputPath
    }

    try {
      await expect(generateReport(caseId, options, captureLifecycle)).rejects.toThrow(
        /signing key failure/
      )
      expect(existsSync(outputPath)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('generates report without optional sections', async () => {
    await ingest(caseId, 'payload', 'https://example.com', 'Minimal')

    const outputPath = join(tempDir, 'minimal.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: false,
        auditTrail: false,
        annotations: 'none'
      },
      investigatorName: 'Test',
      outputPath
    }

    await generateReport(caseId, options, captureLifecycle)
    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    // With no verification run, the report must decline to make an integrity
    // finding rather than silently reproducing a stale one.
    expect(content).toContain('No verification was run for this export.')
    expect(content).toContain('Not verified in this export')
  })

  it('escapes HTML in report output', async () => {
    await ingest(caseId, 'payload', 'https://example.com', '<script>alert("xss")</script>')

    const outputPath = join(tempDir, 'escaped.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).not.toContain('<script>alert')
    expect(content).toContain('&lt;script&gt;')
  })

  it('burns annotations into the embedded screenshot when include.annotations is burned', async () => {
    const c = createCase({ name: 'Burn' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: new Date().toISOString()
    })
    ensureCaseDir(c.id)
    const pngPath = defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs
    const white = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    writeFileSync(pngPath, white)

    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 20, y: 20, w: 40, h: 40, mode: 'solid' }],
      imageWidth: 100,
      imageHeight: 100
    })

    const outPath = join(tempDir, 'report.html')
    const options: ExportOptions = {
      format: 'html',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: false,
        annotations: 'burned'
      },
      investigatorName: 'Tester',
      outputPath: outPath
    }
    await generateReport(c.id, options, captureLifecycle)

    const html = readFileSync(outPath, 'utf-8')
    const match = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
    if (!match) throw new Error('No base64 image found in exported HTML')
    const buf = Buffer.from(match[1], 'base64')
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
    const pixelAt = (x: number, y: number): [number, number, number] => {
      const idx = (y * info.width + x) * info.channels
      return [data[idx], data[idx + 1], data[idx + 2]]
    }
    expect(pixelAt(40, 40)).toEqual([0, 0, 0])
    expect(pixelAt(80, 80)).toEqual([255, 255, 255])
  })

  // --- report.html must never cite a file the package does not contain ---

  it('reports a missing page archive as absent even when no verification runs', async () => {
    const { capture } = await ingest(caseId, '<html>gone</html>', 'https://example.com/gone', 'G')
    // Delete the stored archive after ingest, then export without an audit trail
    // so no verification result exists to infer absence from.
    rmSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'mhtml').abs)

    const outputPath = join(tempDir, 'missing-archive.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')

    expect(entries.has(`pages/${capture.id}.mhtml`)).toBe(false)
    expect(html).not.toContain(`pages/${capture.id}.mhtml`)
    expect(html).toContain('Stored page archive not available')
  })

  it('cites no screenshot path when screenshots are excluded from the package', async () => {
    const { capture } = await ingest(caseId, '<html>s</html>', 'https://example.com/s', 'S')
    ensureCaseDir(caseId)
    const png = await sharp({
      create: { width: 10, height: 10, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } }
    })
      .png()
      .toBuffer()
    writeFileSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'png').abs, png)

    const outputPath = join(tempDir, 'no-screenshots.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')

    expect([...entries.keys()].some((k) => k.startsWith('screenshots/'))).toBe(false)
    // The methodology section still explains content-addressing in prose; what
    // must not appear is a citation of a specific screenshot file.
    expect(html).not.toMatch(/screenshots\/[0-9a-f]{64}\.png/)
  })

  it('names the shared timestamp token path for captures with a duplicate content hash', async () => {
    const payload = '<html>dupe</html>'
    const a = await ingest(caseId, payload, 'https://example.com/a', 'A')
    const b = await ingest(caseId, payload, 'https://example.com/b', 'B')
    expect(a.capture.hash).toBe(b.capture.hash)

    const token = readFileSync(join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der'))
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: a.capture.hash,
      timestamp: '2026-04-05T12:01:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })

    const outputPath = join(tempDir, 'dupe-token.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')
    const tokenPaths = [...entries.keys()].filter((k) => k.startsWith('timestamps/'))

    // One token file is packaged for the shared hash; both exhibits must cite it
    // rather than each naming a file after its own capture id.
    expect(tokenPaths).toHaveLength(1)
    for (const cited of html.match(/timestamps\/[\w-]+\.tst/g) ?? []) {
      expect(tokenPaths).toContain(cited)
    }
  })

  it('does not describe companion files for a standalone HTML export', async () => {
    await ingest(caseId, '<html>standalone</html>')
    const outputPath = join(tempDir, 'standalone.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('This is a standalone report, not an evidence package')
    expect(html).toContain('These steps require the evidence package')
    expect(html).not.toContain('Companion files in this evidence package')
    // The verification steps still name pages/ generically — deliberately, so a
    // reader knows what to request. What must not appear is a per-exhibit
    // citation of a file this export did not write.
    expect(html).not.toMatch(/pages\/[0-9a-f-]{36}\.mhtml/)
    expect(html).not.toMatch(/timestamps\/[0-9a-f-]{36}\.tst/)
  })

  it('discloses burned annotations when shapes exist but no pins do', async () => {
    const c = createCase({ name: 'Shapes only' })
    ensureCaseDir(c.id)
    const white = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      screenshotHash: createHash('sha256').update(white).digest('hex'),
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, white)

    // A redaction burns pixels without producing any pin — the case where
    // inferring "annotated" from pins.length silently omits the disclosure.
    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 10, y: 10, w: 20, h: 20, mode: 'solid' }],
      imageWidth: 50,
      imageHeight: 50
    })

    const outputPath = join(tempDir, 'shapes-only.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: { captures: true, screenshots: true, auditTrail: false, annotations: 'burned' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('annotations burned in for legibility')
    // The digest belongs to the unannotated original, not to the pixels shown,
    // and the caption must say so rather than inviting a false mismatch.
    expect(html).toContain('unannotated original SHA-256')
    expect(html).toContain('that mismatch is expected rather than evidence of alteration')
  })

  it('escapes an unparseable capture timestamp instead of emitting it as markup', async () => {
    const c = createCase({ name: 'Bad clock' })
    insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: '<img src=x onerror=alert(1)>'
    })

    const outputPath = join(tempDir, 'bad-timestamp.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  // --- the report must not assert more than the export established ---

  it('does not have the operator attest to a verification run that did not happen', async () => {
    await ingest(caseId, '<html>unverified</html>')
    const outputPath = join(tempDir, 'no-verify.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    // The signature block is the statement an operator signs; it must not claim
    // digests were recomputed when nothing recomputed them.
    expect(html).not.toMatch(/those produced by the tool at the verification run/)
    expect(html).toMatch(/No verification was run for this\s+export/)
    expect(html).toContain('I make no statement about')
  })

  it('qualifies the attestation statement rather than claiming it for every capture', async () => {
    await ingest(caseId, '<html>scope</html>')
    const outputPath = join(tempDir, 'scope.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('whose exhibit records a verified result')
    expect(html).toMatch(/never for the package as a whole/)
    // The unconditional form claimed every capture rehashed, contradicting any
    // exhibit recorded as altered, absent or unverified.
    expect(html).not.toMatch(/That the stored bytes of each capture recompute/)
  })

  it('takes trusted time from the manifest, not the capture row mirror', async () => {
    const { capture } = await ingest(caseId, '<html>mirror</html>')
    // Corrupt the rebuildable mirror so it claims trusted time the manifest
    // cannot support. The exhibit must follow the manifest.
    setCaptureTrustedTime(capture.id, 'rfc3161')

    const outputPath = join(tempDir, 'stale-mirror.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    // A v2+ capture with no timestamp entry is 'pending' by the manifest, so
    // that is what the exhibit must state — not the mirror's 'rfc3161'.
    expect(html).toContain('Local clock — token pending')
    expect(html).not.toContain('RFC 3161 token retained')
  })

  it('labels an exhibit image with the digest of the bytes it reproduces', async () => {
    const c = createCase({ name: 'Sidecar drift' })
    ensureCaseDir(c.id)
    const png = await sharp({
      create: { width: 20, height: 20, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } }
    })
      .png()
      .toBuffer()
    // Record a digest that does not match the bytes on disk, as happens when the
    // sidecar changes after ingest.
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      screenshotHash: 'f'.repeat(64),
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, png)

    const outputPath = join(tempDir, 'sidecar-drift.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: { captures: true, screenshots: true, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    const actual = createHash('sha256').update(png).digest('hex')
    expect(html).toContain(`image SHA-256 ${actual}`)
    expect(html).toContain('no longer matches the digest recorded for it')
    expect(html).toContain('f'.repeat(64))
  })

  it('claims RFC 3161 trusted time only when the token is in the package', async () => {
    const { capture } = await ingest(caseId, '<html>tt</html>')
    // A synthetic token whose messageImprint matches the capture hash, so
    // trusted-time resolution actually yields rfc3161 rather than pending.
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

    const outputPath = join(tempDir, 'tt-consistency.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        // auditTrail off, so the claim comes from the manifest fallback rather
        // than from a verification result — the path that read a stale mirror.
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const entries = readStoredZipEntries(outputPath)
    const html = entries.get('report.html')!.toString('utf-8')
    const packagedTokens = [...entries.keys()].filter((k) => k.startsWith('timestamps/'))

    // The trusted-time index and the token paths come from one manifest
    // snapshot, so a claimed token is always a packaged token.
    expect(packagedTokens).toHaveLength(1)
    expect(html).toContain('RFC 3161 token retained')
    expect(html).toContain(packagedTokens[0])
  })

  it('numbers legend entries with the pin numbers burned into the image', async () => {
    const c = createCase({ name: 'Pins' })
    ensureCaseDir(c.id)
    const white = await sharp({
      create: {
        width: 60,
        height: 60,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
      .png()
      .toBuffer()
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com',
      title: 'X',
      hash: 'h',
      timestamp: new Date().toISOString()
    })
    writeFileSync(defaultCaptureStore.artifactPaths(c.id, cap.id, 'png').abs, white)
    saveAnnotations({
      captureId: cap.id,
      shapes: [{ kind: 'redact', id: 'r', x: 5, y: 5, w: 10, h: 10, mode: 'solid' }],
      imageWidth: 60,
      imageHeight: 60
    })
    // Pins are numbered MAX(number)+1 and deletion does not renumber, so after
    // removing the first two the survivors are 3 and 4. A legend that lets the
    // browser count from 1 would then disagree with the burned image.
    const p1 = upsertPin({ captureId: cap.id, body: 'One' })
    const p2 = upsertPin({ captureId: cap.id, body: 'Two' })
    upsertPin({ captureId: cap.id, body: 'Third pin, first surviving entry.' })
    upsertPin({ captureId: cap.id, body: 'Fourth pin.' })
    deletePin(p1.id)
    deletePin(p2.id)

    const outputPath = join(tempDir, 'pins.html')
    await generateReport(
      c.id,
      {
        format: 'html',
        include: { captures: true, screenshots: true, auditTrail: false, annotations: 'burned' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('<li value="3">')
    expect(html).toContain('<li value="4">')
  })

  it('does not make package claims on the cover of a standalone export', async () => {
    await ingest(caseId, '<html>cover</html>')
    const outputPath = join(tempDir, 'cover-standalone.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readFileSync(outputPath, 'utf-8')
    expect(html).toContain('Captures described')
    expect(html).not.toContain('Captures in package')
    // No archive is emitted, so the cover must not tally archives as present.
    expect(html).not.toContain('Page archive present')
    expect(html).toContain('not enclosed with it')
  })

  it('does not attest cover tallies to a verification run that did not happen', async () => {
    await ingest(caseId, '<html>tally</html>')
    const outputPath = join(tempDir, 'cover-noverify.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(html).not.toContain('The integrity count is produced by the verification run')
    expect(html).toMatch(/No verification was run for this export/)
    expect(html).toContain('the figure is not a finding of failure')
  })

  it('requires an independently obtained trust anchor for a non-default TSA', async () => {
    updateSettings({ tsaUrl: 'https://tsa.example.org/timestamp' })
    await ingest(caseId, '<html>tsa</html>')
    const outputPath = join(tempDir, 'custom-tsa.zip')
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: false, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle
    )

    const html = readStoredZipEntries(outputPath).get('report.html')!.toString('utf-8')
    expect(html).toContain('No trust anchor is bundled for the configured authority')
    expect(html).toContain('trust anchor you obtain independently')
    // Must not tell a reviewer that chaining to the bundled file proves anything.
    expect(html).not.toContain('which carries the authority’s trust anchor')
  })

  // --- Operator identity gating and report rendering ---

  it('generateReport throws when operator name is blank', async () => {
    updateSettings({ operatorName: '' })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'blocked.html')
    await expect(
      generateReport(
        caseId,
        {
          format: 'html',
          include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
          investigatorName: 'Det. Smith',
          outputPath
        },
        captureLifecycle
      )
    ).rejects.toThrow(/operator name/i)
  })

  it('generateReport throws when operator name is whitespace-only', async () => {
    updateSettings({ operatorName: '   ' })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'blocked-ws.html')
    await expect(
      generateReport(
        caseId,
        {
          format: 'html',
          include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
          investigatorName: 'Det. Smith',
          outputPath
        },
        captureLifecycle
      )
    ).rejects.toThrow(/operator name/i)
  })

  it('generated report includes installationId and operator identity', async () => {
    updateSettings({
      operatorName: 'Det. Smith',
      operatorRole: 'Detective',
      operatorOrganization: 'Metro PD'
    })
    await ingest(caseId, '<html>test</html>')
    const outputPath = join(tempDir, 'identity.html')
    await generateReport(
      caseId,
      {
        format: 'html',
        include: { captures: true, screenshots: false, auditTrail: false, annotations: 'none' },
        investigatorName: 'Det. Smith',
        outputPath
      },
      captureLifecycle
    )

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Det. Smith')
    expect(content).toContain('Detective')
    expect(content).toContain('Metro PD')
    // installationId is a UUID — verify its label is present
    expect(content).toContain('Installation identifier')
  })

  it('reports granular per-item progress through the verify and screenshot stages', async () => {
    const screenshot = Buffer.from('progress-png-bytes')
    const base = {
      caseId,
      timestamp: '2026-04-05T12:00:00.000Z',
      textContent: 'text',
      headers: {},
      browserVersion: '',
      userAgent: '',
      httpStatus: 200,
      extensionVersion: '',
      operatorId: 'op',
      operatorName: '',
      toolVersion: '0.1.0',
      screenshot
    }
    await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/1',
      title: '1',
      stream: Readable.from([Buffer.from('mhtml-1')]) as unknown as ReadableStream<Uint8Array>
    })
    await ingestMhtmlCapture({
      ...base,
      url: 'https://example.com/2',
      title: '2',
      stream: Readable.from([Buffer.from('mhtml-2')]) as unknown as ReadableStream<Uint8Array>
    })

    const outputPath = join(tempDir, 'progress.zip')
    const steps: Array<{ step: string; percent: number }> = []
    await generateReport(
      caseId,
      {
        format: 'zip',
        include: { captures: true, screenshots: true, auditTrail: true, annotations: 'none' },
        investigatorName: 'Test',
        outputPath
      },
      captureLifecycle,
      (step, percent) => steps.push({ step, percent })
    )

    const labels = steps.map((s) => s.step)
    expect(labels).toContain('Loading captures...')
    expect(labels).toContain('Verifying capture 1 of 2...')
    expect(labels).toContain('Verifying capture 2 of 2...')
    expect(labels).toContain('Loading screenshot 1 of 2...')
    expect(labels).toContain('Loading screenshot 2 of 2...')
    expect(steps.at(-1)).toEqual({ step: 'Complete', percent: 100 })

    // Percent is monotonic non-decreasing so the bar never jumps backwards.
    const percents = steps.map((s) => s.percent)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })
})
