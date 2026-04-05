import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initStorage,
  saveCapture,
  updateCaptureHtml,
  getCapturePath,
  readCaptureFile,
  deleteCaptureFiles,
  getCaseStorageSize
} from '@main/services/storage'

describe('storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-test-'))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('saves and reads HTML capture', () => {
    const html = '<html><body>Hello</body></html>'
    const result = saveCapture('case-1', 'cap-1', html)

    expect(result.htmlPath).toContain('cap-1.html')
    expect(result.screenshotPath).toBeUndefined()

    const content = readCaptureFile('case-1', 'cap-1', 'html')
    expect(content?.toString()).toBe(html)
  })

  it('saves HTML + screenshot + text', () => {
    const html = '<html>test</html>'
    const screenshot = Buffer.from('fake png data')
    const text = 'extracted text'

    const result = saveCapture('case-1', 'cap-1', html, screenshot, text)
    expect(result.htmlPath).toBeDefined()
    expect(result.screenshotPath).toBeDefined()
    expect(result.textPath).toBeDefined()

    expect(readCaptureFile('case-1', 'cap-1', 'png')).toEqual(screenshot)
    expect(readCaptureFile('case-1', 'cap-1', 'txt')?.toString()).toBe(text)
  })

  it('returns correct file path', () => {
    const path = getCapturePath('case-1', 'cap-1', 'html')
    expect(path).toBe(join(tempDir, 'case-1', 'cap-1.html'))
  })

  it('returns null for non-existent file', () => {
    expect(readCaptureFile('no-case', 'no-cap', 'html')).toBeNull()
  })

  it('deletes capture files', () => {
    saveCapture('case-1', 'cap-1', '<html>test</html>', Buffer.from('png'))
    deleteCaptureFiles('case-1', 'cap-1')

    expect(readCaptureFile('case-1', 'cap-1', 'html')).toBeNull()
    expect(readCaptureFile('case-1', 'cap-1', 'png')).toBeNull()
  })

  it('calculates case storage size', () => {
    saveCapture('case-1', 'cap-1', 'a'.repeat(100))
    saveCapture('case-1', 'cap-2', 'b'.repeat(200))

    const size = getCaseStorageSize('case-1')
    expect(size).toBe(300)
  })

  it('returns 0 for non-existent case directory', () => {
    expect(getCaseStorageSize('nonexistent')).toBe(0)
  })

  it('creates nested case directory automatically', () => {
    saveCapture('new-case', 'cap-1', '<html>test</html>')
    expect(existsSync(join(tempDir, 'new-case'))).toBe(true)
  })

  it('updateCaptureHtml overwrites existing HTML file', () => {
    const originalHtml = '<html><body>Original</body></html>'
    const updatedHtml = '<html><body>Updated freeze-dried</body></html>'

    saveCapture('case-1', 'cap-1', originalHtml)
    expect(readCaptureFile('case-1', 'cap-1', 'html')?.toString()).toBe(originalHtml)

    updateCaptureHtml('case-1', 'cap-1', updatedHtml)
    expect(readCaptureFile('case-1', 'cap-1', 'html')?.toString()).toBe(updatedHtml)
  })

  it('updateCaptureHtml creates file even if case dir already exists', () => {
    // Create case dir via saveCapture with a different capture
    saveCapture('case-1', 'cap-1', '<html>first</html>')

    // Update a different capture in the same case dir
    updateCaptureHtml('case-1', 'cap-2', '<html>new file</html>')
    expect(readCaptureFile('case-1', 'cap-2', 'html')?.toString()).toBe('<html>new file</html>')
  })

  it('returns correct .mhtml path', () => {
    const path = getCapturePath('case-1', 'cap-1', 'mhtml')
    expect(path).toContain('cap-1.mhtml')
  })

  it('deleteCaptureFiles removes .mhtml files too', () => {
    const dir = join(tempDir, 'case-1')
    require('fs').mkdirSync(dir, { recursive: true })
    require('fs').writeFileSync(join(dir, 'cap-1.mhtml'), 'fake mhtml')
    require('fs').writeFileSync(join(dir, 'cap-1.html'), 'fake html')
    deleteCaptureFiles('case-1', 'cap-1')
    expect(existsSync(join(dir, 'cap-1.mhtml'))).toBe(false)
    expect(existsSync(join(dir, 'cap-1.html'))).toBe(false)
  })
})
