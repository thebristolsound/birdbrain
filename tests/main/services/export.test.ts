import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture
} from '../../../src/main/services/database'
import { initStorage, ensureCaseDir, getCapturePath } from '../../../src/main/services/storage'
import { initManifest } from '../../../src/main/services/manifest'
import { ingestMhtmlCapture } from '../../../src/main/services/captureLifecycle'
import {
  createCaptureLifecycle,
  type CaptureLifecycle
} from '../../../src/main/services/captureLifecycle'
import { createSelectorLifecycle } from '../../../src/main/services/selectorLifecycle'
import { verifyCaptures, generateReport } from '../../../src/main/services/export'
import { saveAnnotations } from '../../../src/main/services/annotations'
import { initSettings, updateSettings } from '../../../src/main/services/settings'
import { initInstallationId, resetInstallationId } from '../../../src/main/services/installationId'
import type { ExportOptions } from '../../../src/shared/types'

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
