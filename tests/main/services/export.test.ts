import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import sharp from 'sharp'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture
} from '../../../src/main/services/database'
import { initStorage, ensureCaseDir, getCapturePath } from '../../../src/main/services/storage'
import * as manifest from '../../../src/main/services/manifest'
import {
  appendManifestEntry,
  getManifestHead,
  initManifest,
  verifyManifestChain
} from '../../../src/main/services/manifest'
import { canonicalStringify } from '@shared/verify'
import { ingestMhtmlCapture } from '../../../src/main/services/captureLifecycle'
import {
  createCaptureLifecycle,
  type CaptureLifecycle
} from '../../../src/main/services/captureLifecycle'
import { createSelectorLifecycle } from '../../../src/main/services/selectorLifecycle'
import {
  verifyCaptures,
  generateReport,
  getExportPreflight
} from '../../../src/main/services/export'
import { saveAnnotations } from '../../../src/main/services/annotations'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import type { ExportOptions } from '../../../src/shared/types'

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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
    expect(content).toContain('Audit Trail')
    expect(content).toContain('verify-verified')
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

    // The audit trail has a dedicated Trusted Time column; a freshly-captured
    // (un-stamped) capture is integrity-verified AND trusted-time Pending.
    expect(content).toContain('Trusted Time')
    expect(content).toContain('verify-verified')
    expect(content).toContain('Pending')
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
    expect(content).toContain('Trusted time warning')
    expect(content).toContain('Export was not blocked')
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

    const spy = vi
      .spyOn(manifest, 'appendManifestEntry')
      .mockImplementation(() => {
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
    expect(content).not.toContain('Audit Trail')
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
    const pngPath = getCapturePath(c.id, cap.id, 'png')
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
    expect(content).toContain('Installation ID')
  })
})
