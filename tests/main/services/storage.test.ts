import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initStorage,
  saveCapture,
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
})
