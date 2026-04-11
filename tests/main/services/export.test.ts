import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture
} from '../../../src/main/services/database'
import { initStorage, ensureCaseDir } from '../../../src/main/services/storage'
import { initManifest } from '../../../src/main/services/manifest'
import { ingestMhtmlCapture } from '../../../src/main/services/mhtmlIngest'
import { verifyCaptures, generateReport } from '../../../src/main/services/export'
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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')

    const c = createCase({ name: 'Export Test Case', description: 'Test case for export' })
    caseId = c.id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('verifyCaptures marks verified when hash matches', async () => {
    await ingest(caseId, '<html><body>Test content</body></html>')

    const results = await verifyCaptures(caseId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('verified')
    expect(results[0].storedHash).toBe(results[0].computedHash)
  })

  it('verifyCaptures marks tampered when file bytes change after ingest', async () => {
    const { capture } = await ingest(caseId, '<html><body>Original</body></html>')
    // Mutate the on-disk MHTML to simulate tampering
    writeFileSync(join(tempDir, 'captures', capture.mhtmlPath!), 'mutated bytes')

    const results = await verifyCaptures(caseId)
    expect(results[0].status).toBe('tampered')
  })

  it('verifyCaptures marks missing when MHTML file is gone', async () => {
    const { capture } = await ingest(caseId, '<html><body>Vanishing</body></html>')
    rmSync(join(tempDir, 'captures', capture.mhtmlPath!))

    const results = await verifyCaptures(caseId)
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

    const results = await verifyCaptures(caseId)
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
        auditTrail: true
      },
      investigatorName: 'Test User',
      outputPath
    }

    await generateReport(caseId, options)
    expect(existsSync(outputPath)).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    expect(content).toContain('Test User')
    expect(content).toContain('example.com')
    expect(content).toContain('Birdbrain')
    expect(content).toContain('Audit Trail')
    // Report should reflect the verified status from the MHTML pipeline
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
        auditTrail: false
      },
      investigatorName: 'Test',
      outputPath
    }

    await generateReport(caseId, options)
    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Export Test Case')
    expect(content).not.toContain('Audit Trail')
  })

  it('escapes HTML in report output', async () => {
    await ingest(caseId, 'payload', 'https://example.com', '<script>alert("xss")</script>')

    const outputPath = join(tempDir, 'escaped.html')
    await generateReport(caseId, {
      format: 'html',
      include: { captures: true, screenshots: false, auditTrail: false },
      investigatorName: 'Test',
      outputPath
    })

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).not.toContain('<script>alert')
    expect(content).toContain('&lt;script&gt;')
  })
})
