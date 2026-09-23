import { describe, expect, it } from 'vitest'
import {
  CAPTURE_PACKAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  capturePagePath,
  derivedFilePackagePath,
  exhibitPackageDirectory,
  exhibitPackagePath,
  inCasePath,
  screenshotPath,
  timestampTokenPath
} from '../index'

describe('Package Layout paths', () => {
  it('names a Capture page, screenshot and token under their directories', () => {
    expect(capturePagePath('cap-1')).toBe('pages/cap-1.mhtml')
    expect(screenshotPath('ab12')).toBe('screenshots/ab12.png')
    expect(timestampTokenPath('ex-9')).toBe('timestamps/ex-9.tst')
  })

  it('drops the Case segment and normalizes backslashes', () => {
    const cases: Array<[string, string]> = [
      ['case-id/documents/exhibit.pdf', 'documents/exhibit.pdf'],
      ['case-id\\documents\\exhibit.pdf', 'documents/exhibit.pdf'],
      ['case-id\\attachments\\a b.zip', 'attachments/a b.zip'],
      ['case-id/documents\\exhibit.pdf', 'documents/exhibit.pdf'],
      ['exhibit.pdf', 'exhibit.pdf']
    ]
    for (const [input, expected] of cases) {
      expect(inCasePath(input), input).toBe(expected)
      expect(exhibitPackagePath(input), input).toBe(expected)
    }
  })

  it('routes a Capture to pages/ and any other kind to its stored directory', () => {
    expect(exhibitPackageDirectory('capture', null)).toBe(CAPTURE_PACKAGE_DIRECTORY)
    expect(exhibitPackageDirectory('capture', 'case/x/y.mhtml')).toBe(CAPTURE_PACKAGE_DIRECTORY)
    expect(exhibitPackageDirectory('document', 'case/documents/d.pdf')).toBe('documents')
    expect(exhibitPackageDirectory('document', 'case\\documents\\d.pdf')).toBe('documents')
    expect(exhibitPackageDirectory('attachment', 'case/flat.bin')).toBe('')
    expect(exhibitPackageDirectory('unknown-kind', null)).toBe('')
  })

  it('encloses a Derived File beside its parent', () => {
    expect(derivedFilePackagePath('pages', 'case/pages/cap_thumb.png')).toBe('pages/cap_thumb.png')
    expect(derivedFilePackagePath('', 'case\\flat_text.txt')).toBe('flat_text.txt')
  })

  it('holds one spelling of every root document', () => {
    expect(new Set(Object.values(PACKAGE_ROOT_FILES)).size).toBe(
      Object.keys(PACKAGE_ROOT_FILES).length
    )
    expect(Object.isFrozen(PACKAGE_ROOT_FILES)).toBe(true)
  })
})
