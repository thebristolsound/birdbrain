import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, createCase, insertCapture } from '../../../src/main/services/database'
import { initStorage, saveCapture } from '../../../src/main/services/storage'
import { hashContent } from '../../../src/main/services/hash'
import { verifyCaptures, generateReport } from '../../../src/main/services/export'
import type { ExportOptions } from '../../../src/shared/types'

describe('export', () => {
  let tempDir: string
  let caseId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-export-'))
    initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))

    const c = createCase({ name: 'Export Test Case', description: 'Test case for export' })
    caseId = c.id
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('verifyCaptures marks verified when hash matches', () => {
    const html = '<html><body>Test content</body></html>'
    const hash = hashContent(html)
    const capture = insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Test',
      hash,
      timestamp: '2024-01-01T00:00:00Z'
    })
    saveCapture(caseId, capture.id, html)

    const results = verifyCaptures(caseId)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('verified')
    expect(results[0].computedHash).toBe(hash)
  })

  it('verifyCaptures marks tampered when hash mismatches', () => {
    const html = '<html><body>Original</body></html>'
    // Insert capture first to get the generated ID
    const capture = insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Test',
      hash: 'wrong-hash-value',
      timestamp: '2024-01-01T00:00:00Z'
    })
    // Save file using the DB-generated capture ID
    saveCapture(caseId, capture.id, html)

    const results = verifyCaptures(caseId)
    expect(results[0].status).toBe('tampered')
  })

  it('verifyCaptures marks missing when file not found', () => {
    insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Missing',
      hash: 'some-hash',
      timestamp: '2024-01-01T00:00:00Z'
    })

    const results = verifyCaptures(caseId)
    expect(results[0].status).toBe('missing')
  })

  it('generates HTML report', async () => {
    const html = '<html><body>Page content</body></html>'
    const hash = hashContent(html)
    const captureId = 'test-cap-3'
    saveCapture(caseId, captureId, html)
    insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Test Page',
      hash,
      timestamp: '2024-01-01T00:00:00Z',
      htmlPath: join(caseId, `${captureId}.html`)
    })

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
  })

  it('generates report without optional sections', async () => {
    insertCapture({
      caseId,
      url: 'https://example.com',
      title: 'Minimal',
      hash: 'abc',
      timestamp: '2024-01-01T00:00:00Z'
    })

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
    insertCapture({
      caseId,
      url: 'https://example.com',
      title: '<script>alert("xss")</script>',
      hash: 'abc',
      timestamp: '2024-01-01T00:00:00Z'
    })

    const outputPath = join(tempDir, 'escaped.html')
    await generateReport(caseId, {
      format: 'html',
      include: { captures: true, screenshots: false, auditTrail: false },
      investigatorName: 'Test',
      outputPath
    })

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).not.toContain('<script>')
    expect(content).toContain('&lt;script&gt;')
  })
})
