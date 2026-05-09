import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture,
  getExtractedDataCountForCase,
  insertExtractedData
} from '@main/services/database'
import { initStorage } from '@main/services/storage'
import { reprocessCase } from '@main/services/extraction/reprocess'

function writeHtml(root: string, caseId: string, captureId: string, html: string): void {
  const dir = join(root, caseId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${captureId}.html`), html, 'utf-8')
}

describe('extraction/reprocess', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-reprocess-'))
    initStorage(tempDir)
    initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns processed count = number of captures (including skipped)', async () => {
    const c = createCase({ name: 'C' })
    insertCapture({
      caseId: c.id,
      url: 'https://a',
      title: 'A',
      hash: 'h1',
      timestamp: new Date().toISOString()
    })
    insertCapture({
      caseId: c.id,
      url: 'https://b',
      title: 'B',
      hash: 'h2',
      timestamp: new Date().toISOString()
    })
    // No source files written — both should be counted but extract nothing
    const result = await reprocessCase(c.id)
    expect(result).toEqual({ processed: 2 })
  })

  it('returns processed: 0 when the case has no captures', async () => {
    const c = createCase({ name: 'Empty' })
    const result = await reprocessCase(c.id)
    expect(result).toEqual({ processed: 0 })
  })

  it('clears legacy extracted rows even when the source file is missing now', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://a',
      title: 'A',
      hash: 'h1',
      timestamp: new Date().toISOString()
    })

    // Pre-seed a stale extracted row
    insertExtractedData(cap.id, c.id, 'https://a', [
      { category: 'ioc', subcategory: 'email', value: 'legacy@example.com' }
    ])
    expect(getExtractedDataCountForCase(c.id)).toBeGreaterThan(0)

    await reprocessCase(c.id)

    // No source file → re-extraction inserts nothing → the count is now 0
    expect(getExtractedDataCountForCase(c.id)).toBe(0)
  })

  it('re-extracts from the source HTML when present', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://a',
      title: 'A',
      hash: 'h1',
      timestamp: new Date().toISOString()
    })
    writeHtml(
      tempDir,
      c.id,
      cap.id,
      '<html><body>contact: foo@example.com and visit https://target.example</body></html>'
    )

    await reprocessCase(c.id)

    expect(getExtractedDataCountForCase(c.id)).toBeGreaterThan(0)
  })

  it('continues past a capture whose extraction throws', async () => {
    const c = createCase({ name: 'C' })
    const cap1 = insertCapture({
      caseId: c.id,
      url: 'https://a',
      title: 'A',
      hash: 'h1',
      timestamp: new Date().toISOString()
    })
    const cap2 = insertCapture({
      caseId: c.id,
      url: 'https://b',
      title: 'B',
      hash: 'h2',
      timestamp: new Date().toISOString()
    })

    // cap1: write a directory where the .html file is expected so the read throws.
    // (readExtractionHtml falls back to reading <captureId>.html as a buffer; if a
    // directory of that name exists, the read raises EISDIR.)
    const caseDir = join(tempDir, c.id)
    mkdirSync(caseDir, { recursive: true })
    mkdirSync(join(caseDir, `${cap1.id}.html`), { recursive: true })

    // cap2: a normal HTML source
    writeHtml(tempDir, c.id, cap2.id, '<html><body>email me at b@example.com</body></html>')

    const result = await reprocessCase(c.id)
    expect(result).toEqual({ processed: 2 })
    // cap2 should still have produced extracted rows
    expect(getExtractedDataCountForCase(c.id)).toBeGreaterThan(0)
  })

  it('yields to the event loop between captures', async () => {
    const c = createCase({ name: 'C' })
    for (let i = 0; i < 5; i++) {
      insertCapture({
        caseId: c.id,
        url: `https://a${i}`,
        title: `A${i}`,
        hash: `h${i}`,
        timestamp: new Date().toISOString()
      })
    }

    let interleaved = 0
    const ticker = setInterval(() => {
      interleaved++
    }, 0)

    await reprocessCase(c.id)
    clearInterval(ticker)

    // setImmediate yields between each of the 5 captures; the timer should have
    // fired at least once interleaved with the loop.
    expect(interleaved).toBeGreaterThan(0)
  })
})
